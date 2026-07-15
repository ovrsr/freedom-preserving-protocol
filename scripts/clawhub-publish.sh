#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OWNER="ovrsr"
SOURCE_REPO="https://github.com/ovrsr/freedom-preserving-protocol"

# ── Targets ──────────────────────────────────────────────────────────
CORE_DIR="packages/protocol-core"
CORE_NAME="@ovrsr/fpp-protocol-core"
SKILL_SLUG="freedom-preserving-protocol"
SKILL_DISPLAY_NAME="Freedom Preserving Protocol"
PLUGIN_NAME="@ovrsr/openclaw-fpp-plugin"
PLUGIN_DIR="plugin"
TRUST_NAME="@ovrsr/openclaw-fpp-trust"
TRUST_DIR="plugin-trust"

# ── Helpers ──────────────────────────────────────────────────────────

red()    { printf '\033[1;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

die() { red "ERROR: $*" >&2; exit 1; }

# On Windows, clawhub's internal `npm pack` spawn often fails with
# "spawnSync npm ENOENT". Pre-pack with npm ourselves and publish the tarball.
needs_tarball_publish() {
  [[ "${OS:-}" == "Windows_NT" ]] || [[ "$(uname -s 2>/dev/null || true)" == MINGW* ]] \
    || [[ "$(uname -s 2>/dev/null || true)" == MSYS* ]] \
    || [[ "$(uname -s 2>/dev/null || true)" == CYGWIN* ]]
}

# Publish a code-plugin: dir on Unix, npm-pack tarball on Windows.
clawhub_package_publish() {
  local pkg_dir="$1" name="$2" ver="$3" sha="$4" changelog="$5"
  local abs_dir="$REPO_ROOT/$pkg_dir"

  if needs_tarball_publish; then
    yellow "  [windows] packing $pkg_dir via npm pack (clawhub spawnSync npm workaround)"
    local pack_out tgz
    # prepack may print staging logs on stderr; take the last .tgz filename from stdout
    pack_out="$(cd "$abs_dir" && npm pack --silent | tr -d '\r')" \
      || die "npm pack failed in $pkg_dir"
    tgz="$(printf '%s\n' "$pack_out" | grep '\.tgz$' | tail -1)"
    [[ -n "$tgz" && -f "$abs_dir/$tgz" ]] || die "npm pack produced no tarball in $pkg_dir (got: ${tgz:-<empty>})"
    (cd "$abs_dir" && clawhub package publish "$tgz" \
      --family code-plugin \
      --name "$name" \
      --version "$ver" \
      --source-repo "$SOURCE_REPO" \
      --source-commit "$sha" \
      --changelog "$changelog" \
      --owner "$OWNER")
    rm -f "$abs_dir/$tgz"
  else
    (cd "$REPO_ROOT" && clawhub package publish "$pkg_dir/" \
      --family code-plugin \
      --name "$name" \
      --version "$ver" \
      --source-repo "$SOURCE_REPO" \
      --source-commit "$sha" \
      --changelog "$changelog" \
      --owner "$OWNER")
  fi
}

usage() {
  cat <<'USAGE'
ClawHub publish script for Freedom Preserving Protocol

USAGE:
  clawhub-publish.sh <command> [target] [options]

COMMANDS:
  publish <target>   Build, verify, and publish to ClawHub
  bump    <target>   Bump version (patch by default)
  status             Show current versions of all targets

TARGETS:
  skill              Root skill (freedom-preserving-protocol)
  plugin             Enforcement plugin (@ovrsr/openclaw-fpp-plugin)
  trust              Trust plugin (@ovrsr/openclaw-fpp-trust)
  all                Skill + plugins (protocol-core is built/checked first)

Release order for consumers: build cores → bundle into consumers (bundledDependencies)
→ skill / enforcement plugin / trust plugin. Cores are NOT published to ClawHub or npm;
they ship embedded in plugin tarballs. Rollback: republish the previous plugin version
(which embeds the previous core pins).

OPTIONS:
  --bump <level>     Version bump level: major | minor | patch (default: patch)
  --version <ver>    Explicit semver to set (overrides --bump)
  --changelog <msg>  Changelog message (required for publish)
  --dry-run          Show what would happen without executing
  --skip-tests       UNSAFE / maintainer-only: skip pre-publish verification
                     (also requires FPP_ALLOW_SKIP_TESTS=1)
  --help             Show this help

EXAMPLES:
  # Publish skill with auto patch bump
  ./scripts/clawhub-publish.sh publish skill --changelog "Fix adoption docs"

  # Bump plugin to specific version without publishing
  ./scripts/clawhub-publish.sh bump plugin --version 1.2.0

  # Publish everything with minor bump
  ./scripts/clawhub-publish.sh publish all --bump minor --changelog "Add trust metrics"

  # Check current versions
  ./scripts/clawhub-publish.sh status
USAGE
  exit 0
}

get_json_version() {
  node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version" "$1" | tr -d '\r\n'
}

get_skill_version() {
  sed -n 's/^version: *//p' "$REPO_ROOT/SKILL.md" | tr -d '[:space:]'
}

bump_semver() {
  local ver="$1" level="$2"
  IFS='.' read -r major minor patch <<< "$ver"
  case "$level" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *) die "Invalid bump level: $level (use major|minor|patch)" ;;
  esac
}

