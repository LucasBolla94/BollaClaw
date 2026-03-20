import { BaseTool } from './BaseTool';
import { CreateFileTool } from './builtin/CreateFileTool';
import { ReadFileTool } from './builtin/ReadFileTool';
import { GetDateTimeTool } from './builtin/GetDateTimeTool';
import { CreateSkillTool } from './builtin/CreateSkillTool';
import { ListSkillsTool } from './builtin/ListSkillsTool';
import { DeleteSkillTool } from './builtin/DeleteSkillTool';
import { ValidateSkillTool } from './builtin/ValidateSkillTool';
import { ShellTool, CodeRunnerTool } from './builtin/ShellTool';
import { ToolDefinition } from '../providers/ILlmProvider';
import { logger } from '../utils/logger';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    // Register built-in tools
    this.register(new CreateFileTool());
    this.register(new ReadFileTool());
    this.register(new GetDateTimeTool());

    // Skill management tools
    this.register(new CreateSkillTool());
    this.register(new ListSkillsTool());
    this.register(new DeleteSkillTool());
    this.register(new ValidateSkillTool());

    // Sandbox execution tools
    this.register(new ShellTool());
    this.register(new CodeRunnerTool());

    logger.info(`ToolRegistry initialized with ${this.tools.size} built-in tools`);
  }

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.toDefinition());
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
