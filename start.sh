#!/usr/bin/env bash
# start.sh — Levanta el backend FastAPI + frontend Next.js

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}🎬  ClipFinder — Starting servers${NC}"
echo "════════════════════════════════════"

# Check .env
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}⚠️  No .env file found. Copy .env.example and add your API keys.${NC}"
  exit 1
fi

# Check venv
if [ ! -d ".venv" ]; then
  echo -e "${YELLOW}⚠️  No .venv found. Run: python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[web]'${NC}"
  exit 1
fi

# Check node_modules in web/
if [ ! -d "web/node_modules" ]; then
  echo "📦 Installing Next.js dependencies..."
  cd web && npm install --silent && cd ..
fi

echo -e "${GREEN}▶ Starting FastAPI backend on http://localhost:8000${NC}"
"$SCRIPT_DIR/.venv/bin/python" -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload &
FASTAPI_PID=$!

sleep 2  # Give FastAPI a moment to start

echo -e "${GREEN}▶ Starting Next.js frontend on http://localhost:3000${NC}"
cd web && npm run dev -- --port 3000 &
NEXTJS_PID=$!

echo ""
echo "════════════════════════════════════"
echo -e "  ${CYAN}Backend:${NC}  http://localhost:8000"
echo -e "  ${CYAN}Frontend:${NC} http://localhost:3000  ← Open this"
echo "════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop both servers."
echo ""

# Wait and handle shutdown
trap "echo ''; echo 'Shutting down...'; kill $FASTAPI_PID $NEXTJS_PID 2>/dev/null; exit 0" INT TERM
wait