set_json_version() {
  local pkg="$1" new_ver="$2"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    p.version = process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + '\n');
  " "$pkg" "$new_ver"
}

set_skill_version() {
  local new_ver="$1"
  local skill="$REPO_ROOT/SKILL.md"
  # Replace version line in YAML frontmatter
  sed -i "s/^version: .*/version: $new_ver/" "$skill"
}

git_sha() {
  git -C "$REPO_ROOT" rev-parse HEAD
}

require_clean_tree() {
  if ! git -C "$REPO_ROOT" diff --quiet HEAD 2>/dev/null; then
    yellow "WARNING: working tree has uncommitted changes"
  fi
}

require_clawhub() {
  command -v clawhub >/dev/null 2>&1 || die "clawhub CLI not found. Install: npm i -g clawhub"
}

require_lockfile_sync() {
  local pkg="$1" lock="$2" label="$3"
  local pkg_ver lock_ver
  pkg_ver="$(get_json_version "$pkg")"
  lock_ver="$(node -p "const l=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); (l.packages && l.packages[''] && l.packages[''].version) || l.version || ''" "$lock" | tr -d '\r\n')"
  [[ "$pkg_ver" == "$lock_ver" ]] || die "$label version mismatch: package.json=$pkg_ver lockfile=$lock_ver"
}

require_exact_core_dependency() {
  local pkg="$1" label="$2"
  local core_ver pinned
  core_ver="$(get_json_version "$REPO_ROOT/$CORE_DIR/package.json")"
  pinned="$(node -p "
    const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    (p.dependencies && p.dependencies['@ovrsr/fpp-protocol-core']) || ''
  " "$pkg" | tr -d '\r\n')"
  [[ -n "$pinned" ]] || die "$label missing dependency $CORE_NAME"
  if [[ "$pinned" == *"^"* || "$pinned" == *"~"* || "$pinned" == *"*"* ]]; then
    die "$label must pin exact $CORE_NAME (got $pinned)"
  fi
  [[ "$pinned" == "$core_ver" ]] || die "$label $CORE_NAME mismatch: pinned=$pinned core=$core_ver"
  green "  ✓ $label pins $CORE_NAME@$core_ver"
}

