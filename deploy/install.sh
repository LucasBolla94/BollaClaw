#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║          BollaClaw — Full Automatic Installer v0.2          ║
# ╚══════════════════════════════════════════════════════════════╝
# Usage:
#   curl -sSL https://raw.githubusercontent.com/LucasBolla94/BollaClaw/main/deploy/install.sh | bash

set -euo pipefail

# ── Terminal capabilities ────────────────────────────────────
TERM_WIDTH=$(tput cols 2>/dev/null || echo 70)
[ "$TERM_WIDTH" -gt 120 ] && TERM_WIDTH=120

# ── Colors ───────────────────────────────────────────────────
if [ -t 1 ] && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  R=$'\033[0;31m';   G=$'\033[0;32m';   Y=$'\033[1;33m'
  B=$'\033[0;34m';   M=$'\033[0;35m';   C=$'\033[0;36m'
  W=$'\033[1;37m';   DIM=$'\033[2m';    BOLD=$'\033[1m'
  UL=$'\033[4m';     NC=$'\033[0m';     IT=$'\033[3m'
  BG_G=$'\033[42;30m'; BG_R=$'\033[41;37m'; BG_B=$'\033[44;37m'
  BG_Y=$'\033[43;30m'; BG_C=$'\033[46;30m'; BG_M=$'\033[45;37m'
else
  R=''; G=''; Y=''; B=''; M=''; C=''; W=''; DIM=''; BOLD=''
  UL=''; NC=''; IT=''; BG_G=''; BG_R=''; BG_B=''; BG_Y=''; BG_C=''; BG_M=''
fi

# ── Variables ────────────────────────────────────────────────
INSTALL_DIR="${BOLLACLAW_DIR:-/opt/bollaclaw}"
REPO_URL="https://github.com/LucasBolla94/BollaClaw.git"
LOG_FILE="/tmp/bollaclaw-install.log"
TOTAL_STEPS=9
CURRENT_STEP=0
ERRORS=0
WARNINGS=0
START_TIME=$(date +%s)
> "$LOG_FILE"

# ══════════════════════════════════════════════════════════════
# UI COMPONENTS
# ══════════════════════════════════════════════════════════════

# Horizontal line
hr() {
  local char="${1:-─}" color="${2:-$DIM}" w="$TERM_WIDTH"
  printf '%s' "$color"
  printf '%*s' "$w" '' | tr ' ' "$char"
  printf '%s\n' "$NC"
}

# Double horizontal line
hr2() { hr "═" "${1:-$C}"; }

