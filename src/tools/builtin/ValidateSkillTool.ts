import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';
import { SkillValidator } from '../../skills/SkillValidator';
import { config } from '../../utils/config';

// ============================================================
// ValidateSkillTool — Validates an existing skill package
// ============================================================
// Runs the full validation pipeline on an installed skill and
// returns errors/warnings. Useful for debugging broken skills.
// ============================================================

export class ValidateSkillTool extends BaseTool {
  readonly name = 'validate_skill';
  readonly description = 'Validates an installed BollaClaw skill. Checks SKILL.md frontmatter, script structure, tool definitions, dependencies, and cross-references. Returns errors and warnings.';
  readonly parameters = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The skill name to validate',
      },
    },
    required: ['name'],
  };

  private validator = new SkillValidator();

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = String(args.name || '').trim().toLowerCase();

    if (!name) {
      return { output: '', error: 'Skill name is required' };
    }

    const skillsDir = config.agent.skillsDir;
    const skillDir = path.join(skillsDir, name);

    const result = this.validator.validateSkillDir(skillDir);

    const lines: string[] = [];

    if (result.valid) {
      lines.push(`✅ Skill "${name}" is valid!`);
    } else {
      lines.push(`❌ Skill "${name}" has ${result.errors.length} error(s):`);
    }

    if (result.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const err of result.errors) {
        lines.push(`  ✗ ${err}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const warn of result.warnings) {
        lines.push(`  ⚠ ${warn}`);
      }
    }

    return { output: lines.join('\n') };
  }
}
