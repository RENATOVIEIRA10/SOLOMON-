#!/bin/bash
# =============================================================================
# SOLOMON — VPS Playwright Setup
#
# Installs Playwright + Chromium on Ubuntu/Debian VPS for PDF crawling.
# Run as root or with sudo.
#
# Usage:
#   ssh root@104.131.187.118 "bash -s" < scripts/setup-vps-playwright.sh
#   # or copy to VPS and run:
#   chmod +x setup-vps-playwright.sh && ./setup-vps-playwright.sh
# =============================================================================

set -euo pipefail

echo "============================================"
echo "SOLOMON — VPS Playwright Setup"
echo "============================================"

# ---------------------------------------------------------------------------
# 1. System deps for Chromium
# ---------------------------------------------------------------------------
echo ""
echo "[1/5] Installing system dependencies..."

apt-get update -qq

apt-get install -y --no-install-recommends \
  libnss3 \
  libnspr4 \
  libdbus-1-3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  libatspi2.0-0 \
  fonts-liberation \
  fonts-noto-color-emoji \
  xvfb \
  wget \
  ca-certificates

echo "[1/5] Done."

# ---------------------------------------------------------------------------
# 2. Node.js (if not installed)
# ---------------------------------------------------------------------------
echo ""
echo "[2/5] Checking Node.js..."

if ! command -v node &> /dev/null; then
  echo "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

node_version=$(node -v)
echo "Node.js: $node_version"

# ---------------------------------------------------------------------------
# 3. SOLOMON project setup
# ---------------------------------------------------------------------------
echo ""
echo "[3/5] Setting up SOLOMON project..."

SOLOMON_DIR="/root/solomon"

if [ ! -d "$SOLOMON_DIR" ]; then
  echo "Creating $SOLOMON_DIR..."
  mkdir -p "$SOLOMON_DIR"
  echo "NOTE: Copy the app/ directory from your local machine:"
  echo "  scp -r D:/repos/solomon/app root@104.131.187.118:/root/solomon/"
fi

if [ -d "$SOLOMON_DIR/app" ]; then
  cd "$SOLOMON_DIR/app"
  echo "Installing npm dependencies..."
  npm install --production=false
else
  echo "WARNING: $SOLOMON_DIR/app not found. Copy it first."
fi

# ---------------------------------------------------------------------------
# 4. Install Playwright + Chromium
# ---------------------------------------------------------------------------
echo ""
echo "[4/5] Installing Playwright and Chromium..."

if [ -d "$SOLOMON_DIR/app" ]; then
  cd "$SOLOMON_DIR/app"

  # Install playwright as dependency
  npm install playwright@latest

  # Install only Chromium (smaller than all browsers)
  npx playwright install chromium

  echo "Playwright + Chromium installed."
else
  echo "SKIPPED — app directory not found."
fi

# ---------------------------------------------------------------------------
# 5. Environment check
# ---------------------------------------------------------------------------
echo ""
echo "[5/5] Verifying setup..."

if [ -d "$SOLOMON_DIR/app" ]; then
  cd "$SOLOMON_DIR/app"

  # Check .env
  if [ ! -f ".env" ] && [ ! -f ".env.local" ]; then
    echo ""
    echo "WARNING: No .env file found. Create one with:"
    echo ""
    echo "  cat > $SOLOMON_DIR/app/.env << 'EOF'"
    echo "  SUPABASE_URL=https://ohmoyfbtfuznhlpjcbbk.supabase.co"
    echo "  SUPABASE_SERVICE_ROLE_KEY=your-key-here"
    echo "  OPENAI_API_KEY=your-key-here"
    echo "  EOF"
    echo ""
  fi

  # Test Playwright
  echo "Testing Playwright..."
  node -e "
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto('https://example.com');
      const title = await page.title();
      console.log('Browser test OK: ' + title);
      await browser.close();
    })().catch(e => { console.error('Browser test FAILED:', e.message); process.exit(1); });
  "
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo "SETUP COMPLETE"
echo "============================================"
echo ""
echo "Run the crawler:"
echo "  cd $SOLOMON_DIR/app"
echo "  npx tsx scripts/crawl-pdfs-playwright.ts --dry-run"
echo ""
echo "Full crawl with embeddings:"
echo "  npx tsx scripts/crawl-pdfs-playwright.ts"
echo ""
echo "Single insurer test:"
echo "  npx tsx scripts/crawl-pdfs-playwright.ts --insurer 'Prudential' --skip-embeddings"
echo ""
echo "Add to cron (daily at 3am):"
echo "  echo '0 3 * * * cd $SOLOMON_DIR/app && npx tsx scripts/crawl-pdfs-playwright.ts --skip-embeddings >> /var/log/solomon-crawler.log 2>&1' | crontab -"
echo ""
