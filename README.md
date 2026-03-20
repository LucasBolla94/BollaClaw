<p align="center">
  <img src="https://img.shields.io/badge/BollaClaw-AI%20Agent-blueviolet?style=for-the-badge&logo=telegram" alt="BollaClaw" />
  <img src="https://img.shields.io/badge/TypeScript-Node.js-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT" />
</p>

<h1 align="center">🤖 BollaClaw</h1>

<p align="center">
  <strong>Agente AI pessoal via Telegram com personalidade adaptativa, memória semântica de longo prazo e sistema de skills extensível.</strong>
</p>

<p align="center">
  Multi-LLM · Soul Engine · Semantic Memory · Auto-Update · Web Panel · Zero-GPU Embeddings
</p>

---

## Visão Geral

BollaClaw é um agente de inteligência artificial que roda em servidores Ubuntu dedicados e se comunica via Telegram. Diferente de bots comuns, ele possui personalidade própria (configurável via conversa), memória semântica de longo prazo com embeddings locais, suporte a múltiplos provedores LLM com fallback automático, e um painel web completo para monitoramento.

O sistema foi projetado para ser **econômico em tokens** — usa heurísticas locais para extração de memória, busca semântica inteligente que só ativa quando necessário, e embeddings ONNX rodando localmente sem GPU.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         TELEGRAM                                │
│   Usuário ──► TelegramInputHandler ──► AgentController          │
│                                            │                    │
│                        ┌───────────────────┼──────────────┐     │
│                        │                   │              │     │
│                   SoulEngine        SkillRouter      MemoryMgr  │
│                   (identidade)      (roteamento)     (curto +   │
│                        │                   │          longo     │
│                   SoulBootstrap      AgentLoop        prazo)    │
│                   (setup via chat)   (ReAct loop)        │      │
│                                            │         Semantic   │
│                                       ToolRegistry   Store      │
│                                            │         (SQLite +  │
│                                       LLM Provider    ONNX)     │
│                                       (Claude/Gemini/           │
│                                        DeepSeek/Groq)           │
│                                            │                    │
│               TelegramOutputHandler ◄──────┘                    │
│                        │                                        │
│                   Usuário ◄──                                   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Web Panel   │  │ Auto-Updater │  │  Telemetry   │
│  (Express)   │  │  (Git+PM2)   │  │ (BollaWatch) │
│  :21086      │  │  cada 5min   │  │  :21087      │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Features

### 🧠 Soul Engine — Personalidade Adaptativa
- Setup conversacional no primeiro contato (sem arquivos para editar)
- Personality traits ajustáveis (formalidade, humor, verbosidade, empatia, criatividade, etc.)
- 4 presets: casual, profissional, técnico, criativo
- Aprendizado adaptivo — aprende preferências do dono ao longo do tempo
- Gera automaticamente `SOUL.md` legível para humanos

### 💾 Memória Semântica de Longo Prazo
- Embeddings locais via ONNX (modelo `bge-small-en-v1.5`, 384 dims, ~33MB)
- **Zero GPU** — roda em CPU, zero custo de API
- SQLite como vector store (embeddings armazenados como BLOB)
- Busca híbrida: 70% similaridade cosseno + 30% BM25 keyword
- Smart gate — só busca quando heurísticas detectam necessidade
- Extração zero-cost — regex patterns para preferências, fatos, instruções (sem usar LLM)
- Deduplicação SHA-256
- Budget de tokens: máximo 2000 tokens por consulta

### 🤖 Multi-LLM com Fallback
- **Anthropic** (Claude) — provider principal
- **Google** (Gemini) — fallback
- **DeepSeek** — alternativa econômica
- **Groq** — inferência ultra-rápida
- **OpenRouter, xAI** — via OpenAI-compatible
- Fallback automático: se o provider principal falhar, tenta os próximos
- Router provider separado (Groq) para roteamento de skills (econômico)

