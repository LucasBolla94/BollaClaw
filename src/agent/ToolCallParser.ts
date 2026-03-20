import { ToolCall, ToolDefinition } from '../providers/ILlmProvider';
import { logger } from '../utils/logger';

// ============================================================
// ToolCallParser — Fallback Chain Parser (inspired by OpenClaw)
// ============================================================
// When an LLM outputs tool calls as plain text instead of using
// native function calling, this parser extracts them.
//
// Parser chain (tried in order):
//   1. JSON block parser  — ```json { "name": ..., "parameters": ... } ```
//   2. Inline JSON parser — { "name": ..., "parameters": ... }
//   3. XML parser         — <tool_call><name>...</name><parameters>...</parameters></tool_call>
//   4. Function syntax    — tool_name({"param": "value"})
// ============================================================

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Attempts to extract tool calls from plain text content.
 * Returns extracted calls + cleaned content (text without the tool call parts).
 */
export function parseToolCallsFromText(
  content: string,
  availableTools: string[]
): { calls: ParsedToolCall[]; cleanedContent: string } {
  if (!content || content.trim().length === 0) {
    return { calls: [], cleanedContent: content };
  }

  const toolSet = new Set(availableTools.map(t => t.toLowerCase()));
  let calls: ParsedToolCall[] = [];
  let cleanedContent = content;

  // ── Parser 1: JSON code blocks ──
  // Matches: ```json { "name": "tool", "parameters": {...} } ```
  // Also: ``` { "name": ... } ```
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
  let match;
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    const parsed = tryParseToolJson(match[1], toolSet);
    if (parsed) {
      calls.push(parsed);
      cleanedContent = cleanedContent.replace(match[0], '').trim();
    }
  }

  if (calls.length > 0) {
    logger.info(`[ToolCallParser] Extracted ${calls.length} tool call(s) from JSON code blocks`);
    return { calls, cleanedContent };
  }

  // ── Parser 2: Inline JSON objects ──
  // Matches: { "name": "tool_name", "parameters": {...} }
  const inlineJsonRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[\s\S]*?\})\s*\}/gi;
  while ((match = inlineJsonRegex.exec(content)) !== null) {
    const toolName = match[1];
    if (toolSet.has(toolName.toLowerCase())) {
      try {
        const args = JSON.parse(match[2]);
        calls.push({ name: toolName, arguments: args });
        cleanedContent = cleanedContent.replace(match[0], '').trim();
      } catch { /* invalid JSON, skip */ }
    }
  }

  if (calls.length > 0) {
    logger.info(`[ToolCallParser] Extracted ${calls.length} tool call(s) from inline JSON`);
    return { calls, cleanedContent };
  }

  // ── Parser 3: Alternative JSON format (arguments instead of parameters) ──
  const altJsonRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/gi;
  while ((match = altJsonRegex.exec(content)) !== null) {
    const toolName = match[1];
    if (toolSet.has(toolName.toLowerCase())) {
      try {
        const args = JSON.parse(match[2]);
        calls.push({ name: toolName, arguments: args });
        cleanedContent = cleanedContent.replace(match[0], '').trim();
      } catch { /* skip */ }
    }
  }

  if (calls.length > 0) {
    logger.info(`[ToolCallParser] Extracted ${calls.length} tool call(s) from alt JSON format`);
    return { calls, cleanedContent };
  }

  // ── Parser 4: XML format ──
  // <tool_call> or <tool_use>
  const xmlRegex = /<(?:tool_call|tool_use|function_call)>\s*(?:<name>([^<]+)<\/name>\s*<(?:parameters|arguments)>([\s\S]*?)<\/(?:parameters|arguments)>|[\s\S]*?"name"\s*:\s*"([^"]+)"[\s\S]*?"(?:parameters|arguments)"\s*:\s*(\{[\s\S]*?\})[\s\S]*?)\s*<\/(?:tool_call|tool_use|function_call)>/gi;
  while ((match = xmlRegex.exec(content)) !== null) {
    const toolName = match[1] || match[3];
    const argsStr = match[2] || match[4];
    if (toolName && toolSet.has(toolName.toLowerCase())) {
      try {
        const args = JSON.parse(argsStr);
        calls.push({ name: toolName, arguments: args });
        cleanedContent = cleanedContent.replace(match[0], '').trim();
      } catch { /* skip */ }
    }
  }

  if (calls.length > 0) {
    logger.info(`[ToolCallParser] Extracted ${calls.length} tool call(s) from XML format`);
    return { calls, cleanedContent };
  }

  // ── Parser 5: Function call syntax ──
  // Matches: tool_name({"param": "value"})
  for (const toolName of availableTools) {
    const funcRegex = new RegExp(
      `${escapeRegex(toolName)}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`,
      'gi'
    );
    while ((match = funcRegex.exec(content)) !== null) {
      try {
        const args = JSON.parse(match[1]);
        calls.push({ name: toolName, arguments: args });
        cleanedContent = cleanedContent.replace(match[0], '').trim();
      } catch { /* skip */ }
    }
  }

  if (calls.length > 0) {
    logger.info(`[ToolCallParser] Extracted ${calls.length} tool call(s) from function syntax`);
    return { calls, cleanedContent };
  }

  return { calls: [], cleanedContent: content };
}

/**
 * Try to parse a JSON string as a tool call.
 */
function tryParseToolJson(jsonStr: string, toolSet: Set<string>): ParsedToolCall | null {
  try {
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== 'object') return null;

    const name = obj.name || obj.tool || obj.function;
    const args = obj.parameters || obj.arguments || obj.args || obj.input;

    if (!name || typeof name !== 'string') return null;
    if (!toolSet.has(name.toLowerCase())) return null;

    return {
      name,
      arguments: (args && typeof args === 'object') ? args : {},
    };
  } catch {
    return null;
  }
}

/**
 * Check if text content looks like it contains a tool call.
 * Quick heuristic check before running full parsing.
 */
export function looksLikeToolCall(content: string, availableTools: string[]): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();

  // Check for common patterns
  if (lower.includes('"name"') && (lower.includes('"parameters"') || lower.includes('"arguments"'))) {
    return true;
  }
  if (lower.includes('<tool_call>') || lower.includes('<tool_use>')) {
    return true;
  }

  // Check if any tool name appears with function-call-like syntax
  for (const tool of availableTools) {
    if (lower.includes(tool.toLowerCase() + '(')) return true;
  }

  return false;
}

/**
 * Convert ParsedToolCall to ToolCall (with generated ID).
 */
export function toToolCalls(parsed: ParsedToolCall[]): ToolCall[] {
  return parsed.map((p, i) => ({
    id: `fallback_${Date.now()}_${i}`,
    name: p.name,
    arguments: p.arguments,
  }));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