# Fail if plugin tarball would ship without embedded @ovrsr cores.
require_bundled_cores() {
  local pkg_dir="$1" label="$2"
  shift 2
  local expected=("$@")
  local pkg_json="$REPO_ROOT/$pkg_dir/package.json"
  local bundled
  bundled="$(node -p "
    const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    JSON.stringify(p.bundledDependencies || p.bundleDependencies || [])
  " "$pkg_json" | tr -d '\r\n')"

  for name in "${expected[@]}"; do
    echo "$bundled" | grep -q "$name" \
      || die "$label missing $name in bundledDependencies (got $bundled)"
  done

  bold "Verifying $label pack embeds bundled cores..."
  (cd "$REPO_ROOT/$pkg_dir" && npm run bundle:deps)

  # Real pack (not --dry-run): dry-run listings omit node_modules paths on some npm versions.
  local pack_tmp tgz listing
  pack_tmp="$(mktemp -d)"
  (cd "$REPO_ROOT/$pkg_dir" && npm pack --pack-destination "$pack_tmp" --ignore-scripts >/dev/null) \
    || { rm -rf "$pack_tmp"; die "$label npm pack failed"; }
  tgz="$(ls "$pack_tmp"/*.tgz 2>/dev/null | head -1)"
  [[ -n "$tgz" && -f "$tgz" ]] || { rm -rf "$pack_tmp"; die "$label npm pack produced no tarball"; }
  listing="$(tar --force-local -tzf "$tgz" 2>/dev/null || tar -tzf "$tgz")"
  rm -rf "$pack_tmp"

  for name in "${expected[@]}"; do
    local short="${name#@ovrsr/}"
    echo "$listing" | grep -q "node_modules/@ovrsr/$short/" \
      || die "$label pack missing bundled path node_modules/@ovrsr/$short/ — refuse publish"
  done
  echo "$listing" | grep -q "dist/index.js" \
    || die "$label pack missing dist/index.js"
  green "  ✓ $label tarball embeds: ${expected[*]}"
}

run_strict_checks_core() {
  bold "Building and testing protocol-core before consumers..."
  (cd "$REPO_ROOT" && npm run build -w "$CORE_NAME")
  (cd "$REPO_ROOT" && npm run typecheck -w "$CORE_NAME")
  (cd "$REPO_ROOT" && npm test -w "$CORE_NAME")
  [[ -f "$REPO_ROOT/$CORE_DIR/dist/index.js" ]] || die "protocol-core build missing dist/index.js"
  green "  ✓ protocol-core checks passed (core before consumers)"
}

run_strict_checks_skill() {
  bold "Running pre-publish checks for skill (fail-hard)..."
  (cd "$REPO_ROOT" && npm run verify)
  (cd "$REPO_ROOT" && npx tsx scripts/stage-skill.ts --out skill-dist)
  (cd "$REPO_ROOT" && npx tsx scripts/skill-self-check.ts --root skill-dist)
  green "  ✓ Skill checks passed (verify + stage + skill-self-check)"
}

stage_skill_dist() {
  bold "Staging OpenClaw-only skill → skill-dist/..."
  (cd "$REPO_ROOT" && npx tsx scripts/stage-skill.ts --out skill-dist)
  [[ -f "$REPO_ROOT/skill-dist/SKILL.md" ]] || die "skill-dist/SKILL.md missing after stage"
  [[ -f "$REPO_ROOT/skill-dist/package.json" ]] || die "skill-dist/package.json missing after stage"
  green "  ✓ skill-dist staged"
}

run_strict_checks_plugin() {
  bold "Building, typechecking, and testing enforcement plugin (fail-hard)..."
  run_strict_checks_core
  require_exact_core_dependency "$REPO_ROOT/$PLUGIN_DIR/package.json" "enforcement plugin"
  require_bundled_cores "$PLUGIN_DIR" "enforcement plugin" \
    "@ovrsr/fpp-protocol-core" "@ovrsr/fpp-enforcement-core"
  (cd "$REPO_ROOT" && npm run typecheck -w "$PLUGIN_NAME")
  (cd "$REPO_ROOT" && npm run build -w "$PLUGIN_NAME")
  (cd "$REPO_ROOT" && npm test -w "$PLUGIN_NAME")
  (cd "$REPO_ROOT" && SKIP_ISOLATED_INSTALL=1 bash scripts/verify-pack.sh)
  if [[ -f "$REPO_ROOT/assurance-artifacts/release-manifest.json" ]]; then
    bold "Verifying signed release manifest (refuse invalid)..."
    (cd "$REPO_ROOT" && npm run release:verify -- --manifest assurance-artifacts/release-manifest.json) \
      || { red "  ✗ Invalid release manifest — refusing publish"; exit 1; }
  else
    yellow "  ⚠ No assurance-artifacts/release-manifest.json — skipping release-domain check"
  fi
  green "  ✓ Enforcement plugin checks passed"
}