### 🔧 Skills & Tools
- Hot-reload sem restart (`/reload` no Telegram)
- Estrutura modular: `SKILL.md` + `scripts/` + `tools/`
- Suporte a Python, Node.js e Bash scripts
- Auto-instalação de dependências (pip, npm, apt)
- Tools built-in: `create_file`, `read_file`, `get_datetime`

### 🎤 Voz (STT/TTS)
- Speech-to-text via Groq Whisper API
- Text-to-speech via Edge-TTS
- Detecção automática de quando responder com áudio

### 📄 Documentos
- Leitura de PDFs enviados no Telegram
- Processamento de arquivos Markdown e texto

### 🌐 Web Panel
- Dashboard com métricas em tempo real (CPU, RAM, disco, uptime)
- Visualizador de conversas com histórico de mensagens
- Monitor de logs com filtro por nível
- Painel Soul com visualização de traits
- Estatísticas de memória
- Ações rápidas: reload skills, restart, change password
- Autenticação PBKDF2 (100K iterações, SHA-512)
- Rate limiting: 5 tentativas por IP, lockout de 15min
- Dark theme

### 🔄 Auto-Update
- Verifica GitHub a cada 5 minutos
- Pull + build + restart automático via PM2
- Rollback automático em caso de falha (`git reset --hard`)

### 📊 Telemetria (BollaWatch)
- Envio de métricas para hub centralizado
- Batching: 50 eventos ou flush a cada 15s
- Tracking: mensagens, tool calls, erros, performance, provider calls
- Non-blocking — nunca interfere no funcionamento

---

## Quick Start

### Instalação Automática (Recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/LucasBolla94/BollaClaw/main/deploy/install.sh | bash
```

O instalador cuida de tudo: Node.js 20, PM2, dependências, build, configuração e startup.

### Instalação Manual

```bash
# Clone
git clone https://github.com/LucasBolla94/BollaClaw.git
cd BollaClaw

# Dependências
npm install

# Configurar
cp .env.example .env
nano .env

# Build
npm run build

