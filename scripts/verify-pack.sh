#!/usr/bin/env bash
set -euo pipefail

# Verify that npm pack output includes compiled dist/ for both plugin packages.
# Run before ClawHub publish to catch missing build artifacts.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

errors=0

for pkg in plugin plugin-trust; do
  echo "--- Verifying $pkg pack contents ---"
  cd "$ROOT/$pkg"

  if [ ! -f package.json ]; then
    echo "SKIP: $pkg/package.json not found"
    continue
  fi

  if [ "${SKIP_INSTALL:-}" = "1" ] || [ -d node_modules ]; then
    echo "Using existing node_modules for $pkg"
  else
    npm ci --ignore-scripts --quiet 2>/dev/null || npm install --ignore-scripts --quiet 2>/dev/null
  fi
  npm run build --if-present

  pack_list=$(npm pack --dry-run 2>&1)

  if echo "$pack_list" | grep -q "dist/index.js"; then
    echo "PASS: $pkg includes dist/index.js"
  else
    echo "FAIL: $pkg is missing dist/index.js in pack output"
    echo "$pack_list"
    errors=$((errors + 1))
  fi

  if echo "$pack_list" | grep -q "dist/index.d.ts"; then
    echo "PASS: $pkg includes dist/index.d.ts"
  else
    echo "WARN: $pkg is missing dist/index.d.ts (type declarations)"
  fi

  echo ""
done

if [ $errors -gt 0 ]; then
  echo "FAILED: $errors package(s) missing required dist/ artifacts."
  exit 1
fi

echo "All packages verified."

# Optional reproducibility + SBOM pass (no registry side effects)
if [[ "${SKIP_REPRO:-}" != "1" ]]; then
  echo ""
  echo "--- Package inventories and SBOMs ---"
  ASSURE_OUT="${ASSURANCE_OUT:-$ROOT/assurance-artifacts}"
  mkdir -p "$ASSURE_OUT"
  (cd "$ROOT" && npx tsx scripts/package-reproducibility.ts "$ASSURE_OUT")
fi
