#!/bin/bash
# ============================================================
# BollaClaw V0.1 - Full Automatic Installation Script
# ============================================================
# Usage (fresh server):
#   curl -sSL https://raw.githubusercontent.com/LucasBolla94/BollaClaw/main/deploy/install.sh | bash
# Or locally:
#   bash deploy/install.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${BOLLACLAW_DIR:-$HOME/bollaclaw}"
REPO_URL="https://github.com/LucasBolla94/BollaClaw.git"
LOG_FILE="/tmp/bollaclaw-install.log"

# Clean log file
> "$LOG_FILE"

# Helper: run command silently, log output, show ✓ or ✗
run_silent() {
  local desc="$1"
  shift
  printf "  %-45s" "$desc"
  if "$@" >> "$LOG_FILE" 2>&1; then
    echo -e " ${GREEN}✓${NC}"
  else
    echo -e " ${RED}✗${NC}"
    echo -e "  ${RED}Erro! Veja: cat $LOG_FILE${NC}"
    tail -5 "$LOG_FILE"
    exit 1
  fi
}

clear
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   🤖 BollaClaw V0.1 - Instalação Automática ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║   Servidor Ubuntu 22/24 LTS                 ║${NC}"
echo -e "${CYAN}║   Node.js 20 + PM2 + edge-tts + ffmpeg      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ============================================================
# Check Ubuntu/Debian
# ============================================================
if ! command -v apt &> /dev/null; then
  echo -e "${RED}❌ Este script é apenas para Ubuntu/Debian.${NC}"
  exit 1
fi

# ============================================================
# [1/7] System Update
# ============================================================
echo -e "${BOLD}[1/7]${NC} Atualizando sistema..."
run_silent "Atualizando lista de pacotes" sudo apt update -qq
run_silent "Aplicando atualizações" sudo apt upgrade -y -qq

# ============================================================
# [2/7] Install Node.js 20 LTS
# ============================================================
echo ""
echo -e "${BOLD}[2/7]${NC} Node.js 20 LTS..."
if command -v node &> /dev/null; then
  NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 20 ]; then
    echo -e "  Node.js $(node --version) já instalado             ${GREEN}✓${NC}"
  else
    run_silent "Baixando NodeSource 20.x" bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -'
    run_silent "Instalando Node.js 20" sudo apt install -y -qq nodejs
  fi
else
  run_silent "Baixando NodeSource 20.x" bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -'
  run_silent "Instalando Node.js 20" sudo apt install -y -qq nodejs
fi
echo -e "  Node: ${GREEN}$(node --version)${NC} | npm: ${GREEN}$(npm --version)${NC}"

# ============================================================
# [3/7] Install PM2
# ============================================================
echo ""
echo -e "${BOLD}[3/7]${NC} PM2 (Process Manager)..."
if command -v pm2 &> /dev/null; then
  echo -e "  PM2 $(pm2 --version) já instalado                  ${GREEN}✓${NC}"
else
  run_silent "Instalando PM2 globalmente" sudo npm install -g pm2
fi

# ============================================================
# [4/7] Install system dependencies
# ============================================================
echo ""
echo -e "${BOLD}[4/7]${NC} Dependências de sistema..."
run_silent "build-essential + python3 + ffmpeg" sudo apt install -y -qq build-essential python3 python3-pip ffmpeg

if command -v python3 &> /dev/null; then
  run_silent "edge-tts (TTS engine)" bash -c 'pip3 install edge-tts --break-system-packages 2>/dev/null || pip3 install edge-tts || true'
else
  echo -e "  ${YELLOW}⚠${NC} Python3 não encontrado. TTS desabilitado."
fi

# ============================================================
# [5/7] Clone or Update Repository
# ============================================================
echo ""
echo -e "${BOLD}[5/7]${NC} Repositório BollaClaw..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../package.json" ]; then
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  echo -e "  Usando repositório local: ${CYAN}$INSTALL_DIR${NC}"
  cd "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "  Repositório existente. Atualizando..."
  cd "$INSTALL_DIR"
  run_silent "git pull" git pull --ff-only || {
    echo -e "  ${YELLOW}⚠${NC} Conflito. Fazendo backup e re-clone..."
    cd "$HOME"
    mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
    run_silent "Clonando repositório" git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  }
