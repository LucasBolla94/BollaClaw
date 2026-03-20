import { BaseTool, ToolResult } from './BaseTool';
import { SkillExecutor } from '../skills/SkillExecutor';
import { SkillToolDefinition } from '../skills/SkillLoader';
import { logger } from '../utils/logger';
import * as path from 'path';

/**
 * ScriptTool v2 — dynamically wraps a skill's script as a callable tool.
 *
 * Improvements:
 *   - If the script returns JSON with "message" field, that's used as output
 *   - [FILE:path] tags in output are preserved for TelegramOutputHandler
 *   - Better error extraction from JSON responses
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
        timeout: 60_000, // 60s for document generation
      }
    );

    if (result.error) {
      logger.warn(`[ScriptTool:${this.name}] Error: ${result.error}`);
      return {
        output: '',
        error: result.error,
      };
    }

    // Parse output
    let output = result.stdout.trim();

    // Try to parse JSON response from script
    try {
      const parsed = JSON.parse(output);

      if (parsed.error) {
        logger.warn(`[ScriptTool:${this.name}] Script returned error: ${parsed.error}`);
        return { output: '', error: parsed.error };
      }

      // If script returns a "message" field, use it as the primary output
      // This is important for [FILE:path] propagation
      if (parsed.message) {
        output = parsed.message;

        // Append extra context if available
        const extras: string[] = [];
        if (parsed.filepath) extras.push(`Path: ${parsed.filepath}`);
        if (parsed.size_bytes) extras.push(`Size: ${parsed.size_bytes} bytes`);
        if (parsed.rows !== undefined) extras.push(`Rows: ${parsed.rows}`);
        if (parsed.columns !== undefined) extras.push(`Columns: ${parsed.columns}`);

        if (extras.length > 0) {
          output += '\n' + extras.join(' | ');
        }
      }
    } catch {
      // Not JSON — use raw stdout as output (normal for non-JSON scripts)
    }

    if (result.stderr.trim()) {
      output += `\n[stderr]: ${result.stderr.trim()}`;
    }

    logger.info(`[ScriptTool:${this.name}] Completed in ${result.duration}ms`);
    return { output };
  }
}
