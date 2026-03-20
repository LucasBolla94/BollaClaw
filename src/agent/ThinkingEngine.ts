import { ILlmProvider, Message, ToolDefinition } from '../providers/ILlmProvider';
import { logger } from '../utils/logger';

// ============================================================
// ThinkingEngine — Enhanced reasoning for the BollaClaw agent
// ============================================================
// Implements multiple reasoning strategies:
//   1. PLAN: Generate execution plan before acting
//   2. REFLECT: Self-critique after results
//   3. ADAPTIVE: Choose strategy based on task complexity
//
// Inspired by:
//   - Claude Code's interleaved thinking
//   - ReAct (Reasoning + Acting)
//   - Pre-Act (Plan → Execute → Refine)
//   - OpenClaw's extended thinking levels
// ============================================================

export type ThinkingMode = 'minimal' | 'standard' | 'deep' | 'adaptive';

export interface ThinkingConfig {
  /** How much thinking to do (default: adaptive) */
  mode: ThinkingMode;
  /** Whether to generate a plan before execution */
  planFirst: boolean;
  /** Whether to reflect/self-critique after tool results */
  reflectAfterTools: boolean;
  /** Max planning tokens (rough guide for LLM) */
  planBudget: number;
}

export interface ExecutionPlan {
  /** The overall approach/strategy */
  strategy: string;
  /** Ordered steps to execute */
  steps: PlanStep[];
  /** Key risks or things to watch out for */
  risks: string[];
  /** Success criteria */
  successCriteria: string;
}

export interface PlanStep {
  id: number;
  action: string;
  tool?: string;
  reasoning: string;
  dependsOn?: number[];
}

export interface ReflectionResult {
  /** Quality assessment (1-10) */
  quality: number;
  /** What went well */
  strengths: string[];
  /** What could be improved */
  improvements: string[];
  /** Should we retry or continue? */
  decision: 'continue' | 'retry' | 'adjust_plan';
  /** Adjusted approach if decision is adjust_plan */
  adjustment?: string;
}

// Complexity indicators for adaptive mode
const COMPLEX_INDICATORS = [
  /\b(analise|analisa|analyze|research|pesquise|pesquisa)\b/i,
  /\b(crie|criar|create|build|construa|implemente|implement)\b/i,
  /\b(compare|comparar|versus|vs)\b/i,
  /\b(explique|explain|detalhe|detail)\b.*\b(como|how|por que|why)\b/i,
  /\b(otimize|optimize|melhore|improve)\b/i,
  /\b(debug|fix|corrija|resolva|solve)\b/i,
  /\b(planeje|plan|estratégia|strategy)\b/i,
  /\b(e depois|then|em seguida|next)\b/i, // Multi-step indicators
];

const SIMPLE_INDICATORS = [
  /^(oi|olá|hey|hi|hello)\b/i,
  /^(sim|não|yes|no|ok|obrigado|thanks)\b/i,
  /\b(que horas|what time|data|date)\b/i,
  /\b(quem é|who is|o que é|what is)\b/i,
];

export class ThinkingEngine {
  private config: ThinkingConfig;

  constructor(config?: Partial<ThinkingConfig>) {
    this.config = {
      mode: config?.mode ?? 'adaptive',
      planFirst: config?.planFirst ?? true,
      reflectAfterTools: config?.reflectAfterTools ?? true,
      planBudget: config?.planBudget ?? 500,
    };
  }

  /**
   * Determine thinking depth based on message complexity
   */
  assessComplexity(userMessage: string): ThinkingMode {
    if (this.config.mode !== 'adaptive') {
      return this.config.mode;
    }

    const msg = userMessage.trim();

    // Simple messages → minimal thinking
    if (msg.length < 30 || SIMPLE_INDICATORS.some(r => r.test(msg))) {
      return 'minimal';
    }

    // Count complexity indicators
    const complexCount = COMPLEX_INDICATORS.filter(r => r.test(msg)).length;

    // Multi-sentence or long messages are likely complex
    const sentenceCount = msg.split(/[.!?]+/).filter(s => s.trim().length > 5).length;

    if (complexCount >= 3 || sentenceCount >= 3 || msg.length > 300) {
      return 'deep';
    }

    if (complexCount >= 1 || sentenceCount >= 2 || msg.length > 100) {
      return 'standard';
    }

    return 'minimal';
  }

  /**
   * Generate a planning prompt that makes the agent think before acting
   */
  buildPlanningPrompt(
    userMessage: string,
    thinkingMode: ThinkingMode,
    availableTools: string[]
  ): string {
    if (thinkingMode === 'minimal') {
      return ''; // No planning needed
    }

    const toolList = availableTools.length > 0
      ? `\nFerramentas disponíveis: ${availableTools.join(', ')}`
      : '';

    if (thinkingMode === 'standard') {
      return `
<thinking>
Antes de responder, pense brevemente:
1. O que exatamente o usuário está pedindo?
2. Preciso usar alguma ferramenta?
3. Qual a melhor abordagem?${toolList}
</thinking>`;
    }

    // Deep thinking
    return `
<thinking>
Antes de agir, analise cuidadosamente:

## 1. Compreensão
- O que exatamente o usuário quer?
- Quais são os requisitos implícitos?
- Existe ambiguidade que precisa ser resolvida?

## 2. Planejamento
- Quais passos são necessários?
- Quais ferramentas usar e em que ordem?
- Existem dependências entre os passos?

## 3. Riscos
- O que pode dar errado?
- Como tratar erros?
- Preciso verificar algo antes de agir?

## 4. Abordagem
- Qual a estratégia mais eficiente?
- Posso paralelizar algo?
- Qual o critério de sucesso?
${toolList}
</thinking>`;
  }