run_strict_checks_trust() {
  bold "Building, typechecking, and testing trust plugin (fail-hard)..."
  run_strict_checks_core
  require_exact_core_dependency "$REPO_ROOT/$TRUST_DIR/package.json" "trust plugin"
  require_bundled_cores "$TRUST_DIR" "trust plugin" \
    "@ovrsr/fpp-protocol-core" "@ovrsr/fpp-trust-core"
  (cd "$REPO_ROOT" && npm run typecheck -w "$TRUST_NAME")
  (cd "$REPO_ROOT" && npm run build -w "$TRUST_NAME")
  (cd "$REPO_ROOT" && npm test -w "$TRUST_NAME")
  green "  ✓ Trust plugin checks passed"
}

# ── Version bump ─────────────────────────────────────────────────────

do_bump_skill() {
  local cur new_ver
  cur="$(get_json_version "$REPO_ROOT/package.json")"
  if [[ -n "$EXPLICIT_VERSION" ]]; then
    new_ver="$EXPLICIT_VERSION"
  else
    new_ver="$(bump_semver "$cur" "$BUMP_LEVEL")"
  fi
  bold "Skill: $cur → $new_ver"
  if [[ "$DRY_RUN" == "true" ]]; then
    yellow "  [dry-run] would update package.json and SKILL.md"
    return
  fi
  set_json_version "$REPO_ROOT/package.json" "$new_ver"
  set_skill_version "$new_ver"
  if [[ -f "$REPO_ROOT/skill/package.json" ]]; then
    set_json_version "$REPO_ROOT/skill/package.json" "$new_ver"
    green "  ✓ skill/package.json → $new_ver"
  fi
  green "  ✓ package.json  → $new_ver"
  green "  ✓ SKILL.md      → $new_ver"
}

do_bump_plugin() {
  local cur new_ver pkg="$REPO_ROOT/$PLUGIN_DIR/package.json"
  cur="$(get_json_version "$pkg")"
  if [[ -n "$EXPLICIT_VERSION" ]]; then
    new_ver="$EXPLICIT_VERSION"
  else
    new_ver="$(bump_semver "$cur" "$BUMP_LEVEL")"
  fi
  bold "Plugin: $cur → $new_ver"
  if [[ "$DRY_RUN" == "true" ]]; then
    yellow "  [dry-run] would update $PLUGIN_DIR/package.json"
    return
  fi
  set_json_version "$pkg" "$new_ver"
  green "  ✓ $PLUGIN_DIR/package.json → $new_ver"
}

do_bump_trust() {
  local cur new_ver pkg="$REPO_ROOT/$TRUST_DIR/package.json"
  cur="$(get_json_version "$pkg")"
  if [[ -n "$EXPLICIT_VERSION" ]]; then
    new_ver="$EXPLICIT_VERSION"
  else
    new_ver="$(bump_semver "$cur" "$BUMP_LEVEL")"
  fi
  bold "Trust: $cur → $new_ver"
  if [[ "$DRY_RUN" == "true" ]]; then
    yellow "  [dry-run] would update $TRUST_DIR/package.json"
    return
  fi
  set_json_version "$pkg" "$new_ver"
  green "  ✓ $TRUST_DIR/package.json → $new_ver"
}

# ── Publish ──────────────────────────────────────────────────────────

