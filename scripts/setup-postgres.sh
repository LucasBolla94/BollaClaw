#!/bin/bash
# ============================================================
# BollaClaw Memory v2 — PostgreSQL + pgvector Setup
# Run on Server 1 (ubuntu@server1.bolla.network)
# ============================================================
set -e

echo "🔧 BollaClaw Memory v2 — PostgreSQL + pgvector Setup"
echo "====================================================="

# 1. Install PostgreSQL 16
echo ""
echo "📦 Installing PostgreSQL 16..."
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql-16 postgresql-contrib-16 postgresql-server-dev-16

# 2. Install pgvector
echo ""
echo "📦 Installing pgvector..."
if ! dpkg -l | grep -q postgresql-16-pgvector; then
  # Try apt first (Ubuntu 24.04+ has it)
  if apt-cache show postgresql-16-pgvector >/dev/null 2>&1; then
    sudo apt-get install -y -qq postgresql-16-pgvector
  else
    # Build from source
    echo "Building pgvector from source..."
    cd /tmp
    git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git
    cd pgvector
    make
    sudo make install
    cd -
    rm -rf /tmp/pgvector
  fi
fi

# 3. Start PostgreSQL
echo ""
echo "🚀 Starting PostgreSQL..."
sudo systemctl enable postgresql
sudo systemctl start postgresql

# 4. Create database and user
echo ""
echo "🗄️  Creating database and user..."
sudo -u postgres psql <<'SQL'
-- Create user (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bollaclaw') THEN
    CREATE ROLE bollaclaw WITH LOGIN PASSWORD 'bollaclaw_mem_2026';
  END IF;
END
$$;

-- Create database (idempotent)
SELECT 'CREATE DATABASE bollaclaw_memory OWNER bollaclaw'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bollaclaw_memory')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE bollaclaw_memory TO bollaclaw;
SQL

# 5. Enable pgvector extension
echo ""
echo "🧠 Enabling pgvector extension..."
sudo -u postgres psql -d bollaclaw_memory <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

# 6. Run schema migration
echo ""
echo "📐 Creating schema..."
sudo -u postgres psql -d bollaclaw_memory <<'SQL'
-- Grant schema access to bollaclaw user
GRANT ALL ON SCHEMA public TO bollaclaw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO bollaclaw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO bollaclaw;

-- ============================================================
-- Long-term memories (facts, preferences, instructions, topics)
-- ============================================================
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL DEFAULT 50,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

-- ============================================================
-- Compacted conversation chunks (for context beyond 50k window)
-- ============================================================
CREATE TABLE IF NOT EXISTS context_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  summary_embedding vector(384) NOT NULL,
  message_count INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  time_start TIMESTAMPTZ NOT NULL,
  time_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Daily conversation summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period)
);

-- ============================================================
-- Indexes
-- ============================================================

-- HNSW indexes for fast vector similarity search
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON context_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_summary_embedding ON context_chunks USING hnsw (summary_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_summaries_embedding ON daily_summaries USING hnsw (embedding vector_cosine_ops);

-- B-tree indexes for filtering
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(user_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_user_conv ON context_chunks(user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_chunks_time ON context_chunks(user_id, time_end DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_user ON daily_summaries(user_id, period);

-- Trigram index for keyword search
CREATE INDEX IF NOT EXISTS idx_memories_content_trgm ON memories USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm ON context_chunks USING gin (content gin_trgm_ops);

SQL

# 7. Configure pg_hba for local connections
echo ""
echo "🔐 Configuring authentication..."
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file" | tr -d ' ')
if ! grep -q "bollaclaw" "$PG_HBA" 2>/dev/null; then
  sudo sed -i '/^# IPv4 local connections/a host    bollaclaw_memory    bollaclaw    127.0.0.1/32    md5' "$PG_HBA"
  sudo systemctl reload postgresql
fi

# 8. Test connection
echo ""
echo "✅ Testing connection..."
PGPASSWORD=bollaclaw_mem_2026 psql -h 127.0.0.1 -U bollaclaw -d bollaclaw_memory -c "SELECT 'BollaClaw Memory v2 ready!' AS status, vector_dims('[1,2,3]'::vector) AS pgvector_test;"

echo ""
echo "============================================================"
echo "✅ Setup complete!"
echo ""
echo "Connection string for .env:"
echo "  PG_CONNECTION_STRING=postgresql://bollaclaw:bollaclaw_mem_2026@127.0.0.1:5432/bollaclaw_memory"
echo ""
echo "Add this to /opt/bollaclaw/.env and restart the bot."
echo "============================================================"
