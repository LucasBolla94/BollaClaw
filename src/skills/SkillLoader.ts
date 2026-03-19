import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
}

export interface Skill extends SkillMeta {
  content: string;   // Full SKILL.md content
  dirName: string;   // Directory name
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

      const skillMdPath = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        logger.debug(`Skipping skill dir without SKILL.md: ${entry.name}`);
        continue;
      }

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const meta = this.parseFrontmatter(content);

        if (!meta?.name || !meta?.description) {
          logger.warn(`Skill ${entry.name} missing name/description in frontmatter, skipping`);
          continue;
        }

        skills.push({ ...meta, content, dirName: entry.name });
        logger.debug(`Skill loaded: ${meta.name}`);
      } catch (err) {
        logger.warn(`Failed to load skill ${entry.name}: ${err}`);
      }
    }

    logger.info(`Loaded ${skills.length} skills from ${this.skillsDir}`);
    return skills;
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
}
