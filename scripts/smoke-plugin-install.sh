#!/usr/bin/env bash
set -euo pipefail

# OpenClaw-style consumer smoke: pack plugin → temp install with OpenClaw npm
# flags → import bundled cores from the installed plugin package.
# Usage: bash scripts/smoke-plugin-install.sh [plugin|trust|all]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

target="${1:-all}"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# Resolve a path npm/Node on this host can open (Windows Git Bash → drive path).
npm_path() {
  node -e "process.stdout.write(require('path').resolve(process.argv[1]))" "$1"
}

smoke_one() {
  local pkg_dir="$1" expected_core="$2" label="$3"
  echo "=== Smoke: $label ==="
  (cd "$ROOT/$pkg_dir" && npm run build --if-present && npm run bundle:deps)

  local pack_dir="$TMP/pack-$label"
  mkdir -p "$pack_dir"
  (cd "$ROOT/$pkg_dir" && npm pack --pack-destination "$(npm_path "$pack_dir")" --ignore-scripts >/dev/null)

  local tgz
  tgz="$(ls "$pack_dir"/ovrsr-openclaw-fpp-*.tgz 2>/dev/null | head -1 || true)"
  [[ -n "$tgz" && -f "$tgz" ]] || { echo "FAIL: no tarball for $label in $pack_dir"; return 1; }

  # Install via a relative path inside the isolate dir so Windows npm never
  # mis-parses a drive-letter/Unix hybrid path as the monorepo package dir.
  local isol="$TMP/isol-$label"
  mkdir -p "$isol"
  local tgz_base
  tgz_base="$(basename "$tgz")"
  cp "$tgz" "$isol/$tgz_base"
  (cd "$isol" && npm init -y >/dev/null 2>&1)
  (cd "$isol" && npm install --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts "./$tgz_base")

  local plugin_dir
  plugin_dir="$(cd "$isol" && node -e "
    const fs=require('fs');const path=require('path');
    const scope=path.join('node_modules','@ovrsr');
    for (const e of fs.readdirSync(scope)) {
      if (e.startsWith('openclaw-fpp-')) { process.stdout.write(path.join(scope,e)); break; }
    }
  ")"
  [[ -d "$isol/$plugin_dir" ]] || { echo "FAIL: plugin dir missing"; return 1; }
  [[ -f "$isol/$plugin_dir/dist/index.js" ]] || { echo "FAIL: dist/index.js missing"; return 1; }

  printf "import('%s').then(m=>{if(!m||typeof m!=='object')process.exit(1); console.log('ok', Object.keys(m).slice(0,5).join(','));}).catch(e=>{console.error(e);process.exit(1)})\n" \
    "$expected_core" > "$isol/$plugin_dir/_smoke.mjs"
  (cd "$isol/$plugin_dir" && node "_smoke.mjs")
  echo "PASS: $label isolated OpenClaw-style install"
}

case "$target" in
  plugin) smoke_one plugin "@ovrsr/fpp-enforcement-core" "enforcement-plugin" ;;
  trust)  smoke_one plugin-trust "@ovrsr/fpp-trust-core" "trust-plugin" ;;
  all)
    smoke_one plugin "@ovrsr/fpp-enforcement-core" "enforcement-plugin"
    smoke_one plugin-trust "@ovrsr/fpp-trust-core" "trust-plugin"
    ;;
  *) echo "Usage: $0 [plugin|trust|all]"; exit 1 ;;
esac

echo "All smoke checks passed."