# Spinner animation
spin() {
  local pid=$1 desc="$2"
  local frames=("⣾" "⣽" "⣻" "⢿" "⡿" "⣟" "⣯" "⣷")
  local i=0 elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    elapsed=$(( $(date +%s) - START_TIME ))
    printf "\r    ${C}${frames[$i]}${NC}  %-48s ${DIM}%ds${NC}" "$desc" "$elapsed"
    i=$(( (i + 1) % ${#frames[@]} ))
    sleep 0.08
  done
  wait "$pid" 2>/dev/null
  return $?
}

# Run a step with spinner
run_step() {
  local desc="$1"; shift
  "$@" >> "$LOG_FILE" 2>&1 &
  local pid=$!
  spin "$pid" "$desc"
  local ec=$?
  if [ $ec -eq 0 ]; then
    printf "\r    ${G}✓${NC}  %-48s ${DIM}ok${NC}\n" "$desc"
  else
    printf "\r    ${R}✗${NC}  %-48s ${R}erro${NC}\n" "$desc"
    ERRORS=$((ERRORS + 1))
    printf "       ${DIM}→ Últimas linhas do log:${NC}\n"
    tail -3 "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
      printf "       ${DIM}  %s${NC}\n" "$line"
    done
    exit 1
  fi
}

# Step header with visual progress
step_header() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  local title="$1" icon="$2"
  local pct=$((CURRENT_STEP * 100 / TOTAL_STEPS))
  local bar_total=30
  local bar_filled=$((pct * bar_total / 100))
  local bar_empty=$((bar_total - bar_filled))

  echo ""
  # Progress bar with gradient effect
  printf "  ${DIM}${CURRENT_STEP}/${TOTAL_STEPS}${NC}  "
  printf "${G}"
  [ "$bar_filled" -gt 0 ] && printf '%*s' "$bar_filled" '' | tr ' ' '▓'
  printf "${DIM}"
  [ "$bar_empty" -gt 0 ] && printf '%*s' "$bar_empty" '' | tr ' ' '░'
  printf "  ${W}${pct}%%${NC}\n"

  # Title with icon
  printf "\n  ${BOLD}${icon}  %s${NC}\n" "$title"
  hr "─" "$DIM"
}

# Indented info
info()  { printf "    ${DIM}│${NC} %b\n" "$1"; }
ok()    { printf "    ${G}✓${NC}  %b\n" "$1"; }
warn()  { WARNINGS=$((WARNINGS + 1)); printf "    ${Y}⚠${NC}  %b\n" "$1"; }
fail()  { ERRORS=$((ERRORS + 1)); printf "    ${R}✗${NC}  %b\n" "$1"; }

# Key-value pair display
kv() { printf "    ${DIM}%-14s${NC} %b\n" "$1" "$2"; }

# ── BollaWatch Telemetry ─────────────────────────────────────
BOLLAWATCH_URL="http://server2.bolla.network:21087"
BOLLAWATCH_OK=false
INSTANCE_ID="bc-$(hostname)-install-$$"

bw_event() {
  [ "$BOLLAWATCH_OK" = true ] || return 0
  local sev="$1" msg="$2"
  curl -s --connect-timeout 2 -X POST "${BOLLAWATCH_URL}/api/v1/events" \
    -H "Content-Type: application/json" \
    -d "{\"instance_id\":\"${INSTANCE_ID}\",\"events\":[{\"type\":\"config_change\",\"severity\":\"${sev}\",\"category\":\"install\",\"message\":\"${msg}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}" \
    >/dev/null 2>&1 || true
}

# ══════════════════════════════════════════════════════════════
# HEADER
# ══════════════════════════════════════════════════════════════

clear 2>/dev/null || true

cat <<'LOGO'

     ██████╗  ██████╗ ██╗     ██╗      █████╗
     ██╔══██╗██╔═══██╗██║     ██║     ██╔══██╗
     ██████╔╝██║   ██║██║     ██║     ███████║
     ██╔══██╗██║   ██║██║     ██║     ██╔══██╗
     ██████╔╝╚██████╔╝███████╗███████╗██║  ██║
     ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝
LOGO
echo ""
printf "     ${C}█▀▀ █   █▀█ █ █ █${NC}   ${IT}${DIM}Telegram AI Agent${NC}\n"
printf "     ${C}█▄▄ █▄▄ █▀█ ▀▄▀▄▀${NC}   ${IT}${DIM}v0.2 — Installer${NC}\n"
echo ""
hr2 "$C"
echo ""

printf "  ${W}Sistema${NC}       $(uname -s) $(uname -m)\n"
printf "  ${W}Hostname${NC}     $(hostname)\n"
printf "  ${W}User${NC}         $(whoami)\n"
printf "  ${W}Data${NC}         $(date '+%Y-%m-%d %H:%M:%S')\n"
echo ""

# Pre-flight check
if ! command -v apt &>/dev/null; then
  printf "  ${BG_R} ERRO ${NC} Este script requer ${BOLD}Ubuntu/Debian${NC}.\n"
  printf "  ${DIM}Sistemas suportados: Ubuntu 22.04+, Debian 12+${NC}\n\n"
  exit 1
fi

# ══════════════════════════════════════════════════════════════
# STEP 0 — BollaWatch
# ══════════════════════════════════════════════════════════════
step_header "Telemetria — BollaWatch" "📡"

if curl -s --connect-timeout 5 "${BOLLAWATCH_URL}/health" 2>/dev/null | grep -q '"status":"ok"'; then
  BOLLAWATCH_OK=true
  ok "BollaWatch ${G}online${NC} — ${C}${BOLLAWATCH_URL}${NC}"
  curl -s --connect-timeout 2 -X POST "${BOLLAWATCH_URL}/api/v1/register" \
    -H "Content-Type: application/json" \
    -d "{\"instance_id\":\"${INSTANCE_ID}\",\"name\":\"BollaClaw (installing)\",\"hostname\":\"$(hostname)\",\"version\":\"0.2.0-install\"}" \
    >/dev/null 2>&1 || true
  bw_event "info" "Install started on $(hostname)"
  info "Eventos da instalação serão enviados em tempo real"
else
  warn "BollaWatch indisponível — telemetria será ativada quando online"
  info "URL: ${C}${BOLLAWATCH_URL}${NC}"
fi

# ══════════════════════════════════════════════════════════════
# STEP 1 — Cleanup
# ══════════════════════════════════════════════════════════════
step_header "Limpeza de instalação anterior" "🧹"

if command -v pm2 &>/dev/null && pm2 describe bollaclaw &>/dev/null 2>&1; then
  run_step "Removendo processo PM2 antigo" pm2 delete bollaclaw
else
  ok "Nenhum processo anterior encontrado"
fi

ORPHAN_PIDS=$(pgrep -f "node.*bollaclaw" 2>/dev/null || true)
if [ -n "$ORPHAN_PIDS" ]; then
  run_step "Finalizando processos órfãos" bash -c "echo '$ORPHAN_PIDS' | xargs kill -9 2>/dev/null || true"
fi

# ══════════════════════════════════════════════════════════════
# STEP 2 — System Update
# ══════════════════════════════════════════════════════════════
step_header "Atualizando pacotes do sistema" "🔄"

run_step "apt update" sudo apt update -qq
run_step "apt upgrade" sudo apt upgrade -y -qq

# ══════════════════════════════════════════════════════════════
# STEP 3 — Node.js
# ══════════════════════════════════════════════════════════════
step_header "Node.js 20 LTS" "⬢"

NEED_NODE=true
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    ok "Node.js ${G}$(node --version)${NC} já instalado"
    NEED_NODE=false
  else
    warn "Versão antiga $(node --version) — atualizando..."
  fi
fi

if [ "$NEED_NODE" = true ]; then
  run_step "Configurando repositório NodeSource 20.x" bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -'
  run_step "Instalando Node.js 20 LTS" sudo apt install -y -qq nodejs
fi

kv "Node" "${G}$(node --version)${NC}"
kv "npm" "${G}$(npm --version)${NC}"
bw_event "info" "Node $(node --version) + npm $(npm --version)"

# ══════════════════════════════════════════════════════════════
# STEP 4 — PM2
# ══════════════════════════════════════════════════════════════
step_header "PM2 — Process Manager" "🔧"

if command -v pm2 &>/dev/null; then
  ok "PM2 ${G}v$(pm2 --version)${NC} disponível"
else
  run_step "Instalando PM2 globalmente" sudo npm install -g pm2
  ok "PM2 ${G}v$(pm2 --version)${NC} instalado"
fi

# ══════════════════════════════════════════════════════════════
# STEP 5 — System Dependencies
# ══════════════════════════════════════════════════════════════
step_header "Dependências do sistema" "📦"

run_step "build-essential, python3, ffmpeg" sudo apt install -y -qq build-essential python3 python3-pip ffmpeg

if command -v python3 &>/dev/null; then
  run_step "edge-tts (text-to-speech)" bash -c 'pip3 install edge-tts --break-system-packages -q 2>/dev/null || pip3 install edge-tts -q 2>/dev/null || true'
  run_step "fastembed (local embeddings ONNX)" bash -c 'pip3 install fastembed --break-system-packages -q 2>/dev/null || pip3 install fastembed -q 2>/dev/null || true'
  kv "Python" "${G}$(python3 --version 2>&1 | awk '{print $2}')${NC}"
else
  warn "Python3 não encontrado — TTS e embeddings desabilitados"
fi

# ══════════════════════════════════════════════════════════════
# STEP 6 — Repository
# ══════════════════════════════════════════════════════════════
step_header "Código-fonte BollaClaw" "📂"

# ── Ensure install directory is writable ───────────────────────
# /opt requires sudo — create dir and set ownership to current user
ensure_install_dir() {
  local dir="$1"
  local parent="$(dirname "$dir")"

  if [ -d "$dir" ] && [ -w "$dir" ]; then
    return 0  # Already exists and writable
  fi

  if [ ! -d "$dir" ]; then
    if [ -w "$parent" ]; then
      mkdir -p "$dir"
    else
      sudo mkdir -p "$dir"
      sudo chown "$(whoami):$(id -gn)" "$dir"
    fi
  elif [ ! -w "$dir" ]; then
    sudo chown -R "$(whoami):$(id -gn)" "$dir"
  fi
}

# ── Detect and migrate old installations ──────────────────────
OLD_DIRS=("$HOME/bollaclaw" "$HOME/BollaClaw" "$HOME/BollaClaw/bollaclaw")
for OLD_DIR in "${OLD_DIRS[@]}"; do
  if [ -d "$OLD_DIR/.git" ] && [ "$OLD_DIR" != "$INSTALL_DIR" ]; then
    warn "Instalação antiga encontrada em ${C}$OLD_DIR${NC}"
    info "Migrando para ${C}$INSTALL_DIR${NC}..."

    # Stop PM2 if running from old location
    pm2 stop bollaclaw 2>/dev/null || true
    pm2 delete bollaclaw 2>/dev/null || true

    # Ensure target dir exists
    ensure_install_dir "$INSTALL_DIR"

    # Copy .env and data if they exist (preserve user config)
    if [ -f "$OLD_DIR/.env" ] && [ ! -f "$INSTALL_DIR/.env" ]; then
      cp "$OLD_DIR/.env" "$INSTALL_DIR/.env" 2>/dev/null && ok "Migrado: .env"
    fi
    if [ -d "$OLD_DIR/data" ] && [ ! -d "$INSTALL_DIR/data" ]; then
      cp -r "$OLD_DIR/data" "$INSTALL_DIR/data" 2>/dev/null && ok "Migrado: data/"
    fi

    # Remove old installation
    rm -rf "$OLD_DIR"
    ok "Removida instalação antiga: ${C}$OLD_DIR${NC}"
    break
  fi
done

# ── Clone or update repository ────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../package.json" ]; then
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  ok "Usando repositório local: ${C}$INSTALL_DIR${NC}"
  cd "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "Repositório existente — atualizando..."
  cd "$INSTALL_DIR"
  git reset --hard HEAD >/dev/null 2>&1
  run_step "git pull" git pull --ff-only 2>/dev/null || {
    warn "Conflito no git — fazendo backup e re-clone..."
    cd /tmp
    mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)" 2>/dev/null || true
    ensure_install_dir "$INSTALL_DIR"
    run_step "Clonando repositório" git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  }
elif [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
  ok "Diretório existente: ${C}$INSTALL_DIR${NC}"
  cd "$INSTALL_DIR"
else
  ensure_install_dir "$(dirname "$INSTALL_DIR")"
  run_step "Clonando repositório" git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  # Ensure ownership after clone
  if [ ! -w "$INSTALL_DIR" ]; then
    sudo chown -R "$(whoami):$(id -gn)" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi

COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "local")
kv "Diretório" "${C}${INSTALL_DIR}${NC}"
kv "Commit" "${C}${COMMIT}${NC}"

# ══════════════════════════════════════════════════════════════
# STEP 7 — Build
# ══════════════════════════════════════════════════════════════
step_header "Compilando projeto" "🔨"

run_step "npm install" npm install --production=false --silent
run_step "TypeScript build" npm run build

mkdir -p data tmp logs output .agents/skills
ok "Diretórios criados"
bw_event "info" "Build completo — commit $COMMIT"

# ══════════════════════════════════════════════════════════════
# STEP 8 — CLI
# ══════════════════════════════════════════════════════════════
step_header "BollaClaw CLI" "⌨️"

chmod +x dist/bin/bollaclaw.js 2>/dev/null || true
run_step "Registrando comando global 'bollaclaw'" sudo npm link --silent
ok "Comando ${C}bollaclaw${NC} disponível globalmente"

# ══════════════════════════════════════════════════════════════
# STEP 9 — Setup Wizard + Admin Password
# ══════════════════════════════════════════════════════════════
step_header "Configuração do bot" "⚙️"

# ── Generate admin password for web panel ──
ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)
ADMIN_PORT="${ADMIN_PORT:-21086}"

