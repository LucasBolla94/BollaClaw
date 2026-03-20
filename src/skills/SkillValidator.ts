import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ============================================================
// SkillValidator — Validates skill packages before registration
// ============================================================
// Ensures correct structure, valid YAML, proper tool definitions,
// valid scripts, and safe naming. Returns detailed error messages
// so the agent can fix issues automatically.
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  author?: string;
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
}

export interface ToolManifest {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  script: string;
  runtime?: string;
}

// Safe characters for skill names
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$/;
// Safe characters for tool names
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;
// Allowed runtimes
const VALID_RUNTIMES = ['python', 'node', 'bash'];
// Allowed parameter types
const VALID_PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
// Dangerous patterns in scripts
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /:\(\)\{.*\|.*&.*\}/,     // fork bomb
  /mkfs\./,                   // format disk
  /dd\s+if=.*of=\/dev/,     // overwrite disk
  />(\/dev\/sd|\/dev\/nvme)/, // write to raw device
  /curl.*\|\s*(ba)?sh/,     // pipe to shell
  /wget.*\|\s*(ba)?sh/,     // pipe to shell
];
// Blocked pip packages (known malicious or dangerous)
const BLOCKED_PIP = ['os-sys', 'python-binance-api-fake', 'setup-tools'];
// Max file sizes
const MAX_SCRIPT_SIZE = 100_000;  // 100KB per script
const MAX_TOOL_JSON_SIZE = 10_000; // 10KB per tool definition

export class SkillValidator {

  /**
   * Full validation of a skill directory
   */
  validateSkillDir(skillDir: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Directory exists
    if (!fs.existsSync(skillDir)) {
      return { valid: false, errors: [`Skill directory not found: ${skillDir}`], warnings };
    }

    // 2. SKILL.md exists
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      errors.push('SKILL.md not found — this file is required');
      return { valid: false, errors, warnings };
    }

    // 3. Parse and validate frontmatter
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const fmResult = this.validateFrontmatter(content);
    errors.push(...fmResult.errors);
    warnings.push(...fmResult.warnings);

    // 4. Validate scripts
    const scriptsDir = path.join(skillDir, 'scripts');
    if (fs.existsSync(scriptsDir)) {
      const scriptResult = this.validateScripts(scriptsDir);
      errors.push(...scriptResult.errors);
      warnings.push(...scriptResult.warnings);
    }

    // 5. Validate tool definitions
    const toolsDir = path.join(skillDir, 'tools');
    if (fs.existsSync(toolsDir)) {
      const toolResult = this.validateToolDefinitions(toolsDir, skillDir);
      errors.push(...toolResult.errors);
      warnings.push(...toolResult.warnings);
    }

    // 6. Validate dependencies
    if (fmResult.manifest) {
      const depResult = this.validateDependencies(fmResult.manifest);
      errors.push(...depResult.errors);
      warnings.push(...depResult.warnings);
    }

    // 7. Cross-reference: tools must point to existing scripts
    if (fs.existsSync(toolsDir) && fmResult.manifest) {
      const xrefResult = this.crossValidate(toolsDir, skillDir);
      errors.push(...xrefResult.errors);
      warnings.push(...xrefResult.warnings);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate SKILL.md frontmatter
   */
  validateFrontmatter(content: string): ValidationResult & { manifest?: SkillManifest } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Extract frontmatter
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      errors.push('SKILL.md missing YAML frontmatter (must start with --- and end with ---)');
      return { valid: false, errors, warnings };
    }

    // Parse YAML
    let manifest: SkillManifest;
    try {
      const yaml = require('js-yaml');
      manifest = yaml.load(match[1]) as SkillManifest;
    } catch (err) {
      errors.push(`YAML parsing failed: ${err}`);
      return { valid: false, errors, warnings };
    }

    if (!manifest || typeof manifest !== 'object') {
      errors.push('Frontmatter must be a YAML object with name and description');
      return { valid: false, errors, warnings };
    }

    // Required fields
    if (!manifest.name) {
      errors.push('Missing required field: name');
    } else if (!SKILL_NAME_RE.test(manifest.name)) {
      errors.push(`Invalid skill name "${manifest.name}" — must be kebab-case (a-z, 0-9, hyphens), 3-50 chars, start/end with alphanumeric`);
    }

    if (!manifest.description) {
      errors.push('Missing required field: description');
    } else if (manifest.description.length < 10) {
      warnings.push('Description is very short — a detailed description helps the agent decide when to use this skill');
    }

    // Optional field validation
    if (manifest.runtime && !VALID_RUNTIMES.includes(manifest.runtime)) {
      errors.push(`Invalid runtime "${manifest.runtime}" — must be one of: ${VALID_RUNTIMES.join(', ')}`);
    }

    if (manifest.triggers && !Array.isArray(manifest.triggers)) {
      errors.push('triggers must be an array of strings');
    }

    if (manifest.tags && !Array.isArray(manifest.tags)) {
      errors.push('tags must be an array of strings');
    }

