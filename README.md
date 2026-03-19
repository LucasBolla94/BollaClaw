# 🤖 BollaClaw

**Personal AI Agent via Telegram** — Multi-LLM, Skills System, STT/TTS, Admin Panel.

Built with TypeScript/Node.js for Ubuntu dedicated servers.

---

## Features

- **Multi-LLM Support** — Claude (Anthropic), Gemini, DeepSeek, Groq with automatic fallback
- **Telegram Interface** — Text, PDF, voice messages (STT) and audio responses (TTS)
- **Skills System** — Hot-reload plugin architecture via `.agents/skills/` directory
- **ReAct Agent Loop** — Thought → Action → Observation → Answer pattern
- **Persistent Memory** — SQLite with configurable context window
- **Admin Panel** — Web dashboard with real-time logs, system metrics, skill management
- **Ubuntu Server Ready** — PM2, systemd service, nginx reverse proxy configs included

## Architecture

```
Telegram → InputHandler → AgentController → SkillRouter → AgentLoop (ReAct)
                                                              ↕
                                                         LLM Provider
                                                         (Claude/Gemini/
                                                          DeepSeek/Groq)
                                                              ↓
                                                        OutputHandler → Telegram
                                                              ↕
                                                        MemoryManager (SQLite)
```

## Quick Start

```bash
# Clone
git clone https://github.com/LucasBolla94/BollaClaw.git
cd BollaClaw

# Install
bash deploy/install.sh

# Configure
cp .env.example .env
nano .env  # Add your API keys and Telegram bot token

# Build & Run
npm run build
npm run pm2:start

# Check logs
npm run pm2:logs
```

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot API token |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated allowed Telegram user IDs |
| `LLM_PROVIDER` | Default LLM: `claude`, `gemini`, `deepseek`, `groq` |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GROQ_API_KEY` | Groq API key (also used for Whisper STT) |
| `ADMIN_PORT` | Admin panel port (default: 3000) |

## Adding Skills

Create a folder inside `.agents/skills/` with a `SKILL.md` file:

```
.agents/skills/
  └── my-skill/
      └── SKILL.md
```

The `SKILL.md` must have YAML frontmatter with `name` and `description`:

```yaml
---
name: my-skill
description: What this skill does
---

# Skill instructions here...
```

Skills are hot-reloaded — no restart needed. Use `/reload` in Telegram to refresh.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/status` | Show bot status, provider, skills, tools |
| `/reload` | Hot-reload all skills |

## Tech Stack

- **Runtime:** Node.js 20+ (TypeScript)
- **Bot Framework:** Grammy
- **Database:** SQLite (better-sqlite3)
- **LLM Providers:** Anthropic, Google AI, OpenAI-compatible, Groq
- **STT:** Groq Whisper API
- **TTS:** Edge-TTS
- **Admin:** Express.js
- **Process Manager:** PM2

## License

MIT

---

*BollaClaw V0.1.0 — by Lucas Bolla*