if [ ! -f ".env" ]; then
  echo ""
  info "Responda as perguntas abaixo para configurar o bot."
  echo ""
  node dist/onboard/cli.js </dev/tty

  # Append web panel credentials to .env
  if [ -f ".env" ]; then
    echo "" >> .env
    echo "# ── Web Panel (Admin Dashboard) ──────────────────────" >> .env
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> .env
    echo "ADMIN_PORT=${ADMIN_PORT}" >> .env
    ok "Credenciais do painel web geradas"
  fi
else
  ok "Configuração existente ${C}.env${NC} detectada"

  # Ensure ADMIN_PASSWORD exists in .env
  if ! grep -q "ADMIN_PASSWORD" .env 2>/dev/null; then
    echo "" >> .env
    echo "# ── Web Panel (Admin Dashboard) ──────────────────────" >> .env
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> .env
    echo "ADMIN_PORT=${ADMIN_PORT}" >> .env
    ok "Credenciais do painel web adicionadas ao .env"
  else
    ADMIN_PASSWORD=$(grep "ADMIN_PASSWORD" .env | cut -d'=' -f2)
    ok "Credenciais do painel web já configuradas"
  fi

  echo ""
  printf "    Reconfigurar? ${DIM}(s/N):${NC} "
  read -r RECONFIG </dev/tty || RECONFIG="n"
  if [ "$RECONFIG" = "s" ] || [ "$RECONFIG" = "S" ]; then
    node dist/onboard/cli.js </dev/tty
  fi
