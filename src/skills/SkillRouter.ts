import { ILlmProvider } from '../providers/ILlmProvider';
import { Skill } from './SkillLoader';
import { logger } from '../utils/logger';

export class SkillRouter {
  constructor(private provider: ILlmProvider) {}

  async route(userMessage: string, skills: Skill[]): Promise<Skill | null> {
    if (skills.length === 0) return null;

    const skillList = skills
      .map((s) => `- name: "${s.name}" | description: "${s.description}"`)
      .join('\n');

    const systemPrompt = `You are a skill router. Your ONLY job is to decide which skill (if any) should handle the user's message.
Respond with ONLY valid JSON in this exact format: {"skillName": "skill-name-here"} or {"skillName": null}
Do not add any explanation, just the JSON.`;

    const userPrompt = `Available skills:\n${skillList}\n\nUser message: "${userMessage}"\n\nWhich skill should handle this? Return JSON only.`;

    try {
      const response = await this.provider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const raw = response.content?.trim() ?? '';
      // Extract JSON from possible markdown fences
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as { skillName: string | null };
      if (!parsed.skillName) return null;

      const skill = skills.find((s) => s.name === parsed.skillName || s.dirName === parsed.skillName);
      if (skill) {
        logger.info(`SkillRouter selected: ${skill.name}`);
      } else {
        logger.debug(`SkillRouter returned unknown skill: ${parsed.skillName}`);
      }

      return skill ?? null;
    } catch (err) {
      logger.warn(`SkillRouter failed, using no skill: ${err}`);
      return null;
    }
  }
}
