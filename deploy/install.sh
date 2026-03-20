#!/bin/bash
# ============================================================
# BollaWatch - Telemetry Hub Install Script
# ============================================================
# Run on Server 2: server2.bolla.network
#   bash deploy/install.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${BOLLAWATCH_DIR:-$HOME/bollawatch}"
LOG_FILE="/tmp/bollawatch-install.log"
> "$LOG_FILE"

run_silent() {
  local desc="$1"; shift
  printf "  %-45s" "$desc"
  if "$@" >> "$LOG_FILE" 2>&1; then
    echo -e " ${GREEN}✓${NC}"
  else
    echo -e " ${RED}✗${NC}"
    tail -5 "$LOG_FILE"
    exit 1
  fi
}

clear
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   👁️  BollaWatch - Instalação                ║${NC}"
echo -e "${CYAN}║   Hub de Telemetria para BollaClaw           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Kill existing
if command -v pm2 &> /dev/null; then
  pm2 delete bollawatch >> "$LOG_FILE" 2>&1 || true
fi

# Check Node.js
echo -e "${BOLD}[1/5]${NC} Verificando Node.js..."
if command -v node &> /dev/null; then
  NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 20 ]; then
    echo -e "  Node.js $(node --version) OK                       ${GREEN}✓${NC}"
  else
    echo -e "  ${RED}Node.js 20+ necessário. Atual: $(node --version)${NC}"
    exit 1
  fi
else
  echo -e "  ${RED}Node.js não encontrado. Instale Node.js 20+ primeiro.${NC}"
  exit 1
fi

# Check PM2
echo ""
echo -e "${BOLD}[2/5]${NC} PM2..."
if ! command -v pm2 &> /dev/null; then
  run_silent "Instalando PM2" sudo npm install -g pm2
else
  echo -e "  PM2 $(pm2 --version) OK                             ${GREEN}✓${NC}"
fi

# Setup project
echo ""
echo -e "${BOLD}[3/5]${NC} Configurando projeto..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../package.json" ]; then
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  echo -e "  Usando diretório local: ${CYAN}$INSTALL_DIR${NC}"
  cd "$INSTALL_DIR"
else
  echo -e "  ${RED}Execute este script de dentro do diretório do BollaWatch.${NC}"
  exit 1
fi

# Install + Build
echo ""
echo -e "${BOLD}[4/5]${NC} Compilando..."
run_silent "npm install" npm install --production=false --silent
run_silent "TypeScript build" npm run build
mkdir -p data

# Create .env if missing
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "  Arquivo .env criado (padrões)                 ${GREEN}✓${NC}"
fi

# Start PM2
echo ""
echo -e "${BOLD}[5/5]${NC} Iniciando serviço..."
run_silent "Iniciando BollaWatch via PM2" pm2 start ecosystem.config.js
run_silent "Salvando PM2" pm2 save

# Auto-start
PM2_STARTUP=$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>&1 | grep "sudo" | head -1)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP" >> "$LOG_FILE" 2>&1 || true
fi
pm2 save >> "$LOG_FILE" 2>&1

PORT=$(grep PORT .env 2>/dev/null | cut -d= -f2 || echo "21087")
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ BollaWatch Instalado!                   ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Dashboard: ${CYAN}http://$(hostname -I | awk '{print $1}'):${PORT}${NC}"
echo -e "${GREEN}║${NC}  API Base:  ${CYAN}http://$(hostname -I | awk '{print $1}'):${PORT}/api/v1${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  pm2 logs bollawatch     — Ver logs          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  pm2 restart bollawatch  — Reiniciar         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