fi

# Whisper (if chosen)
if grep -q "STT_PROVIDER=local_whisper" .env 2>/dev/null; then
  echo ""
  info "Configurando transcrição de áudio local..."
  run_step "Instalando openai-whisper + torch CPU" bash -c 'pip3 install openai-whisper --break-system-packages -q 2>/dev/null || pip3 install openai-whisper -q 2>/dev/null'
  run_step "Baixando modelo whisper-base (~150MB)" bash -c 'python3 -c "import whisper; whisper.load_model(\"base\")" 2>/dev/null || true'
  ok "Whisper local pronto ${DIM}(pt-BR + en)${NC}"
fi

# ══════════════════════════════════════════════════════════════
# START SERVICE
# ══════════════════════════════════════════════════════════════
echo ""
hr2 "$G"
printf "\n  ${BOLD}Iniciando serviço...${NC}\n\n"

run_step "Iniciando BollaClaw via PM2" pm2 start ecosystem.config.js
run_step "Salvando configuração PM2" pm2 save

PM2_STARTUP=$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>&1 | grep "sudo" | head -1)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP" >> "$LOG_FILE" 2>&1 || warn "Execute manualmente: $PM2_STARTUP"
fi
pm2 save >> "$LOG_FILE" 2>&1
ok "Auto-start no boot configurado via systemd"