publish_skill() {
  local ver changelog="$CHANGELOG"

  do_bump_skill
  ver="$(get_json_version "$REPO_ROOT/package.json")"

  if [[ "$SKIP_TESTS" == "true" ]]; then
    yellow "  ⚠ UNSAFE: --skip-tests set (maintainer-only); skipping skill verification"
  else
    run_strict_checks_skill
  fi

  stage_skill_dist

  # Keep staged package.json / SKILL.md versions aligned with bumped root.
  if [[ "$DRY_RUN" != "true" ]]; then
    set_json_version "$REPO_ROOT/skill-dist/package.json" "$ver"
    if grep -q '^version:' "$REPO_ROOT/skill-dist/SKILL.md"; then
      sed -i.bak "s/^version: .*/version: $ver/" "$REPO_ROOT/skill-dist/SKILL.md"
      rm -f "$REPO_ROOT/skill-dist/SKILL.md.bak"
    fi
  fi

  bold "Publishing skill v${ver} from skill-dist/..."
  if [[ "$DRY_RUN" == "true" ]]; then
    yellow "  [dry-run] clawhub skill publish skill-dist --slug $SKILL_SLUG --name \"$SKILL_DISPLAY_NAME\" --version $ver --changelog \"$changelog\" --owner $OWNER"
    return
  fi

  (cd "$REPO_ROOT" && clawhub skill publish skill-dist \
    --slug "$SKILL_SLUG" \
    --name "$SKILL_DISPLAY_NAME" \
    --version "$ver" \
    --changelog "$changelog" \
    --owner "$OWNER")
  green "  ✓ Skill $SKILL_SLUG@$ver published"
}

publish_plugin() {
  local ver sha changelog="$CHANGELOG"

  do_bump_plugin
  ver="$(get_json_version "$REPO_ROOT/$PLUGIN_DIR/package.json")"
  sha="$(git_sha)"

  if [[ "$SKIP_TESTS" == "true" ]]; then
    yellow "  ⚠ UNSAFE: --skip-tests set (maintainer-only); skipping enforcement plugin verification"
    yellow "  [order] build cores → bundle into consumers → publish plugins (cores not on npm/ClawHub)"
    require_exact_core_dependency "$REPO_ROOT/$PLUGIN_DIR/package.json" "enforcement plugin"
    require_bundled_cores "$PLUGIN_DIR" "enforcement plugin" \
      "@ovrsr/fpp-protocol-core" "@ovrsr/fpp-enforcement-core"
    if [[ -x "$REPO_ROOT/scripts/smoke-plugin-install.sh" ]] || [[ -f "$REPO_ROOT/scripts/smoke-plugin-install.sh" ]]; then
      bold "Running OpenClaw-style install smoke for enforcement plugin..."
      (cd "$REPO_ROOT" && bash scripts/smoke-plugin-install.sh plugin)
    fi
  else
    run_strict_checks_plugin
  fi

  bold "Publishing enforcement plugin v${ver}..."
  if [[ "$DRY_RUN" == "true" ]]; then
    yellow "  [dry-run] clawhub package publish $PLUGIN_DIR/ --family code-plugin --name $PLUGIN_NAME --version $ver --source-repo $SOURCE_REPO --source-commit $sha --changelog \"$changelog\" --owner $OWNER"
    green "  ✓ [dry-run] bundle verification already succeeded for enforcement plugin"
    return
  fi

  clawhub_package_publish "$PLUGIN_DIR" "$PLUGIN_NAME" "$ver" "$sha" "$changelog"
  green "  ✓ Plugin $PLUGIN_NAME@$ver published"
}

publish_trust() {
  local ver sha changelog="$CHANGELOG"

  do_bump_trust
  ver="$(get_json_version "$REPO_ROOT/$TRUST_DIR/package.json")"
  sha="$(git_sha)"

  if [[ "$SKIP_TESTS" == "true" ]]; then
    yellow "  ⚠ UNSAFE: --skip-tests set (maintainer-only); skipping trust plugin verification"
    yellow "  [order] build cores → bundle into consumers → publish plugins (cores not on npm/ClawHub)"
    require_exact_core_dependency "$REPO_ROOT/$TRUST_DIR/package.json" "trust plugin"
    require_bundled_cores "$TRUST_DIR" "trust plugin" \
      "@ovrsr/fpp-protocol-core" "@ovrsr/fpp-trust-core"
  else
    run_strict_checks_trust
  fi

  bold "Publishing trust plugin v${ver}..."
  if [[ "$DRY_RUN" == "true" ]]; then
    yellow "  [dry-run] clawhub package publish $TRUST_DIR/ --family code-plugin --name $TRUST_NAME --version $ver --source-repo $SOURCE_REPO --source-commit $sha --changelog \"$changelog\" --owner $OWNER"
    green "  ✓ [dry-run] bundle verification already succeeded for trust plugin"
    return
  fi

  clawhub_package_publish "$TRUST_DIR" "$TRUST_NAME" "$ver" "$sha" "$changelog"
  green "  ✓ Plugin $TRUST_NAME@$ver published"
}

