import { BaseTool, ToolResult } from './BaseTool';
import { SkillExecutor } from '../skills/SkillExecutor';
import { SkillToolDefinition } from '../skills/SkillLoader';
import { logger } from '../utils/logger';
import * as path from 'path';

/**
 * ScriptTool — dynamically wraps a skill's script as a callable tool.
 *
 * When a skill defines tools/ JSON files, each one becomes a ScriptTool
 * that the LLM can invoke during the ReAct loop. The tool executes the
 * referenced script with the LLM-provided arguments and returns the output.
 *
 * Example tool definition (tools/search.json):
 * {
 *   "name": "weather_search",
 *   "description": "Search current weather for a city",
 *   "parameters": {
 *     "type": "object",
 *     "properties": {
 *       "city": { "type": "string", "description": "City name" },
 *       "units": { "type": "string", "enum": ["metric", "imperial"], "default": "metric" }
 *     },
 *     "required": ["city"]
 *   },
 *   "script": "scripts/weather.py",
 *   "runtime": "python"
 * }
 */
export class ScriptTool extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;

  private scriptPath: string;
  private runtime: 'python' | 'node' | 'bash';
  private skillDir: string;
  private executor: SkillExecutor;

  constructor(definition: SkillToolDefinition, skillDir: string) {
    super();
    this.name = definition.name;
    this.description = definition.description;
    this.parameters = definition.parameters;
    this.scriptPath = path.resolve(skillDir, definition.script);
    this.runtime = definition.runtime ?? 'python';
    this.skillDir = skillDir;
    this.executor = new SkillExecutor();
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    logger.info(`[ScriptTool:${this.name}] Executing with args: ${JSON.stringify(args)}`);

    // Inject tool name so the script knows which tool invoked it
    const enrichedArgs = {
      ...args,
      __tool__: this.name,
    };

    const result = await this.executor.executeScript(
      this.scriptPath,
      this.runtime,
      this.skillDir,
      {
        args: enrichedArgs,
        timeout: 30_000,
      }
    );

    if (result.error) {
      logger.warn(`[ScriptTool:${this.name}] Error: ${result.error}`);
      return {
        output: '',
        error: result.error,
      };
    }

    // Combine stdout (primary output) with any stderr warnings
    let output = result.stdout.trim();
    if (result.stderr.trim()) {
      output += `\n[stderr]: ${result.stderr.trim()}`;
    }

    logger.info(`[ScriptTool:${this.name}] Completed in ${result.duration}ms`);
    return { output };
  }
}
