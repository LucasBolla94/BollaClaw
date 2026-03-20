import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';
import { SkillValidator, ValidationResult } from '../../skills/SkillValidator';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

// ============================================================
// CreateSkillTool — Lets the agent create complete skill packages
// ============================================================
// Receives a full skill specification as JSON and creates:
//   1. SKILL.md with YAML frontmatter + instructions
//   2. scripts/ with the main script and helpers
//   3. tools/ with JSON tool definitions
//   4. Validates everything before writing
//   5. Returns detailed errors for the agent to fix
// ============================================================

interface ScriptSpec {
  filename: string;     // e.g. "main.py"
  content: string;      // Full script source
}

interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  script: string;       // e.g. "scripts/main.py"
  runtime?: string;     // python | node | bash
}

interface SkillSpec {
  name: string;
  description: string;
  version?: string;
  runtime?: 'python' | 'node' | 'bash';
  entrypoint?: string;
  dependencies?: {
    pip?: string[];
    npm?: string[];
    apt?: string[];
  };
  api?: {
    baseUrl?: string;
    authType?: string;
    envVars?: string[];
  };
  triggers?: string[];
  tags?: string[];
  instructions: string;   // Markdown body of SKILL.md (agent instructions)
  scripts: ScriptSpec[];   // Script files to create
  tools: ToolSpec[];       // Tool definitions to create
}

export class CreateSkillTool extends BaseTool {
  readonly name = 'create_skill';
  readonly description = `Creates a complete BollaClaw skill package. Provide the full specification as JSON including: name, description, scripts (with filename and content), tools (JSON Schema definitions), dependencies, triggers, and agent instructions. The skill is validated before creation. Returns the skill directory path on success, or detailed error messages for fixing.`;