  /**
   * Generate a reflection prompt after tool execution
   */
  buildReflectionPrompt(
    originalTask: string,
    toolResults: Array<{ tool: string; result: string; success: boolean }>,
    thinkingMode: ThinkingMode
  ): string {
    if (thinkingMode === 'minimal' || !this.config.reflectAfterTools) {
      return '';
    }

    const resultsSummary = toolResults.map(r => {
      const status = r.success ? '✅' : '❌';
      return `${status} ${r.tool}: ${r.result.substring(0, 200)}`;
    }).join('\n');

    if (thinkingMode === 'standard') {
      return `
<reflection>
Os resultados das ferramentas estão corretos e completos?
${resultsSummary}

Preciso fazer mais alguma coisa ou posso dar a resposta final?
</reflection>`;
    }

    // Deep reflection
    return `
<reflection>
## Avaliação dos Resultados

Tarefa original: ${originalTask.substring(0, 200)}

Resultados obtidos:
${resultsSummary}

## Checklist de Qualidade
- [ ] Os resultados respondem completamente à pergunta?
- [ ] Há erros ou inconsistências?
- [ ] Preciso de mais informações?
- [ ] A resposta será clara e útil para o usuário?
- [ ] Estou dando a resposta no formato/idioma correto?

## Decisão
Baseado na análise: devo [continuar / ajustar / finalizar]
</reflection>`;
  }

  /**
   * Enhance the system prompt with thinking instructions
   */
  enhanceSystemPrompt(
    basePrompt: string,
    thinkingMode: ThinkingMode,
    availableTools: string[]
  ): string {
    if (thinkingMode === 'minimal') {
      return basePrompt;
    }

    const thinkingInstructions = this.getThinkingInstructions(thinkingMode);

    return `${basePrompt}

## Modo de Raciocínio: ${thinkingMode.toUpperCase()}

${thinkingInstructions}`;
  }

  /**
   * Get thinking instructions based on mode
   */
  private getThinkingInstructions(mode: ThinkingMode): string {
    switch (mode) {
      case 'standard':
        return `Antes de responder ou usar ferramentas:
1. Pense no que o usuário realmente precisa
2. Escolha a abordagem mais eficiente
3. Use ferramentas quando necessário
4. Verifique se sua resposta é completa

Se usar ferramentas, analise o resultado antes de responder.`;

      case 'deep':
        return `Você está no modo de raciocínio profundo. Siga este processo:

### ANTES de agir:
- Analise a tarefa em detalhes
- Identifique sub-problemas
- Planeje a sequência de passos
- Considere riscos e alternativas

### DURANTE a execução:
- Use ferramentas estrategicamente
- Monitore resultados intermediários
- Ajuste o plano se necessário
- Valide cada resultado antes de avançar

### ANTES de responder:
- Verifique se todos os requisitos foram atendidos
- Confirme que a resposta é precisa e completa
- Formate a resposta de forma clara e organizada

### Princípios:
- Prefira QUALIDADE sobre velocidade
- Divida problemas complexos em partes menores
- Use múltiplas ferramentas quando necessário
- Não assuma — verifique`;

      default:
        return '';
    }
  }

  /**
   * Parse an execution plan from LLM output
   */
  parsePlan(llmOutput: string): ExecutionPlan | null {
    try {
      // Try to extract JSON plan
      const jsonMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/) ||
                         llmOutput.match(/\{[\s\S]*"steps"[\s\S]*\}/);

      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        if (plan.steps && Array.isArray(plan.steps)) {
          return plan as ExecutionPlan;
        }
      }

      // Fallback: parse numbered list
      const steps: PlanStep[] = [];
      const lines = llmOutput.split('\n');
      let stepId = 0;

      for (const line of lines) {
        const match = line.match(/^\s*(\d+)[.)]\s+(.+)/);
        if (match) {
          stepId++;
          steps.push({
            id: stepId,
            action: match[2].trim(),
            reasoning: '',
          });
        }
      }

      if (steps.length > 0) {
        return {
          strategy: 'Sequential execution',
          steps,
          risks: [],
          successCriteria: 'All steps completed successfully',
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get current config
   */
  getConfig(): ThinkingConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<ThinkingConfig>): void {
    Object.assign(this.config, updates);
    logger.info(`[ThinkingEngine] Config updated: ${JSON.stringify(this.config)}`);
  }
}