# Rodar com PM2
npm run pm2:start
```

---

## Configuração (.env)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `TELEGRAM_BOT_TOKEN` | — | Token do bot Telegram (obrigatório) |
| `TELEGRAM_ALLOWED_USER_IDS` | — | IDs permitidos, separados por vírgula |
| `LLM_PROVIDER` | `claude` | Provider padrão: `claude`, `gemini`, `deepseek`, `groq` |
| `ROUTER_PROVIDER` | `groq` | Provider para roteamento de skills (econômico) |
| `ANTHROPIC_API_KEY` | — | API key da Anthropic (Claude) |
| `GEMINI_API_KEY` | — | API key do Google AI |
| `DEEPSEEK_API_KEY` | — | API key do DeepSeek |
| `GROQ_API_KEY` | — | API key do Groq (também usada para Whisper STT) |
| `OPENROUTER_API_KEY` | — | API key do OpenRouter |
| `XAI_API_KEY` | — | API key do xAI (Grok) |
| `MAX_ITERATIONS` | `5` | Máximo de iterações do agent loop |
| `MEMORY_WINDOW_SIZE` | `20` | Mensagens recentes no contexto |
| `STT_PROVIDER` | `groq_whisper` | `groq_whisper` ou `local_whisper` |
| `AUTO_UPDATE` | `enabled` | Ativar auto-update do GitHub |
| `AUTO_UPDATE_INTERVAL` | `300000` | Intervalo de check (ms) |
| `AUTO_UPDATE_BRANCH` | `main` | Branch para auto-update |
| `ADMIN_ENABLED` | `true` | Ativar web panel |
| `ADMIN_PORT` | `21086` | Porta do web panel |
| `ADMIN_PASSWORD` | — | Senha do painel (gerada na instalação) |
| `PM2_NAME` | `bollaclaw` | Nome do processo PM2 |

---

## CLI — Comandos do Servidor

```bash
bollaclaw <comando>
```

### Gerenciamento de Usuários
| Comando | Descrição |
|---------|-----------|
| `bollaclaw add <código>` | Aprovar acesso por código temporário |
| `bollaclaw users` | Listar usuários autorizados |
| `bollaclaw pending` | Ver solicitações pendentes |
| `bollaclaw remove <id>` | Remover acesso |
| `bollaclaw admin <id>` | Promover a admin |

### Modelos & Providers
| Comando | Descrição |
|---------|-----------|
| `bollaclaw models` | Listar modelos disponíveis |
| `bollaclaw models set <id>` | Definir modelo padrão |
| `bollaclaw models fetch` | Buscar modelos do OpenRouter |

### Soul & Identidade
| Comando | Descrição |
|---------|-----------|
| `bollaclaw soul` | Ver configuração da personalidade |
| `bollaclaw soul reset` | Resetar para padrão |
| `bollaclaw soul export` | Exportar SOUL.md |

### Serviço
| Comando | Descrição |
|---------|-----------|
| `bollaclaw status` | Status do sistema |
| `bollaclaw start` | Iniciar com PM2 |
| `bollaclaw stop` | Parar |
| `bollaclaw restart` | Reiniciar |
| `bollaclaw logs` | Ver logs em tempo real |
| `bollaclaw update` | Forçar atualização do GitHub |
| `bollaclaw web` | Info do painel web + acesso remoto |

---

## Comandos Telegram

| Comando | Descrição |
|---------|-----------|
| `/start` | Mensagem de boas-vindas |
| `/status` | Status do agente, provider, skills, tools |
| `/reload` | Hot-reload de skills |
| `/myid` | Ver seu Telegram ID |
| `/invite` | Códigos de acesso pendentes (admin) |

---

## Web Panel — Acesso Remoto

O painel web roda na porta `21086`. Para acessar remotamente via VPS:

**1. Abra um túnel SSH no seu computador:**
```bash
ssh -L 21086:localhost:21086 ubuntu@seu-servidor.com
```

**2. Acesse no navegador:**
```
http://localhost:21086
```

**3. Faça login com a senha gerada na instalação** (variável `ADMIN_PASSWORD` no `.env`).

Na primeira vez, o sistema pedirá para trocar a senha.

---

## Estrutura do Projeto

```
bollaclaw/
├── src/
│   ├── main.ts                          # Entry point
│   ├── agent/
│   │   ├── AgentController.ts           # Orquestrador principal
│   │   └── AgentLoop.ts                 # ReAct loop (Think→Act→Observe)
│   ├── soul/
│   │   ├── SoulEngine.ts                # Personalidade & identidade
│   │   └── SoulBootstrap.ts             # Setup conversacional
│   ├── memory/
│   │   ├── MemoryManager.ts             # Gerenciador unificado
│   │   ├── ConversationRepository.ts    # CRUD conversas
│   │   ├── MessageRepository.ts         # CRUD mensagens
│   │   ├── Database.ts                  # SQLite connection
│   │   └── semantic/
│   │       ├── SemanticMemoryStore.ts   # Vector store (SQLite+BLOB)
│   │       ├── EmbeddingService.ts      # ONNX embeddings (Python)
│   │       ├── MemoryExtractor.ts       # Extração heurística
│   │       └── index.ts                 # Barrel exports
│   ├── bot/
│   │   ├── TelegramInputHandler.ts      # Entrada Telegram
│   │   └── TelegramOutputHandler.ts     # Saída Telegram
│   ├── handlers/
│   │   ├── AudioHandler.ts              # STT/TTS
│   │   └── DocumentHandler.ts           # PDF/Markdown
│   ├── providers/
│   │   ├── ILlmProvider.ts              # Interface base
│   │   ├── ProviderFactory.ts           # Factory + fallback
│   │   ├── ProviderConfig.ts            # Config loader
│   │   ├── ClaudeProvider.ts            # Anthropic
│   │   ├── GeminiProvider.ts            # Google
│   │   ├── GroqProvider.ts              # Groq
│   │   ├── DeepSeekProvider.ts          # DeepSeek
│   │   └── OpenAICompatibleProvider.ts  # OpenRouter, xAI, etc.
│   ├── skills/
│   │   ├── SkillLoader.ts               # Carregador de skills
│   │   ├── SkillRouter.ts               # Roteamento inteligente
│   │   └── SkillExecutor.ts             # Execução de scripts
│   ├── tools/
│   │   ├── BaseTool.ts                  # Interface base
│   │   ├── ToolRegistry.ts              # Registro central
│   │   ├── ScriptTool.ts                # Tool wrapper para scripts
│   │   └── builtin/
│   │       ├── CreateFileTool.ts        # Criar arquivos
│   │       ├── ReadFileTool.ts          # Ler arquivos
│   │       └── GetDateTimeTool.ts       # Data/hora
│   ├── admin/
│   │   ├── AdminServer.ts              # Backend Express
│   │   └── public/
│   │       └── index.html              # SPA frontend (dark theme)
│   ├── auth/
│   │   └── UserManager.ts             # Controle de acesso
│   ├── models/
│   │   └── ModelManager.ts            # Gerenciamento de modelos
│   ├── onboard/
│   │   ├── OnboardManager.ts          # Setup wizard
│   │   └── cli.ts                     # CLI onboarding
│   ├── updater/
│   │   └── AutoUpdater.ts            # Auto-update GitHub
│   ├── telemetry/
│   │   └── TelemetryReporter.ts       # Métricas → BollaWatch
│   ├── bin/
│   │   └── bollaclaw.ts               # CLI tool
│   └── utils/
│       ├── config.ts                   # Configuração lazy-load
│       └── logger.ts                   # Winston logger
├── deploy/
│   ├── install.sh                      # Instalador automático
│   ├── bollaclaw.service               # Systemd unit
│   └── nginx.conf                      # Nginx reverse proxy
├── data/                               # Soul, memória, credenciais
├── .agents/skills/                     # Skills do usuário
├── ecosystem.config.js                 # PM2 config
├── tsconfig.json
└── package.json
```

---

## Adicionando Skills

Crie uma pasta dentro de `.agents/skills/` com um `SKILL.md`:

```
.agents/skills/
  └── minha-skill/
      ├── SKILL.md          # Frontmatter + instruções
      ├── config.json        # (opcional) configurações
      ├── scripts/           # (opcional) Python/Node/Bash
      └── tools/             # (opcional) definições de tools JSON
