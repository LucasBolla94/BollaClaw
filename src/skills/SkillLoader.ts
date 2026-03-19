import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

// ============================================================
// Skill Package Structure:
// ============================================================
// .agents/skills/
//   my-skill/
//     SKILL.md            — Instructions + YAML frontmatter (required)
//     config.json         — Skill config: env vars, API endpoints (optional)
//     scripts/            — Executable scripts (optional)
//       main.py           — Python entry point
//       main.ts           — Node/TS entry point
//       helper.sh         — Bash scripts
//     tools/              — Tool definitions as JSON (optional)
//       search.json       — Custom tool that wraps a script
//     tests/              — Test files (optional)
//       test.py
//     README.md           — Developer docs (optional)
// ============================================================

export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  author?: string;
  // Execution config
  runtime?: 'python' | 'node' | 'bash';         // Default runtime for scripts
  entrypoint?: string;                            // Main script (default: scripts/main.py or scripts/main.ts)
  // Dependencies
  dependencies?: {
    pip?: string[];       // Python packages to install
    npm?: string[];       // Node packages to install
    apt?: string[];       // System packages
  };
  // API config
  api?: {
    baseUrl?: string;
    authType?: 'bearer' | 'api_key' | 'basic' | 'none';
    envVars?: string[];   // Required env vars for this skill
  };
  // Triggers — keywords/patterns for better routing
  triggers?: string[];
  // Tags for categorization
  tags?: string[];
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  script: string;         // Relative path to script from skill dir
  runtime?: 'python' | 'node' | 'bash';
}

export interface Skill extends SkillMeta {
  content: string;                    // Full SKILL.md content (instructions)
  dirName: string;                    // Directory name
  dirPath: string;                    // Full directory path
  scripts: string[];                  // List of script files found
  tools: SkillToolDefinition[];       // Custom tool definitions
  configData: Record<string, unknown>; // Loaded config.json
  isExecutable: boolean;              // Has scripts that can be run
}

export class SkillLoader {
  private skillsDir: string;

  constructor() {
    this.skillsDir = config.agent.skillsDir;
  }

  loadAll(): Skill[] {
    if (!fs.existsSync(this.skillsDir)) {
      logger.warn(`Skills directory not found: ${this.skillsDir}`);
      return [];
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(this.skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) {
        logger.debug(`Skipping skill dir without SKILL.md: ${entry.name}`);
        continue;
      }

      try {
        const skill = this.loadSkill(skillDir, entry.name);
        if (skill) {
          skills.push(skill);
          const parts = [
            `${skill.name}`,
            skill.isExecutable ? `[executable:${skill.runtime ?? 'auto'}]` : '[prompt-only]',
            skill.tools.length > 0 ? `[${skill.tools.length} tools]` : '',
            skill.scripts.length > 0 ? `[${skill.scripts.length} scripts]` : '',
          ];
          logger.info(`Skill loaded: ${parts.filter(Boolean).join(' ')}`);
        }
      } catch (err) {
        logger.warn(`Failed to load skill ${entry.name}: ${err}`);
      }
    }

    logger.info(`Loaded ${skills.length} skills from ${this.skillsDir}`);
    return skills;
  }

  private loadSkill(skillDir: string, dirName: string): Skill | null {
    // 1. Read and parse SKILL.md
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const meta = this.parseFrontmatter(content);

    if (!meta?.name || !meta?.description) {
      logger.warn(`Skill ${dirName} missing name/description in frontmatter`);
      return null;
    }

    // 2. Discover scripts
    const scriptsDir = path.join(skillDir, 'scripts');
    const scripts = this.discoverFiles(scriptsDir, ['.py', '.ts', '.js', '.sh']);

    // 3. Load tool definitions
    const toolsDir = path.join(skillDir, 'tools');
    const tools = this.loadToolDefinitions(toolsDir);

    // 4. Load config.json
    const configPath = path.join(skillDir, 'config.json');
    let configData: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      try {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (err) {
        logger.warn(`Failed to parse config.json for skill ${dirName}: ${err}`);
      }
    }

    // 5. Determine if executable
    const isExecutable = scripts.length > 0 || tools.length > 0;

    // 6. Auto-detect runtime if not specified
    let runtime = meta.runtime;
    if (!runtime && scripts.length > 0) {
      const firstScript = scripts[0];
      if (firstScript.endsWith('.py')) runtime = 'python';
      else if (firstScript.endsWith('.ts') || firstScript.endsWith('.js')) runtime = 'node';
      else if (firstScript.endsWith('.sh')) runtime = 'bash';
    }

    return {
      ...meta,
      runtime,
      content,
      dirName,
      dirPath: skillDir,
      scripts,
      tools,
      configData,
      isExecutable,
    };
  }

  private parseFrontmatter(content: string): SkillMeta | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;

    try {
      return yaml.load(match[1]) as SkillMeta;
    } catch {
      return null;
    }
  }

  private discoverFiles(dir: string, extensions: string[]): string[] {
    if (!fs.existsSync(dir)) return [];

    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(path.join(dir, entry.name));
        }
      }
    }

    return files;
  }

  private loadToolDefinitions(toolsDir: string): SkillToolDefinition[] {
    if (!fs.existsSync(toolsDir)) return [];

    const tools: SkillToolDefinition[] = [];
    const entries = fs.readdirSync(toolsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      try {
        const raw = fs.readFileSync(path.join(toolsDir, entry.name), 'utf-8');
        const def = JSON.parse(raw) as SkillToolDefinition;

        if (def.name && def.description && def.script) {
          tools.push(def);
        } else {
          logger.warn(`Tool definition ${entry.name} missing required fields (name, description, script)`);
        }
      } catch (err) {
        logger.warn(`Failed to parse tool definition ${entry.name}: ${err}`);
      }
    }

    return tools;
  }

  /**
   * Install skill dependencies (pip, npm, apt)
   */
  async installDependencies(skill: Skill): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const deps = skill.dependencies;
    if (!deps) return;

    if (deps.pip && deps.pip.length > 0) {
      logger.info(`Installing pip dependencies for ${skill.name}: ${deps.pip.join(', ')}`);
      try {
        await execAsync(`pip3 install ${deps.pip.join(' ')} --break-system-packages 2>/dev/null || pip3 install ${deps.pip.join(' ')}`);
      } catch (err) {
        logger.error(`Failed to install pip deps for ${skill.name}: ${err}`);
      }
    }

    if (deps.npm && deps.npm.length > 0) {
      logger.info(`Installing npm dependencies for ${skill.name}: ${deps.npm.join(', ')}`);
      try {
        await execAsync(`npm install ${deps.npm.join(' ')}`);
      } catch (err) {
        logger.error(`Failed to install npm deps for ${skill.name}: ${err}`);
      }
    }

    if (deps.apt && deps.apt.length > 0) {
      logger.info(`Installing apt dependencies for ${skill.name}: ${deps.apt.join(', ')}`);
      try {
        await execAsync(`sudo apt install -y ${deps.apt.join(' ')}`);
      } catch (err) {
        logger.error(`Failed to install apt deps for ${skill.name}: ${err}`);
      }
    }
  }
}
