#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_SKILL_DIR="$HOME/.openclaw/skills/freedom-preserving-protocol"
DEFAULT_PLUGIN_DIR="$HOME/.openclaw/extensions/openclaw-fpp-plugin"
DEFAULT_TRUST_DIR="$HOME/.openclaw/extensions/openclaw-fpp-trust"

SKILL_DIR="$DEFAULT_SKILL_DIR"
PLUGIN_DIR="$DEFAULT_PLUGIN_DIR"
TRUST_DIR="$DEFAULT_TRUST_DIR"
CURSOR_DIR=""
CLAUDE_DIR=""
CODEX_DIR=""

WANT_SKILL=0
WANT_PLUGIN=0
WANT_TRUST=0
WANT_CURSOR=0
WANT_CLAUDE=0
WANT_CODEX=0
EXPLICIT_TARGETS=0

DRY_RUN=0
KEEP_STAGE=0
BACKUP_BASE="${HOME}/.fpp/update-backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT=""
STAGE_ROOT=""

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
red() { printf '\033[1;31m%s\033[0m\n' "$*"; }

die() {
  red "ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Update installed FPP assets in place from a local clone of the monorepo.

This script stages canonical install artifacts first:
  - skill     -> stage-skill.ts output
  - plugins   -> npm pack output after build + bundledDependencies staging
  - adapters  -> npm pack output after build + bundledDependencies staging

It then syncs those staged artifacts into existing install directories using an
ownership manifest: only previously updater-owned files may be removed, and a
timestamped backup of every target directory is taken before overwrite.

Usage:
  bash scripts/update-installed-assets.sh [options]

Default behavior:
  If you do not pass any target flags, the script updates the three standard
  OpenClaw install roots:
    ~/.openclaw/skills/freedom-preserving-protocol
    ~/.openclaw/extensions/openclaw-fpp-plugin
    ~/.openclaw/extensions/openclaw-fpp-trust

Target options:
  --openclaw-defaults     Update skill + enforcement plugin + trust plugin
  --skill-dir <dir>       Update the prompt-layer skill at <dir>
  --plugin-dir <dir>      Update the enforcement plugin at <dir>
  --trust-dir <dir>       Update the trust plugin at <dir>
  --cursor-dir <dir>      Update the Cursor adapter package at <dir>
  --claude-dir <dir>      Update the Claude Code adapter package at <dir>
  --codex-dir <dir>       Update the Codex adapter package at <dir>

Behavior options:
  --backup-root <dir>     Parent directory for timestamped backups
  --dry-run               Stage everything, show planned copy/removals, do not overwrite
  --keep-stage            Keep the temporary staging directory after completion
  -h, --help              Show this help

Examples:
  bash scripts/update-installed-assets.sh --dry-run
  bash scripts/update-installed-assets.sh --skill-dir "$HOME/.openclaw/skills/freedom-preserving-protocol"
  bash scripts/update-installed-assets.sh \
    --plugin-dir "$HOME/.openclaw/extensions/openclaw-fpp-plugin" \
    --trust-dir "$HOME/.openclaw/extensions/openclaw-fpp-trust"
  bash scripts/update-installed-assets.sh \
    --codex-dir "$HOME/lib/fpp/adapters/codex"

Safety notes:
  - First update of a legacy target is additive (no prior ownership manifest).
  - Later updates remove only stale files listed in .fpp-updater-manifest.json.
  - Files not listed in the ownership manifest are never deleted.
  - This does not edit SOUL.md, MEMORY.md, FPP workspace logs, or OpenClaw config.
  - This does not republish to ClawHub.
  - This does not rewrite Codex/Cursor/Claude hook config files; it updates only
    the adapter package directory you point it at.
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

OWNED_MANIFEST_NAME=".fpp-updater-manifest.json"

# Non-destructive tree copy used for backups (never deletes destination files).
copy_trees() {
  local src="$1"
  local dest="$2"

  mkdir -p "$dest"
  if [[ "$SYNC_TOOL" == "rsync" ]]; then
    rsync -a "$src/" "$dest/"
  else
    cp -a "$src/." "$dest/"
  fi
}

list_relative_files() {
  local dir="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    const skip = process.argv[2];
    function walk(d, base) {
      for (const name of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, name.name);
        const rel = path.relative(base, full).split(path.sep).join("/");
        if (name.isDirectory()) {
          walk(full, base);
        } else if (rel !== skip) {
          process.stdout.write(rel + "\n");
        }
      }
    }
    walk(root, root);
  ' "$dir" "$OWNED_MANIFEST_NAME"
}

