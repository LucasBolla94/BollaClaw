import { ILlmProvider } from '../providers/ILlmProvider';
import { Skill } from './SkillLoader';
import { logger } from '../utils/logger';

export class SkillRouter {
  constructor(private provider: ILlmProvider) {}

  async route(userMessage: string, skills: Skill[]): Promise<Skill | null> {
    if (skills.length === 0) return null;

    // Phase 1: Fast local trigger matching (no LLM call)
    const triggerMatch = this.matchByTriggers(userMessage, skills);
    if (triggerMatch) {
      logger.info(`SkillRouter: trigger match → ${triggerMatch.name}`);
      return triggerMatch;
    }

    // Phase 2: LLM-based semantic routing
    return this.routeWithLlm(userMessage, skills);
  }

  /**
   * Fast keyword/trigger matching — avoids an LLM call for obvious matches
   */
  private matchByTriggers(userMessage: string, skills: Skill[]): Skill | null {
    const messageLower = userMessage.toLowerCase();

    let bestMatch: Skill | null = null;
    let bestScore = 0;

    for (const skill of skills) {
      const triggers = skill.triggers ?? [];
      if (triggers.length === 0) continue;

      let score = 0;
      for (const trigger of triggers) {
        if (messageLower.includes(trigger.toLowerCase())) {
          score++;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = skill;
      }
    }

    // Require at least 1 trigger match
    return bestScore > 0 ? bestMatch : null;
  }

  /**
   * LLM-based routing for when triggers don't match
   */
  private async routeWithLlm(userMessage: string, skills: Skill[]): Promise<Skill | null> {
    const skillList = skills
      .map((s) => {
        const parts = [`- name: "${s.name}" | description: "${s.description}"`];
        if (s.tags && s.tags.length > 0) {
          parts.push(`  tags: ${s.tags.join(', ')}`);
        }
        if (s.isExecutable) {
          parts.push(`  type: executable (has scripts/tools)`);
        }
        return parts.join('\n');
      })
      .join('\n');

    const systemPrompt = `You are a skill router. Your ONLY job is to decide which skill (if any) should handle the user's message.

Rules:
- Choose the skill that BEST matches the user's intent
- If NO skill is a good match, return null
- Consider the skill description, tags, and whether it's executable
- Respond with ONLY valid JSON: {"skillName": "skill-name-here"} or {"skillName": null}
- No explanation, just JSON.`;

    const userPrompt = `Available skills:\n${skillList}\n\nUser message: "${userMessage}"\n\nWhich skill should handle this? JSON only.`;

    try {
      const response = await this.provider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const raw = response.content?.trim() ?? '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as { skillName: string | null };
      if (!parsed.skillName) return null;

      const skill = skills.find(
        (s) => s.name === parsed.skillName || s.dirName === parsed.skillName
      );

      if (skill) {
        logger.info(`SkillRouter: LLM selected → ${skill.name}`);
      } else {
        logger.debug(`SkillRouter: LLM returned unknown skill: ${parsed.skillName}`);
      }

      return skill ?? null;
    } catch (err) {
      logger.warn(`SkillRouter failed, using no skill: ${err}`);
      return null;
    }
  }
}