# ── Status ───────────────────────────────────────────────────────────

show_status() {
  local skill_pkg skill_md plugin_ver trust_ver core_ver
  skill_pkg="$(get_json_version "$REPO_ROOT/package.json")"
  skill_md="$(get_skill_version)"
  plugin_ver="$(get_json_version "$REPO_ROOT/$PLUGIN_DIR/package.json")"
  trust_ver="$(get_json_version "$REPO_ROOT/$TRUST_DIR/package.json")"
  core_ver="$(get_json_version "$REPO_ROOT/$CORE_DIR/package.json")"

  bold "Current versions:"
  echo "  Protocol core:         $core_ver  (build/check before plugin consumers)"
  echo "  Skill (package.json):  $skill_pkg"
  echo "  Skill (SKILL.md):      $skill_md"
  if [[ "$skill_pkg" != "$skill_md" ]]; then
    red "  ⚠ MISMATCH: package.json and SKILL.md versions differ!"
  fi
  echo "  Enforcement plugin:    $plugin_ver"
  echo "  Trust plugin:          $trust_ver"
  echo ""
  echo "  Git HEAD: $(git_sha 2>/dev/null || echo 'not a git repo')"
}

# ── Main ─────────────────────────────────────────────────────────────

COMMAND=""
TARGET=""
BUMP_LEVEL="patch"
EXPLICIT_VERSION=""
CHANGELOG=""
DRY_RUN="false"
SKIP_TESTS="false"

[[ $# -eq 0 ]] && usage

while [[ $# -gt 0 ]]; do
  case "$1" in
    publish|bump|status) COMMAND="$1"; shift ;;
    skill|plugin|trust|all) TARGET="$1"; shift ;;
    --bump)       BUMP_LEVEL="$2"; shift 2 ;;
    --version)    EXPLICIT_VERSION="$2"; shift 2 ;;
    --changelog)  CHANGELOG="$2"; shift 2 ;;
    --dry-run)    DRY_RUN="true"; shift ;;
    --skip-tests)
      if [[ "${FPP_ALLOW_SKIP_TESTS:-}" != "1" ]]; then
        die "--skip-tests requires FPP_ALLOW_SKIP_TESTS=1 (UNSAFE / maintainer-only dual gate)"
      fi
      SKIP_TESTS="true"
      yellow "WARNING: --skip-tests is UNSAFE and maintainer-only (FPP_ALLOW_SKIP_TESTS=1 set)"
      shift
      ;;
    --help|-h)    usage ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -z "$COMMAND" ]] && die "No command specified. Use: publish | bump | status"

case "$COMMAND" in
  status)
    show_status
    ;;

  bump)
    [[ -z "$TARGET" ]] && die "No target specified. Use: skill | plugin | trust | all"
    case "$TARGET" in
      skill)  do_bump_skill ;;
      plugin) do_bump_plugin ;;
      trust)  do_bump_trust ;;
      all)    do_bump_skill; do_bump_plugin; do_bump_trust ;;
    esac
    ;;

  publish)
    [[ -z "$TARGET" ]] && die "No target specified. Use: skill | plugin | trust | all"
    [[ -z "$CHANGELOG" ]] && die "--changelog is required for publish"
    require_clawhub
    require_clean_tree
    case "$TARGET" in
      skill)  publish_skill ;;
      plugin) publish_plugin ;;
      trust)  publish_trust ;;
      all)
        bold "Release order: protocol-core checks, then skill, enforcement plugin, trust plugin"
        yellow "  [order] protocol-core ($CORE_NAME) before consumers"
        if [[ "$SKIP_TESTS" != "true" ]]; then
          run_strict_checks_core
        fi
        publish_skill
        publish_plugin
        publish_trust
        ;;
    esac
    ;;

  *) die "Unknown command: $COMMAND" ;;
esac