read_prior_owned_list() {
  local dest="$1"
  local manifest="$dest/$OWNED_MANIFEST_NAME"
  [[ -f "$manifest" ]] || return 0
  node -e '
    const fs = require("fs");
    const path = require("path");
    const manifestPath = process.argv[1];
    let data;
    try {
      data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (err) {
      console.error("ERROR: invalid ownership manifest (not JSON): " + manifestPath);
      process.exit(2);
    }
    if (!data || data.version !== 1 || !Array.isArray(data.files)) {
      console.error("ERROR: invalid ownership manifest shape: " + manifestPath);
      process.exit(2);
    }
    for (const rel of data.files) {
      if (typeof rel !== "string" || !rel) {
        console.error("ERROR: unsafe ownership manifest path: " + String(rel));
        process.exit(2);
      }
      if (path.isAbsolute(rel) || /^[A-Za-z]:[\\\\/]/.test(rel)) {
        console.error("ERROR: unsafe ownership manifest path (absolute/escape): " + rel);
        process.exit(2);
      }
      const parts = rel.split(/[/\\\\]/);
      if (parts.some((p) => p === ".." || p === "")) {
        console.error("ERROR: unsafe ownership manifest path (escape): " + rel);
        process.exit(2);
      }
      process.stdout.write(parts.join("/") + "\n");
    }
  ' "$manifest"
}

remove_owned_rel() {
  local dest="$1"
  local rel="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dest = process.argv[1];
    const rel = process.argv[2];
    const parts = rel.split(/[/\\\\]/);
    if (!rel || parts.some((p) => p === ".." || p === "")) {
      console.error("ERROR: unsafe ownership path: " + rel);
      process.exit(2);
    }
    if (path.isAbsolute(rel) || /^[A-Za-z]:[\\\\/]/.test(rel)) {
      console.error("ERROR: unsafe ownership path: " + rel);
      process.exit(2);
    }
    const full = path.join(dest, ...parts);
    const resolved = path.resolve(full);
    const root = path.resolve(dest);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(prefix)) {
      console.error("ERROR: ownership path escapes target: " + rel);
      process.exit(2);
    }
    if (fs.existsSync(full)) {
      fs.rmSync(full, { force: true });
    }
  ' "$dest" "$rel"
}

write_owned_manifest() {
  local dest="$1"
  local list_file="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dest = process.argv[1];
    const listFile = process.argv[2];
    const name = process.argv[3];
    const files = fs.readFileSync(listFile, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, name),
      JSON.stringify({ version: 1, files }, null, 2) + "\n",
    );
  ' "$dest" "$list_file" "$OWNED_MANIFEST_NAME"
}

