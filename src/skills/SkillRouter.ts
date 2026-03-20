import { Skill } from './SkillLoader';
import { logger } from '../utils/logger';

// ============================================================
// SkillRouter v2 — OpenClaw-style: No triggers, no extra LLM call
// ============================================================
// Instead of routing to a single skill, we inject ALL eligible
// skills as a compact XML list into the system prompt. The main
// LLM decides which skill to use based on descriptions.
//
// This approach:
//   1. Costs ZERO extra LLM calls (no router call)
//   2. Is more accurate (main LLM sees full context + skills)
//   3. Allows multi-skill usage in one conversation
//   4. Is simpler to maintain
// ============================================================

export class SkillRouter {
  /**
   * Format all eligible skills as XML for system prompt injection.
   * The model reads this list and decides which skill to invoke.
   *
   * Format:
   * <available_skills>
   *   <skill>
   *     <name>document-creator</name>
   *     <description>Creates PDF, DOCX, XLSX documents</description>
   *     <tools>create_pdf, create_docx, create_xlsx</tools>
   *   </skill>
   *   ...
   * </available_skills>
   */
  static formatSkillsForPrompt(skills: Skill[]): string {
    if (skills.length === 0) return '';

    const skillEntries = skills
      .filter(s => !s.disableModelInvocation)  // Respect opt-out flag
      .map(skill => {
        const toolList = skill.tools.length > 0
          ? `\n    <tools>${skill.tools.map(t => t.name).join(', ')}</tools>`
          : '';

        return `  <skill>
    <name>${escapeXml(skill.name)}</name>
    <description>${escapeXml(skill.description)}</description>${toolList}
    <location>${escapeXml(skill.dirPath)}</location>
  </skill>`;
      });

    if (skillEntries.length === 0) return '';

    logger.debug(`SkillRouter: ${skillEntries.length} skills formatted for prompt`);

    return `\n<available_skills>
${skillEntries.join('\n')}
</available_skills>`;
  }

  /**
   * Build the full skill instructions prompt for a specific skill.
   * Called when the model decides to use a skill — the skill's full
   * SKILL.md content is injected as context.
   */
  static buildSkillInstructions(skill: Skill): string {
    let prompt = `\n\n## Active Skill: ${skill.name}\n\n`;
    prompt += skill.content;

    if (skill.isExecutable) {
      prompt += `\n\n### Execution\n`;
      prompt += `This skill has executable scripts (runtime: ${skill.runtime ?? 'auto'}).\n`;

      if (skill.tools.length > 0) {
        prompt += `\nAvailable tools from this skill:\n`;
        for (const tool of skill.tools) {
          prompt += `- **${tool.name}**: ${tool.description}\n`;
        }
        prompt += `\nUse these tools when the task requires them. They execute real scripts on the server.\n`;
      }

      if (skill.api?.baseUrl) {
        prompt += `\nAPI base: ${skill.api.baseUrl}\n`;
      }
    }

    return prompt;
  }
}

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
