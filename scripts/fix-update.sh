#!/bin/bash
# ============================================================
# BollaClaw — One-time fix for bollaclaw update command
# ============================================================
# The bollaclaw update command had a bug where projectRoot
# resolved to dist/ instead of the project root.
# This script applies the fix manually.
#
# Usage: cd /opt/bollaclaw && bash scripts/fix-update.sh
# ============================================================

set -euo pipefail

GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[0;31m'
NC=$'\033[0m'

INSTALL_DIR="${1:-/opt/bollaclaw}"

echo ""
echo "  ${GREEN}🔧 BollaClaw — Fix Update Command${NC}"
echo ""

cd "$INSTALL_DIR"

echo "  ├─ Fazendo git pull..."
git fetch origin --quiet
git reset --hard origin/main
echo "  ├─ ${GREEN}✔ Pull OK${NC}"

echo "  ├─ npm install..."
npm install --production=false --quiet 2>&1
echo "  ├─ ${GREEN}✔ Install OK${NC}"

echo "  ├─ Compilando..."
npm run build 2>&1
echo "  ├─ ${GREEN}✔ Build OK${NC}"

# Verify
if [ -f "dist/main.js" ]; then
  echo "  ├─ ${GREEN}✔ dist/main.js encontrado${NC}"
else
  echo "  ├─ ${RED}✘ dist/main.js NÃO encontrado!${NC}"
  exit 1
fi

if [ -f "dist/bin/bollaclaw.js" ]; then
  echo "  ├─ ${GREEN}✔ dist/bin/bollaclaw.js encontrado${NC}"
else
  echo "  ├─ ${RED}✘ dist/bin/bollaclaw.js NÃO encontrado!${NC}"
  exit 1
fi

echo "  ├─ Reiniciando PM2..."
pm2 restart bollaclaw --update-env 2>/dev/null || pm2 start ecosystem.config.js
echo "  └─ ${GREEN}✔ Tudo pronto! O bollaclaw update agora funciona corretamente.${NC}"
echo ""
echo "  Teste com: ${YELLOW}bollaclaw update${NC}"
echo ""