    if (manifest.version && typeof manifest.version !== 'string') {
      warnings.push('version should be a quoted string (e.g., "1.0")');
    }

    // Content after frontmatter
    const body = content.substring(match[0].length).trim();
    if (body.length < 20) {
      warnings.push('SKILL.md body is very short — add detailed instructions for the agent');
    }

    return { valid: errors.length === 0, errors, warnings, manifest };
  }

  /**
   * Validate scripts in scripts/ directory
   */
  validateScripts(scriptsDir: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
    let hasEntrypoint = false;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const filePath = path.join(scriptsDir, entry.name);

      // Check valid extension
      if (!['.py', '.js', '.ts', '.sh'].includes(ext)) {
        warnings.push(`Unexpected file type in scripts/: ${entry.name}`);
        continue;
      }

      // Check file size
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_SCRIPT_SIZE) {
        errors.push(`Script ${entry.name} is too large (${Math.round(stat.size / 1024)}KB > 100KB max)`);
      }

      // Check for entrypoint
      if (entry.name.startsWith('main.')) hasEntrypoint = true;

      // Read content for analysis
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for dangerous patterns
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(content)) {
          errors.push(`Script ${entry.name} contains a dangerous pattern: ${pattern.source}`);
        }
      }

      // Python-specific checks
      if (ext === '.py') {
        this.validatePythonScript(content, entry.name, errors, warnings);
      }

      // Node-specific checks
      if (ext === '.js' || ext === '.ts') {
        this.validateNodeScript(content, entry.name, errors, warnings);
      }

      // Bash-specific checks
      if (ext === '.sh') {
        this.validateBashScript(content, entry.name, errors, warnings);
      }
    }

    if (entries.filter(e => e.isFile()).length > 0 && !hasEntrypoint) {
      warnings.push('No main.py/main.js/main.ts found — skill may need explicit entrypoint in frontmatter');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate Python script content
   */
  private validatePythonScript(content: string, filename: string, errors: string[], warnings: string[]): void {
    // Must read from stdin for tool communication
    if (filename.startsWith('main')) {
      if (!content.includes('sys.stdin') && !content.includes('stdin')) {
        warnings.push(`${filename}: Main script should read JSON from stdin (sys.stdin.read()) for tool integration`);
      }
      if (!content.includes('json.dumps') && !content.includes('print(')) {
        warnings.push(`${filename}: Main script should output JSON to stdout`);
      }
      if (!content.includes('if __name__')) {
        warnings.push(`${filename}: Missing "if __name__ == '__main__'" guard`);
      }
    }

    // Check for common issues
    if (content.includes('input(')) {
      errors.push(`${filename}: Do not use input() — scripts must read from stdin as JSON, not interactively`);
    }

    // Check encoding declaration for non-ASCII
    if (/[^\x00-\x7F]/.test(content) && !content.includes('# -*- coding:') && !content.includes('# coding:')) {
      warnings.push(`${filename}: Contains non-ASCII characters — consider adding "# -*- coding: utf-8 -*-"`);
    }
  }

  /**
   * Validate Node.js script content
   */
  private validateNodeScript(content: string, filename: string, errors: string[], warnings: string[]): void {
    if (filename.startsWith('main')) {
      if (!content.includes('process.stdin') && !content.includes('stdin')) {
        warnings.push(`${filename}: Main script should read JSON from process.stdin for tool integration`);
      }
      if (!content.includes('JSON.stringify') && !content.includes('console.log')) {
        warnings.push(`${filename}: Main script should output JSON to stdout`);
      }
    }

    if (content.includes('prompt(') || content.includes('readline')) {
      warnings.push(`${filename}: Avoid interactive input — scripts must read from stdin as JSON`);
    }
  }

  /**
   * Validate Bash script content
   */
  private validateBashScript(content: string, filename: string, errors: string[], warnings: string[]): void {
    if (!content.startsWith('#!/')) {
      warnings.push(`${filename}: Missing shebang line (e.g., #!/usr/bin/env bash)`);
    }

    if (content.includes('set -e') === false) {
      warnings.push(`${filename}: Consider adding "set -e" for fail-fast behavior`);
    }
  }

  /**
   * Validate tool definition JSON files
   */
  validateToolDefinitions(toolsDir: string, skillDir: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const toolNames = new Set<string>();

    const entries = fs.readdirSync(toolsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const filePath = path.join(toolsDir, entry.name);

      // Check size
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_TOOL_JSON_SIZE) {
        errors.push(`Tool definition ${entry.name} is too large (${stat.size} bytes > 10KB max)`);
        continue;
      }

      // Parse JSON
      let tool: ToolManifest;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        tool = JSON.parse(raw) as ToolManifest;
      } catch (err) {
        errors.push(`Failed to parse ${entry.name}: ${err}`);
        continue;
      }

      // Required fields
      if (!tool.name) {
        errors.push(`${entry.name}: Missing required field "name"`);
        continue;
      }

      if (!TOOL_NAME_RE.test(tool.name)) {
        errors.push(`${entry.name}: Invalid tool name "${tool.name}" — must be snake_case (a-z, 0-9, underscores), 3-50 chars`);
      }

      if (toolNames.has(tool.name)) {
        errors.push(`Duplicate tool name: "${tool.name}" — each tool must have a unique name`);
      }
      toolNames.add(tool.name);

      if (!tool.description) {
        errors.push(`${entry.name}: Missing required field "description"`);
      } else if (tool.description.length < 10) {
        warnings.push(`${entry.name}: Tool description is very short — detailed descriptions help the LLM decide when to use it`);
      }

      if (!tool.script) {
        errors.push(`${entry.name}: Missing required field "script" — must point to a script file`);
      }

      // Validate parameters schema
      if (!tool.parameters) {
        errors.push(`${entry.name}: Missing required field "parameters"`);
      } else {
        if (tool.parameters.type !== 'object') {
          errors.push(`${entry.name}: parameters.type must be "object"`);
        }
        if (!tool.parameters.properties || typeof tool.parameters.properties !== 'object') {
          errors.push(`${entry.name}: parameters.properties must be an object`);
        } else {
          // Validate each property
          for (const [propName, propDef] of Object.entries(tool.parameters.properties)) {
            const prop = propDef as Record<string, unknown>;
            if (!prop.type || !VALID_PARAM_TYPES.includes(prop.type as string)) {
              errors.push(`${entry.name}: Property "${propName}" has invalid type "${prop.type}" — valid: ${VALID_PARAM_TYPES.join(', ')}`);
            }
            if (!prop.description) {
              warnings.push(`${entry.name}: Property "${propName}" has no description`);
            }
          }

          // Validate required references valid properties
          if (tool.parameters.required) {
            if (!Array.isArray(tool.parameters.required)) {
              errors.push(`${entry.name}: parameters.required must be an array`);
            } else {
              for (const req of tool.parameters.required) {
                if (!(req in tool.parameters.properties)) {
                  errors.push(`${entry.name}: Required property "${req}" not found in properties`);
                }
              }
            }
          }
        }
      }

      // Validate runtime if specified
      if (tool.runtime && !VALID_RUNTIMES.includes(tool.runtime)) {
        errors.push(`${entry.name}: Invalid runtime "${tool.runtime}" — must be one of: ${VALID_RUNTIMES.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate dependencies
   */
  validateDependencies(manifest: SkillManifest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.dependencies) return { valid: true, errors, warnings };

    // Validate pip packages
    if (manifest.dependencies.pip) {
      for (const pkg of manifest.dependencies.pip) {
        if (typeof pkg !== 'string') {
          errors.push(`Invalid pip dependency: ${pkg} — must be a string`);
          continue;
        }
        // Check for blocked packages
        const pkgName = pkg.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].trim().toLowerCase();
        if (BLOCKED_PIP.includes(pkgName)) {
          errors.push(`Blocked pip package: ${pkgName}`);
        }
        // Warn about version pinning
        if (!pkg.includes('==') && !pkg.includes('>=') && !pkg.includes('~=')) {
          warnings.push(`pip: ${pkg} has no version constraint — consider pinning (e.g., ${pkg}>=1.0)`);
        }
      }
    }

    // Validate npm packages
    if (manifest.dependencies.npm) {
      for (const pkg of manifest.dependencies.npm) {
        if (typeof pkg !== 'string') {
          errors.push(`Invalid npm dependency: ${pkg} — must be a string`);
        }
      }
    }

    // Validate apt packages
    if (manifest.dependencies.apt) {
      for (const pkg of manifest.dependencies.apt) {
        if (typeof pkg !== 'string') {
          errors.push(`Invalid apt dependency: ${pkg} — must be a string`);
        }
      }
      warnings.push('apt dependencies require sudo — may fail in restricted environments');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Cross-validate: tool scripts exist, entrypoint exists
   */
  crossValidate(toolsDir: string, skillDir: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      try {
        const raw = fs.readFileSync(path.join(toolsDir, entry.name), 'utf-8');
        const tool = JSON.parse(raw) as ToolManifest;

        if (tool.script) {
          const scriptPath = path.resolve(skillDir, tool.script);
          if (!fs.existsSync(scriptPath)) {
            errors.push(`Tool "${tool.name}" references script "${tool.script}" which does not exist`);
          }
        }
      } catch {
        // Already reported in validateToolDefinitions
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Quick validation of a skill name
   */
  isValidName(name: string): boolean {
    return SKILL_NAME_RE.test(name);
  }

  /**
   * Quick validation of a tool name
   */
  isValidToolName(name: string): boolean {
    return TOOL_NAME_RE.test(name);
  }

  /**
   * Sanitize a skill name (convert to valid kebab-case)
   */
  sanitizeName(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Sanitize a tool name (convert to valid snake_case)
   */
  sanitizeToolName(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);
  }
}