# Ownership-aware sync: copy staged files; remove only previously owned stale paths.
sync_owned() {
  local src="$1"
  local dest="$2"
  local mode="${3:-apply}"
  local staged_list prior_list stale_list
  local rel

  staged_list="$(mktemp "${TMPDIR:-/tmp}/fpp-owned-staged.XXXXXX")"
  prior_list="$(mktemp "${TMPDIR:-/tmp}/fpp-owned-prior.XXXXXX")"
  stale_list="$(mktemp "${TMPDIR:-/tmp}/fpp-owned-stale.XXXXXX")"

  list_relative_files "$src" | sort -u >"$staged_list"
  read_prior_owned_list "$dest" | sort -u >"$prior_list" || {
    rm -f "$staged_list" "$prior_list" "$stale_list"
    die "rejected unsafe or invalid ownership manifest under $dest"
  }

  # Stale = previously owned but absent from the new staged inventory.
  comm -23 "$prior_list" "$staged_list" >"$stale_list"

  if [[ "$mode" == "dry-run" ]]; then
    yellow "  dry-run: would copy staged files into $dest"
    if [[ "$SYNC_TOOL" == "rsync" ]]; then
      rsync -a --dry-run "$src/" "$dest/" || true
    else
      while IFS= read -r rel; do
        [[ -n "$rel" ]] || continue
        yellow "  dry-run: would copy $rel"
      done <"$staged_list"
    fi
    if [[ -s "$stale_list" ]]; then
      yellow "  dry-run: planned owned-file removals:"
      while IFS= read -r rel; do
        [[ -n "$rel" ]] || continue
        yellow "    would remove owned file: $rel"
      done <"$stale_list"
    else
      yellow "  dry-run: no planned owned-file removals"
    fi
    rm -f "$staged_list" "$prior_list" "$stale_list"
    return 0
  fi

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    yellow "  removing stale owned file: $rel"
    remove_owned_rel "$dest" "$rel"
  done <"$stale_list"

  mkdir -p "$dest"
  if [[ "$SYNC_TOOL" == "rsync" ]]; then
    rsync -a "$src/" "$dest/"
  else
    cp -a "$src/." "$dest/"
  fi

  write_owned_manifest "$dest" "$staged_list"
  rm -f "$staged_list" "$prior_list" "$stale_list"
}

cleanup() {
  if [[ -n "${STAGE_ROOT:-}" && -d "${STAGE_ROOT:-}" && "$KEEP_STAGE" -ne 1 ]]; then
    rm -rf "$STAGE_ROOT"
  fi
}
trap cleanup EXIT

mark_explicit() {
  EXPLICIT_TARGETS=1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --openclaw-defaults)
      mark_explicit
      WANT_SKILL=1
      WANT_PLUGIN=1
      WANT_TRUST=1
      shift
      ;;
    --skill-dir)
      mark_explicit
      WANT_SKILL=1
      SKILL_DIR="${2:?missing value for --skill-dir}"
      shift 2
      ;;
    --plugin-dir)
      mark_explicit
      WANT_PLUGIN=1
      PLUGIN_DIR="${2:?missing value for --plugin-dir}"
      shift 2
      ;;
    --trust-dir)
      mark_explicit
      WANT_TRUST=1
      TRUST_DIR="${2:?missing value for --trust-dir}"
      shift 2
      ;;
    --cursor-dir)
      mark_explicit
      WANT_CURSOR=1
      CURSOR_DIR="${2:?missing value for --cursor-dir}"
      shift 2
      ;;
    --claude-dir)
      mark_explicit
      WANT_CLAUDE=1
      CLAUDE_DIR="${2:?missing value for --claude-dir}"
      shift 2
      ;;
    --codex-dir)
      mark_explicit
      WANT_CODEX=1
      CODEX_DIR="${2:?missing value for --codex-dir}"
      shift 2
      ;;
    --backup-root)
      BACKUP_BASE="${2:?missing value for --backup-root}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --keep-stage)
      KEEP_STAGE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

if [[ "$EXPLICIT_TARGETS" -ne 1 ]]; then
  WANT_SKILL=1
  WANT_PLUGIN=1
  WANT_TRUST=1
fi

require_cmd node
require_cmd npm
require_cmd tar
require_cmd mktemp

if [[ "${FPP_UPDATE_FORCE_CP:-}" == "1" ]]; then
  SYNC_TOOL="cp"
elif command -v rsync >/dev/null 2>&1; then
  SYNC_TOOL="rsync"
else
  SYNC_TOOL="cp"
fi

