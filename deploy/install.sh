#!/bin/bash
# ============================================================
# BollaClaw V0.1 - Full Automatic Installation Script
# ============================================================
# This script:
#   1. Installs all system dependencies (Node 20, PM2, edge-tts, ffmpeg)
#   2. Clones/updates the BollaClaw repo
#   3. Installs npm dependencies and builds
#   4. Runs interactive onboard wizard (.env + identity)
#   5. Sets up PM2 with auto-restart + systemd boot startup
#   6. Starts BollaClaw 24/7
#
# Usage (fresh server):
#   curl -sSL https://raw.githubusercontent.com/LucasBolla94/BollaClaw/main/deploy/install.sh | bash
#
# Or locally:
#   bash deploy/install.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

INSTALL_DIR="${BOLLACLAW_DIR:-$HOME/bollaclaw}"
REPO_URL="https://github.com/LucasBolla94/BollaClaw.git"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   🤖 BollaClaw V0.1 - Instalação Automática ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║   Servidor Ubuntu 22/24 LTS                 ║${NC}"
echo -e "${CYAN}║   Node.js 20 + PM2 + edge-tts + ffmpeg      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ============================================================
# Check if running on Ubuntu/Debian
# ============================================================
if ! command -v apt &> /dev/null; then
  echo -e "${RED}❌ Este script é apenas para Ubuntu/Debian.${NC}"
  exit 1
fi

# ============================================================
# [1/8] System Update
# ============================================================
echo -e "${YELLOW}[1/8]${NC} Atualizando pacotes do sistema..."
sudo apt update -qq
sudo apt upgrade -y -qq

# ============================================================
# [2/8] Install Node.js 20 LTS
# ============================================================
echo ""
echo -e "${YELLOW}[2/8]${NC} Instalando Node.js 20 LTS..."
if command -v node &> /dev/null; then
  NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 20 ]; then
    echo -e "  ${GREEN}✓${NC} Node.js $(node --version) já instalado"
  else
    echo "  Atualizando Node.js para v20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo -e "  Node: ${GREEN}$(node --version)${NC} | npm: ${GREEN}$(npm --version)${NC}"

# ============================================================
# [3/8] Install PM2 (Process Manager)
# ============================================================
echo ""
echo -e "${YELLOW}[3/8]${NC} Instalando PM2..."
if command -v pm2 &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} PM2 já instalado: $(pm2 --version)"
else
  sudo npm install -g pm2
  echo -e "  ${GREEN}✓${NC} PM2 instalado: $(pm2 --version)"
fi

# ============================================================
# [4/8] Install edge-tts + ffmpeg + build-essential
# ============================================================
echo ""
echo -e "${YELLOW}[4/8]${NC} Instalando dependências de sistema..."

# build-essential for native modules (better-sqlite3)
sudo apt install -y build-essential python3 python3-pip ffmpeg -qq

# edge-tts for TTS
if command -v python3 &> /dev/null; then
  pip3 install edge-tts --break-system-packages 2>/dev/null || pip3 install edge-tts || true
  echo -e "  ${GREEN}✓${NC} edge-tts instalado"
else
  echo -e "  ${YELLOW}⚠${NC} Python3 não encontrado. TTS desabilitado."
fi

echo -e "  ${GREEN}✓${NC} ffmpeg: $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"

# ============================================================
# [5/8] Clone or Update Repository
# ============================================================
echo ""
echo -e "${YELLOW}[5/8]${NC} Configurando repositório BollaClaw..."

# Detect if we're running from inside the repo already
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../package.json" ]; then
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  echo "  Executando do repositório local: $INSTALL_DIR"
  cd "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  echo "  Repositório existente encontrado. Atualizando..."
  cd "$INSTALL_DIR"
  git pull --ff-only || {
    echo -e "  ${YELLOW}⚠${NC} Conflito no pull. Fazendo backup e re-clone..."
    cd "$HOME"
    mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  }
elif [ -d "$INSTALL_DIR" ]; then
  echo "  Diretório existente (local). Usando diretório atual."
  cd "$INSTALL_DIR"
else
  echo "  Clonando repositório..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ============================================================
# [6/8] Install Dependencies + Build
# ============================================================
echo ""
echo -e "${YELLOW}[6/8]${NC} Instalando dependências npm e compilando..."
npm install --production=false
npm run build
echo -e "  ${GREEN}✓${NC} Build completo"

# Create required directories
mkdir -p data tmp logs output .agents/skills

# ============================================================
# [7/8] Onboard Wizard
# ============================================================
echo ""
echo -e "${YELLOW}[7/8]${NC} Iniciando wizard de configuração..."

# Only run onboard if .env doesn't exist or identity not set
if [ ! -f ".env" ] || [ ! -f ".agents/identity.json" ]; then
  echo ""
  echo -e "${CYAN}  O wizard vai configurar seu .env e a identidade do agente.${NC}"
  echo ""
  node dist/onboard/cli.js
else
  echo -e "  ${GREEN}✓${NC} Configuração já existe (.env + identity.json)"
  echo -n "  Deseja reconfigurar? (s/N): "
  read -r RECONFIG
  if [ "$RECONFIG" = "s" ] || [ "$RECONFIG" = "S" ]; then
    node dist/onboard/cli.js
  fi
fi

# ============================================================
# [8/8] Setup PM2 + Auto-Start on Boot
# ============================================================
echo ""
echo -e "${YELLOW}[8/8]${NC} Configurando PM2 para 24/7..."

# Stop existing instance if running
pm2 delete bollaclaw 2>/dev/null || true

# Start with ecosystem config
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot (systemd)
echo ""
echo -e "  Configurando auto-start no boot..."
PM2_STARTUP=$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>&1 | grep "sudo" | head -1)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP" 2>/dev/null || {
    echo -e "  ${YELLOW}⚠${NC} Execute manualmente:"
    echo "    $PM2_STARTUP"
  }
fi
pm2 save

# ============================================================
# Done!
# ============================================================
echo ""
sleep 2

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ BollaClaw V0.1 - Instalação Completa!  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║${NC}   Diretório: ${CYAN}${INSTALL_DIR}${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║${NC}   Comandos úteis:                            ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     pm2 logs bollaclaw     — Ver logs         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     pm2 restart bollaclaw  — Reiniciar        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     pm2 monit              — Monitor ao vivo  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     npm run onboard        — Reconfigurar     ${GREEN}║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║${NC}   O BollaClaw reinicia automaticamente:       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     ✓ Crash/erro → PM2 reinicia              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     ✓ Reboot servidor → systemd + PM2        ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}     ✓ Memória > 512MB → PM2 reinicia         ${GREEN}║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
