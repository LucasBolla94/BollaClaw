#!/bin/bash
# Build the BollaClaw WebPanel (Next.js static export)
# Run this from the webpanel/ directory

set -e

echo "📦 Installing dependencies..."
npm install --production=false

echo "🔨 Building Next.js..."
npx next build

echo "✅ Build complete! Output in ./out/"
echo "   The AdminServer will automatically serve from webpanel/out/"
