import * as fs from 'fs';
import * as path from 'path';
import { BaseTool, ToolResult } from '../BaseTool';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

// ============================================================
// DeleteSkillTool — Removes an installed skill completely
// ============================================================

export class DeleteSkillTool extends BaseTool {
  readonly name = 'delete_skill';
  readonly description = 'Deletes a BollaClaw skill by name. Removes the entire skill directory. Protected skills (_template, skill-creator) cannot be deleted. Use /reload after deletion.';
  readonly parameters = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The skill name (directory name) to delete',
      },
    },
    required: ['name'],
  };

  // Protected skills that cannot be deleted
  private static readonly PROTECTED = ['_template', 'skill-creator'];

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = String(args.name || '').trim().toLowerCase();

    if (!name) {
      return { output: '', error: 'Skill name is required' };
    }

    if (DeleteSkillTool.PROTECTED.includes(name)) {
      return { output: '', error: `Cannot delete protected skill "${name}"` };
    }

    const skillsDir = config.agent.skillsDir;
    const skillDir = path.join(skillsDir, name);

    // Prevent path traversal
    const resolved = path.resolve(skillDir);
    if (!resolved.startsWith(path.resolve(skillsDir))) {
      return { output: '', error: 'Invalid skill name (path traversal detected)' };
    }

    if (!fs.existsSync(skillDir)) {
      return { output: '', error: `Skill "${name}" not found in ${skillsDir}` };
    }

    // Check it's actually a skill (has SKILL.md)
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      return { output: '', error: `"${name}" is not a valid skill directory (no SKILL.md)` };
    }

    try {
      fs.rmSync(skillDir, { recursive: true, force: true });
      logger.info(`[DeleteSkill] Deleted skill: ${name}`);
      return {
        output: `✅ Skill "${name}" deleted successfully.\n🔄 Use /reload to update the running bot.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: '', error: `Failed to delete skill: ${msg}` };
    }
  }
}
