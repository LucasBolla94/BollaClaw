#!/bin/bash
# ============================================================
# BollaClaw Memory v2 — Full Deployment Script
# Run on Server 1 (ubuntu@server1.bolla.network)
# ============================================================
set -e

echo "🚀 BollaClaw Memory v2 — Full Deployment"
echo "=========================================="

BOLLACLAW_DIR="/opt/bollaclaw"

# ── Step 1: Setup PostgreSQL + pgvector ───────────────────
echo ""
echo "📦 Step 1: Setting up PostgreSQL + pgvector..."

# Check if PostgreSQL is already installed
if command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL already installed, skipping..."
else
  bash "$BOLLACLAW_DIR/scripts/setup-postgres.sh"
fi

# Ensure database exists and schema is up to date
echo "Ensuring database and schema..."
sudo -u postgres psql -d bollaclaw_memory -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || {
  echo "Creating database..."
  bash "$BOLLACLAW_DIR/scripts/setup-postgres.sh"
}

# ── Step 2: Pull latest code ─────────────────────────────
echo ""
echo "📥 Step 2: Pulling latest code..."
cd "$BOLLACLAW_DIR"
git pull origin main

# ── Step 3: Install dependencies ─────────────────────────
echo ""
echo "📦 Step 3: Installing dependencies..."
npm install

# ── Step 4: Add PG_CONNECTION_STRING to .env ─────────────
echo ""
echo "🔐 Step 4: Configuring .env..."
if ! grep -q "PG_CONNECTION_STRING" .env 2>/dev/null; then
  echo "" >> .env
  echo "# Memory v2 — PostgreSQL + pgvector" >> .env
  echo "PG_CONNECTION_STRING=postgresql://bollaclaw:bollaclaw_mem_2026@127.0.0.1:5432/bollaclaw_memory" >> .env
  echo "MAX_CONTEXT_TOKENS=50000" >> .env
  echo "Added PG_CONNECTION_STRING to .env"
else
  echo "PG_CONNECTION_STRING already in .env, skipping..."
fi

# ── Step 5: Build TypeScript ─────────────────────────────
echo ""
echo "🔨 Step 5: Building TypeScript..."
npm run build

# ── Step 6: Restart PM2 ─────────────────────────────────
echo ""
echo "♻️  Step 6: Restarting BollaClaw..."
pm2 restart bollaclaw

# ── Step 7: Verify ───────────────────────────────────────
echo ""
echo "✅ Step 7: Verifying..."
sleep 3
pm2 logs bollaclaw --lines 20 --nostream

echo ""
echo "============================================================"
echo "✅ Memory v2 deployed successfully!"
echo ""
echo "Check logs: pm2 logs bollaclaw"
echo "Check status: curl -s http://127.0.0.1:21086/api/status | jq '.memoryBackend'"
echo "============================================================"