# Test seam: when FPP_UPDATE_TEST_STAGE points at a pre-populated stage root
# (skill/, plugin/, …), skip dependency install, builds, and packaging.
UPDATE_TEST_MODE=0
if [[ -n "${FPP_UPDATE_TEST_STAGE:-}" ]]; then
  [[ -d "$FPP_UPDATE_TEST_STAGE" ]] || die "FPP_UPDATE_TEST_STAGE is not a directory: $FPP_UPDATE_TEST_STAGE"
  UPDATE_TEST_MODE=1
  STAGE_ROOT="$FPP_UPDATE_TEST_STAGE"
  KEEP_STAGE=1
fi

pkg_version() {
  node -p "const p=require(process.argv[1]); p.version || ''" "$1" | tr -d '\r\n'
}

ensure_root_deps() {
  if [[ ! -x "$REPO_ROOT/node_modules/.bin/tsx" ]]; then
    bold "Installing root repo dependencies..."
    (cd "$REPO_ROOT" && npm install)
  fi
}

stage_skill() {
  local out="$1"
  bold "Staging skill -> $out"
  (cd "$REPO_ROOT" && npx tsx scripts/stage-skill.ts --out "$out" --install-deps)
}

pack_asset() {
  local rel="$1"
  local out="$2"
  local abs="$REPO_ROOT/$rel"
  local pack_tmp tgz

  [[ -f "$abs/package.json" ]] || die "package.json missing for asset: $rel"

  bold "Packing $rel -> $out"
  (cd "$abs" && npm run build --if-present >/dev/null)
  (cd "$abs" && npm run bundle:deps --if-present >/dev/null)

  pack_tmp="$(mktemp -d "${TMPDIR:-/tmp}/fpp-pack.XXXXXX")"
  (cd "$abs" && npm pack --pack-destination "$pack_tmp" >/dev/null)
  tgz="$(find "$pack_tmp" -maxdepth 1 -type f -name '*.tgz' | head -1)"
  [[ -n "$tgz" && -f "$tgz" ]] || die "npm pack produced no tarball for $rel"

  mkdir -p "$out"
  tar -xzf "$tgz" -C "$out" --strip-components=1 package
  rm -rf "$pack_tmp"
}

backup_dir() {
  local label="$1"
  local src="$2"
  local dest="$BACKUP_ROOT/$label"

  [[ -d "$src" ]] || return 0

  mkdir -p "$(dirname "$dest")"
  bold "Backing up $src -> $dest"
  copy_trees "$src" "$dest"
}

sync_dir() {
  local label="$1"
  local src="$2"
  local dest="$3"

  [[ -d "$src" ]] || die "staged source missing for $label: $src"

  if [[ "$DRY_RUN" -ne 1 ]]; then
    backup_dir "$label" "$dest"
    mkdir -p "$dest"
  fi

  bold "Syncing $label"
  yellow "  source: $src"
  yellow "  target: $dest"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    sync_owned "$src" "$dest" dry-run
  else
    sync_owned "$src" "$dest" apply
  fi
}

summarize_target() {
  local label="$1"
  local path="$2"
  local pkg="$3"
  printf '%-16s %s (v%s)\n' "$label" "$path" "$(pkg_version "$pkg")"
}

BACKUP_ROOT="$BACKUP_BASE/$STAMP"

if [[ "$UPDATE_TEST_MODE" -ne 1 ]]; then
  ensure_root_deps

  if [[ "$WANT_PLUGIN" -eq 1 || "$WANT_TRUST" -eq 1 || "$WANT_CURSOR" -eq 1 || "$WANT_CLAUDE" -eq 1 || "$WANT_CODEX" -eq 1 ]]; then
    bold "Building shared workspace packages..."
    (cd "$REPO_ROOT" && npm run build:core >/dev/null)
  fi

  STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fpp-update.XXXXXX")"
fi

bold "Repo root:   $REPO_ROOT"
bold "Stage root:  $STAGE_ROOT"
if [[ "$DRY_RUN" -eq 1 ]]; then
  bold "Mode:        dry-run"