elif [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
  echo -e "  Usando diretório existente: ${CYAN}$INSTALL_DIR${NC}"
  cd "$INSTALL_DIR"
else
  run_silent "Clonando repositório" git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ============================================================
# [6/7] Install Dependencies + Build
# ============================================================
echo ""
echo -e "${BOLD}[6/7]${NC} Compilando BollaClaw..."
run_silent "npm install" npm install --production=false --silent
run_silent "TypeScript build" npm run build

# Create required directories
mkdir -p data tmp logs output .agents/skills

echo ""
echo -e "  ${GREEN}✓ Instalação de dependências completa!${NC}"
echo ""

# ============================================================
# [7/7] Interactive Setup Wizard
# ============================================================
echo -e "${BOLD}[7/7]${NC} Configuração interativa..."
echo ""

if [ ! -f ".env" ]; then
  echo -e "  ${CYAN}Responda as perguntas abaixo para completar o setup.${NC}"
  echo ""
  # CRITICAL: use </dev/tty to read from terminal even when piped via curl | bash
  node dist/onboard/cli.js </dev/tty
else
  echo -e "  Configuração já existe (.env)  ${GREEN}✓${NC}"
  echo -n "  Deseja reconfigurar? (s/N): "
  read -r RECONFIG </dev/tty
  if [ "$RECONFIG" = "s" ] || [ "$RECONFIG" = "S" ]; then
    node dist/onboard/cli.js </dev/tty
  fi
fi

# ============================================================
# Install Whisper local if user chose it
# ============================================================
if grep -q "STT_PROVIDER=local_whisper" .env 2>/dev/null; then
  echo ""
  echo -e "  ${BOLD}Instalando Whisper local (CPU)...${NC}"
  run_silent "Instalando openai-whisper + torch CPU" bash -c 'pip3 install openai-whisper --break-system-packages 2>/dev/null || pip3 install openai-whisper'
  # Pre-download the base model
  run_silent "Baixando modelo whisper-base (~150MB)" bash -c 'python3 -c "import whisper; whisper.load_model(\"base\")" 2>/dev/null || true'
  echo -e "  ${GREEN}✓${NC} Whisper local instalado (pt-BR + en)"
fi

# ============================================================
# Start PM2 + Auto-Start (AFTER wizard completes)
# ============================================================
echo ""
echo -e "  ${BOLD}Iniciando serviço...${NC}"

# Stop existing instance
pm2 delete bollaclaw >> "$LOG_FILE" 2>&1 || true

run_silent "Iniciando BollaClaw via PM2" pm2 start ecosystem.config.js
run_silent "Salvando processo PM2" pm2 save

# Auto-start on boot
PM2_STARTUP=$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>&1 | grep "sudo" | head -1)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP" >> "$LOG_FILE" 2>&1 || {
    echo -e "  ${YELLOW}⚠${NC} Execute manualmente: $PM2_STARTUP"
  }
fi
pm2 save >> "$LOG_FILE" 2>&1

# ============================================================
# Done!
# ============================================================
sleep 1
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ BollaClaw V0.1 - Instalação Completa!  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Diretório: ${CYAN}${INSTALL_DIR}${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}Comandos úteis:${NC}                             ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    pm2 logs bollaclaw     — Ver logs          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    pm2 restart bollaclaw  — Reiniciar         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    pm2 monit              — Monitor ao vivo   ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    npm run onboard        — Reconfigurar      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  O bot reinicia automaticamente:              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    ✓ Crash → PM2 reinicia                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    ✓ Reboot → systemd + PM2                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    ✓ Memória > 512MB → PM2 reinicia          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${YELLOW}Log completo:${NC} cat $LOG_FILE"
echo ""
