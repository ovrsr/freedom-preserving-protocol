#!/usr/bin/env bash
set -euo pipefail

# Verify that npm pack output includes compiled dist/ for protocol-core,
# enforcement-core, trust-core, and both plugin packages. Enforces exact
# @ovrsr/fpp-protocol-core pins and optionally installs plugin tarballs in
# isolation with --ignore-scripts.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

errors=0

CORE_PKG="$ROOT/packages/protocol-core/package.json"
CORE_NAME="@ovrsr/fpp-protocol-core"
CORE_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version" "$CORE_PKG" | tr -d '\r\n')"

require_exact_core_dependency() {
  local pkg_json="$1" label="$2"
  local pinned
  pinned="$(node -p "
    const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    (p.dependencies && p.dependencies['@ovrsr/fpp-protocol-core']) || ''
  " "$pkg_json" | tr -d '\r\n')"
  if [[ -z "$pinned" ]]; then
    echo "FAIL: $label missing dependency $CORE_NAME"
    errors=$((errors + 1))
    return
  fi
  if [[ "$pinned" == *"^"* || "$pinned" == *"~"* || "$pinned" == *"*"* ]]; then
    echo "FAIL: $label must pin exact $CORE_NAME (got $pinned)"
    errors=$((errors + 1))
    return
  fi
  if [[ "$pinned" != "$CORE_VERSION" ]]; then
    echo "FAIL: $label $CORE_NAME version mismatch: pinned=$pinned core=$CORE_VERSION"
    errors=$((errors + 1))
    return
  fi
  echo "PASS: $label pins $CORE_NAME@$CORE_VERSION exactly"
}

verify_core_pack() {
  local dir="$1" label="$2"
  echo "=== $label (build before consumers) ==="
  cd "$dir"
  if [ ! -f package.json ]; then
    echo "FAIL: $dir/package.json not found"
    errors=$((errors + 1))
    return
  fi
  npm run build --if-present
  if [ ! -f dist/index.js ]; then
    echo "FAIL: $label missing dist/index.js after build"
    errors=$((errors + 1))
  else
    echo "PASS: $label dist/index.js present"
  fi
  pack_list=$(npm pack --dry-run 2>&1)
  if echo "$pack_list" | grep -q "dist/index.js"; then
    echo "PASS: $label pack includes dist/index.js"
  else
    echo "FAIL: $label pack missing dist/index.js"
    echo "$pack_list"
    errors=$((errors + 1))
  fi
  echo ""
}

verify_core_pack "$ROOT/packages/protocol-core" "protocol-core"
verify_core_pack "$ROOT/packages/enforcement-core" "enforcement-core"
require_exact_core_dependency "$ROOT/packages/enforcement-core/package.json" "enforcement-core"
verify_core_pack "$ROOT/packages/trust-core" "trust-core"
require_exact_core_dependency "$ROOT/packages/trust-core/package.json" "trust-core"

for pkg in plugin plugin-trust; do
  echo "--- Verifying $pkg pack contents ---"
  cd "$ROOT/$pkg"

  if [ ! -f package.json ]; then
    echo "SKIP: $pkg/package.json not found"
    continue
  fi

  require_exact_core_dependency "$ROOT/$pkg/package.json" "$pkg"

  if [ "${SKIP_INSTALL:-}" = "1" ] || [ -d "$ROOT/node_modules" ]; then
    echo "Using workspace node_modules for $pkg"
  else
    (cd "$ROOT" && npm ci --ignore-scripts --quiet 2>/dev/null) || \
      (cd "$ROOT" && npm install --ignore-scripts --quiet 2>/dev/null)
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

# Isolated install proof (plugins resolve core with lifecycle scripts disabled)
if [[ "${SKIP_ISOLATED_INSTALL:-}" != "1" ]]; then
  echo "--- Isolated plugin installs (--ignore-scripts) ---"
  TMP="$(mktemp -d)"
  cleanup() { rm -rf "$TMP"; }
  trap cleanup EXIT

  (cd "$ROOT/packages/protocol-core" && npm pack --pack-destination "$TMP" >/dev/null)
  CORE_TGZ="$(ls "$TMP"/ovrsr-fpp-protocol-core-*.tgz | head -1)"

  for pkg in plugin plugin-trust; do
    (cd "$ROOT/$pkg" && npm pack --pack-destination "$TMP" >/dev/null)
  done

  for tgz in "$TMP"/ovrsr-openclaw-fpp-*.tgz; do
    name="$(basename "$tgz" .tgz)"
    isol="$TMP/isol-$name"
    mkdir -p "$isol"
    (cd "$isol" && npm init -y >/dev/null 2>&1)
    if ! (cd "$isol" && npm install --ignore-scripts "$CORE_TGZ" "$tgz" >/dev/null 2>&1); then
      echo "FAIL: isolated install failed for $name"
      errors=$((errors + 1))
      continue
    fi
    if (cd "$isol" && node --input-type=module -e "import('@ovrsr/fpp-protocol-core').then(m=>{if(m.PACKAGE_NAME!=='@ovrsr/fpp-protocol-core')process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"); then
      echo "PASS: isolated install resolves core for $name"
    else
      echo "FAIL: isolated install cannot resolve core for $name"
      errors=$((errors + 1))
    fi
  done
  echo ""
fi

if [ $errors -gt 0 ]; then
  echo "FAILED: $errors package check(s) failed."
  exit 1
fi

echo "All packages verified (cores before consumers)."

# Optional reproducibility + SBOM pass (no registry side effects)
if [[ "${SKIP_REPRO:-}" != "1" ]]; then
  echo ""
  echo "--- Package inventories and SBOMs ---"
  ASSURE_OUT="${ASSURANCE_OUT:-$ROOT/assurance-artifacts}"
  mkdir -p "$ASSURE_OUT"
  (cd "$ROOT" && npx tsx scripts/package-reproducibility.ts "$ASSURE_OUT")
fi
