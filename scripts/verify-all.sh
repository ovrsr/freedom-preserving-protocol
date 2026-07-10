#!/usr/bin/env bash
# Run the full local/CI verification gate for all packages.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

echo "=== verify:all (Node $(node -v)) ==="

echo ""
echo "--- Constitution signature ---"
npm run verify

echo ""
echo "--- Classifier self-test ---"
npm run self-test

echo ""
echo "--- Typecheck (plugin + plugin-trust) ---"
npm run typecheck

echo ""
echo "--- Tests (plugins + scripts + corpus + self-test) ---"
npm run test:all

echo ""
echo "--- Package contents (dry-run) ---"
bash scripts/verify-pack.sh

echo ""
echo "=== verify:all PASSED ==="
