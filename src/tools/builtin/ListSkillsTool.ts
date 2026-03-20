import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';
import { config } from '../../utils/config';

// ============================================================
// ListSkillsTool — Lists all installed skills and their status
// ============================================================

export class ListSkillsTool extends BaseTool {
  readonly name = 'list_skills';
  readonly description = 'Lists all installed BollaClaw skills with their tools, scripts, runtime, triggers, and dependencies. Use to check what skills exist before creating a new one.';
  readonly parameters = {
    type: 'object',
    properties: {
      verbose: {
        type: 'boolean',
        description: 'If true, show full details including file lists and dependency info. Default: false.',
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const verbose = Boolean(args.verbose);
    const skillsDir = config.agent.skillsDir;

    if (!fs.existsSync(skillsDir)) {
      return { output: 'No skills directory found. Skills dir: ' + skillsDir };
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) continue;

      // Read frontmatter
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

      let meta: Record<string, unknown> = {};
      if (fmMatch) {
        try {
          const yaml = require('js-yaml');
          meta = yaml.load(fmMatch[1]) || {};
        } catch { /* skip */ }
      }

      const name = String(meta.name || entry.name);
      const desc = String(meta.description || '(no description)');
      const runtime = String(meta.runtime || 'auto');
      const triggers = Array.isArray(meta.triggers) ? meta.triggers : [];

      // Count scripts and tools
      const scriptsDir = path.join(skillDir, 'scripts');
      const toolsDir = path.join(skillDir, 'tools');
      const scripts = fs.existsSync(scriptsDir)
        ? fs.readdirSync(scriptsDir).filter(f => /\.(py|js|ts|sh)$/.test(f))
        : [];
      const tools = fs.existsSync(toolsDir)
        ? fs.readdirSync(toolsDir).filter(f => f.endsWith('.json'))
        : [];

      if (verbose) {
        const lines = [
          `📦 ${name} (v${meta.version || '?'})`,
          `   ${desc}`,
          `   Runtime: ${runtime} | Scripts: ${scripts.length} | Tools: ${tools.length}`,
        ];
        if (triggers.length > 0) lines.push(`   Triggers: ${triggers.join(', ')}`);
        if (scripts.length > 0) lines.push(`   Scripts: ${scripts.join(', ')}`);
        if (tools.length > 0) {
          // Read tool names
          const toolNames: string[] = [];
          for (const tf of tools) {
            try {
              const raw = JSON.parse(fs.readFileSync(path.join(toolsDir, tf), 'utf-8'));
              toolNames.push(raw.name || tf);
            } catch {
              toolNames.push(tf);
            }
          }
          lines.push(`   Tools: ${toolNames.join(', ')}`);
        }
        const deps = meta.dependencies as Record<string, string[]> | undefined;
        if (deps) {
          const depList: string[] = [];
          if (deps.pip) depList.push(`pip: ${deps.pip.join(', ')}`);
          if (deps.npm) depList.push(`npm: ${deps.npm.join(', ')}`);
          if (depList.length > 0) lines.push(`   Deps: ${depList.join(' | ')}`);
        }
        skills.push(lines.join('\n'));
      } else {
        skills.push(`• ${name}: ${desc} [${runtime}, ${scripts.length} scripts, ${tools.length} tools]`);
      }
    }

    if (skills.length === 0) {
      return { output: 'No skills installed.' };
    }

    return {
      output: `Installed Skills (${skills.length}):\n\n${skills.join('\n\n')}`,
    };
  }
}