else
  bold "Backups:     $BACKUP_ROOT"
fi
printf '\n'

if [[ "$UPDATE_TEST_MODE" -ne 1 ]]; then
  if [[ "$WANT_SKILL" -eq 1 ]]; then
    stage_skill "$STAGE_ROOT/skill"
  fi
  if [[ "$WANT_PLUGIN" -eq 1 ]]; then
    pack_asset "plugin" "$STAGE_ROOT/plugin"
  fi
  if [[ "$WANT_TRUST" -eq 1 ]]; then
    pack_asset "plugin-trust" "$STAGE_ROOT/plugin-trust"
  fi
  if [[ "$WANT_CURSOR" -eq 1 ]]; then
    pack_asset "adapters/cursor" "$STAGE_ROOT/cursor"
  fi
  if [[ "$WANT_CLAUDE" -eq 1 ]]; then
    pack_asset "adapters/claude-code" "$STAGE_ROOT/claude-code"
  fi
  if [[ "$WANT_CODEX" -eq 1 ]]; then
    pack_asset "adapters/codex" "$STAGE_ROOT/codex"
  fi
fi

printf '\n'
bold "Targets"
if [[ "$WANT_SKILL" -eq 1 ]]; then
  summarize_target "skill" "$SKILL_DIR" "$REPO_ROOT/package.json"
fi
if [[ "$WANT_PLUGIN" -eq 1 ]]; then
  summarize_target "plugin" "$PLUGIN_DIR" "$REPO_ROOT/plugin/package.json"
fi
if [[ "$WANT_TRUST" -eq 1 ]]; then
  summarize_target "trust" "$TRUST_DIR" "$REPO_ROOT/plugin-trust/package.json"
fi
if [[ "$WANT_CURSOR" -eq 1 ]]; then
  summarize_target "cursor-adapter" "$CURSOR_DIR" "$REPO_ROOT/adapters/cursor/package.json"
fi
if [[ "$WANT_CLAUDE" -eq 1 ]]; then
  summarize_target "claude-adapter" "$CLAUDE_DIR" "$REPO_ROOT/adapters/claude-code/package.json"
fi
if [[ "$WANT_CODEX" -eq 1 ]]; then
  summarize_target "codex-adapter" "$CODEX_DIR" "$REPO_ROOT/adapters/codex/package.json"
fi
printf '\n'

if [[ "$WANT_SKILL" -eq 1 ]]; then
  sync_dir "skill" "$STAGE_ROOT/skill" "$SKILL_DIR"
fi
if [[ "$WANT_PLUGIN" -eq 1 ]]; then
  sync_dir "plugin" "$STAGE_ROOT/plugin" "$PLUGIN_DIR"
fi
if [[ "$WANT_TRUST" -eq 1 ]]; then
  sync_dir "plugin-trust" "$STAGE_ROOT/plugin-trust" "$TRUST_DIR"
fi
if [[ "$WANT_CURSOR" -eq 1 ]]; then
  sync_dir "adapter-cursor" "$STAGE_ROOT/cursor" "$CURSOR_DIR"
fi
if [[ "$WANT_CLAUDE" -eq 1 ]]; then
  sync_dir "adapter-claude-code" "$STAGE_ROOT/claude-code" "$CLAUDE_DIR"
fi
if [[ "$WANT_CODEX" -eq 1 ]]; then
  sync_dir "adapter-codex" "$STAGE_ROOT/codex" "$CODEX_DIR"
fi

printf '\n'
green "FPP asset update complete."
if [[ "$DRY_RUN" -eq 1 ]]; then
  yellow "Dry-run only: no target directories were modified."
else
  yellow "Backups written under: $BACKUP_ROOT"
fi
if [[ "$KEEP_STAGE" -eq 1 ]]; then
  yellow "Stage directory kept at: $STAGE_ROOT"
fi
