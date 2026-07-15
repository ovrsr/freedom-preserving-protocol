#!/usr/bin/env bash
set -euo pipefail

# Isolated pack proof for harness adapters (unpublished @ovrsr/* bundled).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

errors=0
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

for adapter in cursor claude-code codex; do
  dir="$ROOT/adapters/$adapter"
  echo "--- Packing adapters/$adapter ---"
  (cd "$dir" && npm run build --if-present && npm run bundle:deps && npm pack --pack-destination "$TMP" --ignore-scripts >/dev/null)

  tgz="$(ls "$TMP"/ovrsr-fpp-adapter-"$adapter"-*.tgz 2>/dev/null | head -1)"
  if [[ -z "$tgz" ]]; then
    # claude-code package name uses the full slug
    tgz="$(ls "$TMP"/ovrsr-fpp-adapter-*.tgz 2>/dev/null | grep -i "$adapter" | head -1 || true)"
  fi
  if [[ -z "$tgz" || ! -f "$tgz" ]]; then
    echo "FAIL: no tarball for adapters/$adapter"
    errors=$((errors + 1))
    continue
  fi

  isol="$TMP/isol-$adapter"
  mkdir -p "$isol"
  (cd "$isol" && npm init -y >/dev/null 2>&1)
  if ! (cd "$isol" && npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts "$tgz" >/dev/null 2>&1); then
    echo "FAIL: isolated install failed for adapters/$adapter"
    errors=$((errors + 1))
    continue
  fi

  plugin_dir="$(cd "$isol" && node -e "
    const fs=require('fs');const path=require('path');
    const scope=path.join('node_modules','@ovrsr');
    for (const e of fs.readdirSync(scope)) {
      if (e.startsWith('fpp-adapter-')) { process.stdout.write(path.join(scope,e)); break; }
    }
  ")"
  check_js="$isol/$plugin_dir/_isol_check.mjs"
  printf "import('@ovrsr/fpp-enforcement-core').then(m=>{if(!m||typeof m!=='object')process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})\n" > "$check_js"
  if (cd "$isol/$plugin_dir" && node "_isol_check.mjs"); then
    echo "PASS: isolated adapter install resolves enforcement-core for $adapter"
  else
    echo "FAIL: isolated adapter cannot resolve enforcement-core for $adapter"
    errors=$((errors + 1))
  fi
done

if [[ $errors -gt 0 ]]; then
  echo "FAILED: $errors adapter pack check(s)"
  exit 1
fi
echo "All adapter packs verified."