  readonly parameters = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name in kebab-case (e.g., "weather-api", "pdf-reader"). Must be unique, 3-50 chars, lowercase letters/numbers/hyphens.',
      },
      description: {
        type: 'string',
        description: 'One-line description of what the skill does. Used by the router to decide when to activate.',
      },
      version: {
        type: 'string',
        description: 'Semantic version string (default: "1.0")',
      },
      runtime: {
        type: 'string',
        description: 'Script runtime: "python" (preferred), "node", or "bash". Default: python.',
      },
      entrypoint: {
        type: 'string',
        description: 'Main script path relative to skill dir (default: "scripts/main.py")',
      },
      dependencies_pip: {
        type: 'array',
        description: 'Python packages to install (e.g., ["requests>=2.28", "beautifulsoup4"])',
      },
      dependencies_npm: {
        type: 'array',
        description: 'Node packages to install (e.g., ["axios", "cheerio"])',
      },
      api_base_url: {
        type: 'string',
        description: 'Base URL of external API if the skill uses one',
      },
      api_auth_type: {
        type: 'string',
        description: 'API auth method: "bearer", "api_key", "basic", or "none"',
      },
      api_env_vars: {
        type: 'array',
        description: 'Required environment variable names for API keys (e.g., ["OPENWEATHER_KEY"])',
      },
      triggers: {
        type: 'array',
        description: 'Keywords that activate this skill WITHOUT LLM routing (fast matching). Be specific.',
      },
      tags: {
        type: 'array',
        description: 'Category tags for organization (e.g., ["api", "utility", "finance"])',
      },
      instructions: {
        type: 'string',
        description: 'Full markdown instructions for the agent. Explains WHEN and HOW to use the skill, examples, response format, etc.',
      },
      scripts: {
        type: 'array',
        description: 'Array of script files. Each: { "filename": "main.py", "content": "#!/usr/bin/env python3\\n..." }',
      },
      tools: {
        type: 'array',
        description: 'Array of tool definitions. Each: { "name": "my_tool", "description": "...", "parameters": { "type": "object", "properties": {...}, "required": [...] }, "script": "scripts/main.py", "runtime": "python" }',
      },
    },
    required: ['name', 'description', 'instructions', 'scripts'],
  };

  private validator = new SkillValidator();

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // 1. Parse and build the spec
      const spec = this.buildSpec(args);

      // 2. Pre-validate the spec in memory
      const preCheck = this.preValidate(spec);
      if (!preCheck.valid) {
        return {
          output: '',
          error: `Skill validation failed before creation:\n${preCheck.errors.map(e => `  ✗ ${e}`).join('\n')}${preCheck.warnings.length > 0 ? '\n\nWarnings:\n' + preCheck.warnings.map(w => `  ⚠ ${w}`).join('\n') : ''}`,
        };
      }

      // 3. Check if skill already exists
      const skillsDir = config.agent.skillsDir;
      const skillDir = path.join(skillsDir, spec.name);

      if (fs.existsSync(skillDir)) {
        // Check if it's the _template — don't overwrite
        if (spec.name === '_template') {
          return { output: '', error: 'Cannot overwrite the _template skill' };
        }
        // Overwrite is allowed for updates
        logger.info(`[CreateSkill] Overwriting existing skill: ${spec.name}`);
      }

      // 4. Create directory structure
      fs.mkdirSync(skillDir, { recursive: true });
      fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
      if (spec.tools.length > 0) {
        fs.mkdirSync(path.join(skillDir, 'tools'), { recursive: true });
      }

      // 5. Generate and write SKILL.md
      const skillMd = this.generateSkillMd(spec);
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

      // 6. Write scripts
      for (const script of spec.scripts) {
        const scriptPath = path.join(skillDir, 'scripts', script.filename);
        fs.writeFileSync(scriptPath, script.content, 'utf-8');
        // Make executable
        fs.chmodSync(scriptPath, 0o755);
      }

      // 7. Write tool definitions
      for (const tool of spec.tools) {
        const toolFilename = `${tool.name}.json`;
        const toolPath = path.join(skillDir, 'tools', toolFilename);
        const toolDef = {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          script: tool.script,
          runtime: tool.runtime || spec.runtime || 'python',
        };
        fs.writeFileSync(toolPath, JSON.stringify(toolDef, null, 2), 'utf-8');
      }

      // 8. Write requirements.txt for pip deps
      if (spec.dependencies?.pip && spec.dependencies.pip.length > 0) {
        const reqPath = path.join(skillDir, 'requirements.txt');
        fs.writeFileSync(reqPath, spec.dependencies.pip.join('\n') + '\n', 'utf-8');
      }

      // 9. Post-creation validation
      const postCheck = this.validator.validateSkillDir(skillDir);
      if (!postCheck.valid) {
        return {
          output: '',
          error: `Skill created but validation failed — please fix and try again:\n${postCheck.errors.map(e => `  ✗ ${e}`).join('\n')}`,
        };
      }

      // 10. Build success response
      const summary = [
        `✅ Skill "${spec.name}" created successfully!`,
        `📁 Path: ${skillDir}`,
        `📄 SKILL.md: frontmatter + instructions`,
        `📜 Scripts: ${spec.scripts.map(s => s.filename).join(', ')}`,
      ];

      if (spec.tools.length > 0) {
        summary.push(`🔧 Tools: ${spec.tools.map(t => t.name).join(', ')}`);
      }

      if (spec.dependencies?.pip && spec.dependencies.pip.length > 0) {
        summary.push(`📦 Dependencies: ${spec.dependencies.pip.join(', ')}`);
      }

      if (postCheck.warnings.length > 0) {
        summary.push(`\n⚠ Warnings:\n${postCheck.warnings.map(w => `  - ${w}`).join('\n')}`);
      }

      summary.push(`\n🔄 Use /reload to activate this skill in the running bot.`);

      logger.info(`[CreateSkill] Skill "${spec.name}" created at ${skillDir}`);
      return { output: summary.join('\n') };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CreateSkill] Failed: ${msg}`);
      return { output: '', error: `Failed to create skill: ${msg}` };
    }
  }

  /**
   * Build SkillSpec from raw tool arguments
   */
  private buildSpec(args: Record<string, unknown>): SkillSpec {
    const name = this.validator.sanitizeName(String(args.name || ''));
    if (!name) throw new Error('Invalid skill name');

    const scripts: ScriptSpec[] = [];
    if (Array.isArray(args.scripts)) {
      for (const s of args.scripts) {
        const spec = s as Record<string, string>;
        if (spec.filename && spec.content) {
          scripts.push({
            filename: path.basename(spec.filename),
            content: spec.content,
          });
        }
      }
    }

    const tools: ToolSpec[] = [];
    if (Array.isArray(args.tools)) {
      for (const t of args.tools) {
        const spec = t as Record<string, unknown>;
        if (spec.name && spec.description && spec.parameters && spec.script) {
          tools.push({
            name: this.validator.sanitizeToolName(String(spec.name)),
            description: String(spec.description),
            parameters: spec.parameters as ToolSpec['parameters'],
            script: String(spec.script),
            runtime: spec.runtime ? String(spec.runtime) : undefined,
          });
        }
      }
    }

    // Build dependencies
    const dependencies: SkillSpec['dependencies'] = {};
    if (Array.isArray(args.dependencies_pip) && args.dependencies_pip.length > 0) {
      dependencies.pip = args.dependencies_pip.map(String);
    }
    if (Array.isArray(args.dependencies_npm) && args.dependencies_npm.length > 0) {
      dependencies.npm = args.dependencies_npm.map(String);
    }

    // Build API config
    let api: SkillSpec['api'] | undefined;
    if (args.api_base_url) {
      api = {
        baseUrl: String(args.api_base_url),
        authType: String(args.api_auth_type || 'none'),
        envVars: Array.isArray(args.api_env_vars) ? args.api_env_vars.map(String) : undefined,
      };
    }

    return {
      name,
      description: String(args.description || ''),
      version: String(args.version || '1.0'),
      runtime: (args.runtime as SkillSpec['runtime']) || 'python',
      entrypoint: args.entrypoint ? String(args.entrypoint) : undefined,
      dependencies: Object.keys(dependencies).length > 0 ? dependencies : undefined,
      api,
      triggers: Array.isArray(args.triggers) ? args.triggers.map(String) : undefined,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      instructions: String(args.instructions || ''),
      scripts,
      tools,
    };
  }

  /**
   * Pre-validate the spec before writing to disk
   */
  private preValidate(spec: SkillSpec): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Name
    if (!this.validator.isValidName(spec.name)) {
      errors.push(`Invalid skill name "${spec.name}" — must be kebab-case, 3-50 chars`);
    }

    // Description
    if (!spec.description || spec.description.length < 10) {
      errors.push('Description must be at least 10 characters');
    }

    // Instructions
    if (!spec.instructions || spec.instructions.length < 20) {
      errors.push('Instructions must be at least 20 characters — the agent needs detailed guidance');
    }

    // Scripts
    if (spec.scripts.length === 0) {
      errors.push('At least one script is required');
    }

    for (const script of spec.scripts) {
      if (!script.filename) {
        errors.push('Each script must have a filename');
      }
      if (!script.content || script.content.length < 10) {
        errors.push(`Script "${script.filename}" is too short — at least 10 characters`);
      }
      const ext = path.extname(script.filename).toLowerCase();
      if (!['.py', '.js', '.ts', '.sh'].includes(ext)) {
        errors.push(`Script "${script.filename}" has unsupported extension — use .py, .js, .ts, or .sh`);
      }
    }

    // Tools must reference existing scripts
    for (const tool of spec.tools) {
      if (!this.validator.isValidToolName(tool.name)) {
        errors.push(`Invalid tool name "${tool.name}" — must be snake_case, 3-50 chars`);
      }
      if (!tool.description || tool.description.length < 10) {
        errors.push(`Tool "${tool.name}" needs a longer description (min 10 chars)`);
      }
      if (!tool.script) {
        errors.push(`Tool "${tool.name}" must reference a script file`);
      }
      // Check script exists in the spec
      const scriptFilename = path.basename(tool.script);
      const scriptDir = path.dirname(tool.script); // e.g., "scripts"
      if (!spec.scripts.some(s => s.filename === scriptFilename)) {
        warnings.push(`Tool "${tool.name}" references "${tool.script}" — make sure this script is included`);
      }
      // Validate parameters
      if (!tool.parameters || tool.parameters.type !== 'object') {
        errors.push(`Tool "${tool.name}" parameters.type must be "object"`);
      }
    }

    // Check for duplicate tool names
    const toolNames = spec.tools.map(t => t.name);
    const dupes = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);
    if (dupes.length > 0) {
      errors.push(`Duplicate tool names: ${[...new Set(dupes)].join(', ')}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Generate SKILL.md content from spec
   */
  private generateSkillMd(spec: SkillSpec): string {
    const lines: string[] = ['---'];

    lines.push(`name: ${spec.name}`);
    lines.push(`description: ${spec.description}`);
    lines.push(`version: "${spec.version || '1.0'}"`);
    lines.push(`author: BollaClaw-Agent`);

    if (spec.runtime) lines.push(`runtime: ${spec.runtime}`);
    if (spec.entrypoint) lines.push(`entrypoint: ${spec.entrypoint}`);

    // Dependencies
    if (spec.dependencies) {
      lines.push('dependencies:');
      if (spec.dependencies.pip && spec.dependencies.pip.length > 0) {
        lines.push('  pip:');
        for (const pkg of spec.dependencies.pip) {
          lines.push(`    - ${pkg}`);
        }
      }
      if (spec.dependencies.npm && spec.dependencies.npm.length > 0) {
        lines.push('  npm:');
        for (const pkg of spec.dependencies.npm) {
          lines.push(`    - ${pkg}`);
        }
      }
    }

    // API config
    if (spec.api) {
      lines.push('api:');
      if (spec.api.baseUrl) lines.push(`  baseUrl: ${spec.api.baseUrl}`);
      if (spec.api.authType) lines.push(`  authType: ${spec.api.authType}`);
      if (spec.api.envVars && spec.api.envVars.length > 0) {
        lines.push('  envVars:');
        for (const v of spec.api.envVars) {
          lines.push(`    - ${v}`);
        }
      }
    }

    // Triggers
    if (spec.triggers && spec.triggers.length > 0) {
      lines.push('triggers:');
      for (const t of spec.triggers) {
        lines.push(`  - ${t}`);
      }
    }

    // Tags
    if (spec.tags && spec.tags.length > 0) {
      lines.push('tags:');
      for (const t of spec.tags) {
        lines.push(`  - ${t}`);
      }
    }

    lines.push('---');
    lines.push('');
    lines.push(spec.instructions);

    return lines.join('\n');
  }
}
