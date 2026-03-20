import { logger } from '../utils/logger';

// ============================================================
// HallucinationDetector — Catches LLM claiming actions it didn't take
// ============================================================
// Detects when the LLM says "I created the file" or "here's the PDF"
// without actually having called any tool. Returns a correction prompt
// that forces the LLM to actually use the tool on the next iteration.
//
// Inspired by OpenClaw's zero-trust approach: tool execution is the
// ONLY proof that an action was taken. Text claims are not evidence.
// ============================================================

export interface HallucinationResult {
  detected: boolean;
  reason: string;
  correctionPrompt: string;
}

// Patterns that indicate the LLM is CLAIMING to create/send a file
// without actually having called a tool
const FILE_HALLUCINATION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Claims file was created
  { pattern: /(?:aqui está|aqui esta|pronto|segue|criado|gerado|preparado)[^.]{0,40}(?:pdf|docx?|xlsx?|arquivo|documento|planilha|apresenta)/i, description: 'claims file was created/delivered' },
  { pattern: /(?:o|seu|um)\s+(?:pdf|docx?|xlsx?|arquivo|documento|planilha)\s+(?:foi|está|esta|já)\s+(?:criado|gerado|pronto)/i, description: 'claims file is ready' },

  // Claims to be sending/attaching a file
  { pattern: /(?:enviar?|mandar?|envio|mando|anexo|anexando)\s+(?:o|um|seu|este)\s+(?:pdf|docx?|xlsx?|arquivo|documento)/i, description: 'claims to be sending a file' },
  { pattern: /(?:aqui|segue)\s+(?:o|seu|um)\s+(?:pdf|docx?|xlsx?|arquivo|documento)/i, description: 'claims "here is the file"' },

  // Describes what tool it would use (instead of using it)
  { pattern: /(?:preciso|vou|devo|posso)\s+(?:usar|utilizar|chamar)\s+(?:a|o)?\s*(?:função|ferramenta|tool|create_)/i, description: 'describes tool it would use instead of using it' },
  { pattern: /(?:usando|com)\s+(?:a|o)?\s*(?:função|ferramenta|tool)\s+`?create_/i, description: 'narrates tool usage without calling' },

  // Shows the function/tool name in backticks without calling it
  { pattern: /`create_(?:pdf|docx|xlsx|file)`/i, description: 'mentions tool name in backticks' },

  // Says "I'll create" without having done it
  { pattern: /(?:vou criar|vou gerar|vou preparar|criando|gerando)\s+(?:o|um|seu)?\s*(?:pdf|docx?|xlsx?|arquivo|documento)/i, description: 'says will create but didnt' },
];

// Patterns that indicate a file delivery claim without [FILE:] tag
const DELIVERY_WITHOUT_FILE_TAG: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\[FILE:[^\]]+\]/, description: 'has FILE tag' }, // This is GOOD — not a hallucination
];

// Patterns for tool name mentions (the LLM talks about tools instead of using them)
const TOOL_NARRATION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /"name"\s*:\s*"(create_\w+)"/, description: 'raw JSON tool mention' },
  { pattern: /\{"type"\s*:\s*"function"/, description: 'raw function call JSON in text' },
];

/**
 * Detect if the LLM response is hallucinating tool usage.
 *
 * @param response - The LLM's text response
 * @param availableTools - List of registered tool names
 * @param toolCallsExecuted - Number of tools actually called this loop
 * @returns HallucinationResult with detection status and correction prompt
 */
export function detectHallucination(
  response: string,
  availableTools: string[],
  toolCallsExecuted: number
): HallucinationResult {
  const noResult: HallucinationResult = { detected: false, reason: '', correctionPrompt: '' };

  if (!response || response.trim().length < 10) return noResult;

  // If the response has a [FILE:] tag, it's likely legitimate (tool was called in a previous iteration)
  if (DELIVERY_WITHOUT_FILE_TAG[0].pattern.test(response)) {
    return noResult;
  }

  // Check for raw tool call JSON in the response text (LLM outputting tool calls as text)
  for (const { pattern, description } of TOOL_NARRATION_PATTERNS) {
    if (pattern.test(response)) {
      logger.info(`[HallucinationDetector] Raw tool JSON detected: ${description}`);
      return {
        detected: true,
        reason: `Raw tool call JSON in text: ${description}`,
        correctionPrompt: `ERRO: Você acabou de escrever um JSON de tool call como texto em vez de realmente chamar a ferramenta. NÃO escreva JSON de ferramentas na resposta. Use a ferramenta NATIVAMENTE através do mecanismo de function calling. Tente novamente: chame a ferramenta correta agora.`,
      };
    }
  }

  // Check for file creation/delivery hallucination
  // Only flag if no tools were actually called in this iteration
  for (const { pattern, description } of FILE_HALLUCINATION_PATTERNS) {
    if (pattern.test(response)) {
      // Build list of file-related tools
      const fileTools = availableTools
        .filter(t => t.startsWith('create_') || t === 'create_file')
        .join(', ');

      logger.info(`[HallucinationDetector] File hallucination: ${description} (tools executed: ${toolCallsExecuted})`);

      return {
        detected: true,
        reason: `File hallucination: ${description}`,
        correctionPrompt: `ERRO CRÍTICO: Você afirmou ter criado ou enviado um arquivo, mas NÃO chamou nenhuma ferramenta para criá-lo. Isso é uma alucinação.

VOCÊ DEVE:
1. Chamar a ferramenta apropriada AGORA (${fileTools || 'create_file, create_pdf, create_docx, create_xlsx'})
2. Passar os parâmetros corretos (título, conteúdo, etc.)
3. SÓ DEPOIS de receber o resultado da ferramenta, informe o usuário
4. Inclua [FILE:caminho_retornado] na resposta para entregar o arquivo

NÃO descreva o que vai fazer. FAÇA. Chame a ferramenta agora.`,
      };
    }
  }

  return noResult;
}
