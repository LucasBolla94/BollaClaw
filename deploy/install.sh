#!/bin/bash
# BollaClaw V0.1 - Ubuntu Server Setup Script
# Run as: bash install.sh

set -e
echo "=========================================="
echo " BollaClaw V0.1 - Installation Script"
echo "=========================================="

# Check Ubuntu
if ! command -v apt &> /dev/null; then
  echo "This script is for Ubuntu/Debian systems only."
  exit 1
fi

echo ""
echo "[1/7] Updating system packages..."
sudo apt update -q

echo ""
echo "[2/7] Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node.js version: $(node --version)"

echo ""
echo "[3/7] Installing PM2..."
sudo npm install -g pm2
pm2 --version

echo ""
echo "[4/7] Installing edge-tts (TTS engine)..."
if command -v python3 &> /dev/null; then
  pip3 install edge-tts --break-system-packages 2>/dev/null || pip3 install edge-tts
  echo "edge-tts installed"
else
  echo "WARNING: Python3 not found. TTS will be disabled."
fi

echo ""
echo "[5/7] Installing ffmpeg (required for audio processing)..."
sudo apt install -y ffmpeg
echo "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

echo ""
echo "[6/7] Setting up BollaClaw..."
cd "$(dirname "$0")/.."  # Go to project root

# Install dependencies
npm install

# Build TypeScript
npm run build

# Copy and configure env
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  .env file created from template."
  echo "   Please edit .env with your API keys before starting:"
  echo "   nano .env"
fi

# Create required directories
mkdir -p data tmp logs output

echo ""
echo "[7/7] Setting up PM2 startup..."
pm2 startup | tail -1 | bash 2>/dev/null || true

echo ""
echo "=========================================="
echo " ✅ Installation complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Edit your .env file:      nano .env"
echo "  2. Start BollaClaw:          npm run pm2:start"
echo "  3. Check logs:               npm run pm2:logs"
echo "  4. Admin panel:              http://YOUR_SERVER_IP:3000"
echo ""
echo "To run in development mode:    npm run dev"
echo "To setup nginx proxy:          see deploy/nginx.conf"