bw_event "info" "Install complete — BollaClaw active via PM2"

# ══════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ══════════════════════════════════════════════════════════════

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
ELAPSED_FMT="$((ELAPSED / 60))m $((ELAPSED % 60))s"

echo ""
hr2 "$G"
echo ""
printf "  ${G}${BOLD}█ INSTALAÇÃO COMPLETA!${NC}  ${DIM}%s${NC}\n" "$ELAPSED_FMT"
echo ""
hr "─" "$DIM"
echo ""

# ── System info
printf "  ${W}SISTEMA${NC}\n\n"
kv "Servidor"    "${BOLD}$(hostname)${NC}"
kv "Diretório"   "${C}${INSTALL_DIR}${NC}"
kv "Commit"      "${C}${COMMIT}${NC}"
kv "Node.js"     "${G}$(node --version)${NC}"
kv "PM2"         "${G}v$(pm2 --version)${NC}"
kv "Python"      "${G}$(python3 --version 2>&1 | awk '{print $2}' || echo 'N/A')${NC}"
kv "Erros"       "$( [ $ERRORS -eq 0 ] && printf "${G}0${NC}" || printf "${R}${ERRORS}${NC}" )"
kv "Avisos"      "$( [ $WARNINGS -eq 0 ] && printf "${G}0${NC}" || printf "${Y}${WARNINGS}${NC}" )"
echo ""