```

O `SKILL.md` precisa de frontmatter YAML:

```yaml
---
name: minha-skill
description: O que essa skill faz
---

# Instruções para o agente usar essa skill...
```

Skills são hot-reloaded — use `/reload` no Telegram ou `bollaclaw reload-skills` via CLI.

---

## Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20+ (TypeScript) |
| Bot Framework | Grammy |
| Database | SQLite (better-sqlite3) |
| Embeddings | Python fastembed (ONNX, bge-small-en-v1.5) |
| LLM | Anthropic, Google AI, Groq, DeepSeek, OpenRouter |
| STT | Groq Whisper API / Local Whisper |
| TTS | Edge-TTS |
| Web | Express.js (SPA) |
| Process Manager | PM2 |
| Telemetria | BollaWatch (custom hub) |

---

## Segurança

- **Autenticação**: PBKDF2 com 100.000 iterações SHA-512
- **Rate Limiting**: 5 tentativas de login por IP, lockout de 15 minutos
- **Tokens**: 32 bytes random, expiram em 24h
- **Headers**: X-Frame-Options DENY, X-Content-Type-Options nosniff, X-XSS-Protection
- **Timing-safe**: Comparação de hashes resistente a timing attacks
- **Controle de acesso**: Telegram IDs whitelist + sistema de convites temporários

---

## Requisitos

- Ubuntu 20.04+ (ou Debian-based)
- Node.js 20+
- Python 3.8+ (para embeddings)
- PM2 (instalado automaticamente)
- Pelo menos 1GB RAM livre
- Sem GPU necessária

---

## License

MIT

---

<p align="center">
  <strong>BollaClaw v0.1.0</strong> — por Lucas Bolla<br>
  <em>Feito com ❤️ para rodar 24/7 em servidores dedicados</em>
</p>