# ── Web Panel
printf "  ${W}PAINEL WEB${NC}\n\n"
printf "    ${C}Endereço local:${NC}  http://localhost:${ADMIN_PORT}\n"
printf "    ${C}Senha inicial:${NC}   ${Y}${BOLD}${ADMIN_PASSWORD}${NC}\n"
printf "    ${DIM}Troque a senha no primeiro login!${NC}\n"
echo ""
printf "    ${DIM}Acesso remoto (VPS via SSH tunnel):${NC}\n"
printf "    ${C}ssh -L ${ADMIN_PORT}:localhost:${ADMIN_PORT} $(whoami)@$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'SEU_IP')${NC}\n"
printf "    ${DIM}Depois abra: http://localhost:${ADMIN_PORT}${NC}\n"
echo ""

# ── Commands
printf "  ${W}COMANDOS${NC}\n\n"
printf "    ${C}bollaclaw status${NC}           Estado do bot\n"
printf "    ${C}bollaclaw models${NC}           Modelos de IA\n"
printf "    ${C}bollaclaw soul${NC}             Personalidade\n"
printf "    ${C}bollaclaw web${NC}              Painel admin\n"
printf "    ${C}bollaclaw add <CODE>${NC}       Aprovar usuário\n"
printf "    ${C}bollaclaw users${NC}            Listar usuários\n"
printf "    ${C}bollaclaw update${NC}           Atualizar do GitHub\n"
printf "    ${C}bollaclaw restart${NC}          Reiniciar\n"
printf "    ${C}bollaclaw logs${NC}             Ver logs\n"
printf "    ${C}bollaclaw help${NC}             Todos os comandos\n"
echo ""

# ── Auto features
printf "  ${W}AUTOMAÇÕES${NC}\n\n"
printf "    ${G}●${NC}  ${BOLD}Crash recovery${NC}     PM2 reinicia automaticamente\n"
printf "    ${G}●${NC}  ${BOLD}Boot startup${NC}       systemd inicia PM2 + bot\n"
printf "    ${G}●${NC}  ${BOLD}Memory guard${NC}       Reinicia se RAM > 512MB\n"
printf "    ${G}●${NC}  ${BOLD}Auto-update${NC}        Verifica GitHub a cada 5min\n"
printf "    ${G}●${NC}  ${BOLD}Soul bootstrap${NC}     Configura via Telegram na 1ª msg\n"
printf "    ${G}●${NC}  ${BOLD}Semantic memory${NC}    Memória longa com embeddings locais\n"
echo ""

# ── Telemetry
printf "  ${W}TELEMETRIA${NC}\n\n"
if [ "$BOLLAWATCH_OK" = true ]; then
  printf "    ${G}●${NC}  Conectado  ${C}${BOLLAWATCH_URL}${NC}\n"
else
  printf "    ${Y}○${NC}  Pendente   ${DIM}Será ativada quando BollaWatch estiver online${NC}\n"
fi
echo ""

hr2 "$G"
echo ""
printf "  ${DIM}Log: cat ${LOG_FILE}${NC}\n"
printf "  ${DIM}Docs: ${UL}https://github.com/LucasBolla94/BollaClaw${NC}\n"
echo ""
