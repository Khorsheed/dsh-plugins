#!/bin/sh
# dsh-web-eval installer: drop the profile template into $DSH_HOME and install it.
#
# Two install paths:
#   npm mode (no arguments) — every member resolves from the npm registry.
#     Works as-is once every member is published; until then the unpublished
#     members fail with registry 404.
#   source mode (--source <dsh-plugins checkout>) — build the members that are
#     not on npm yet inside the given checkout, pack them as tarballs into the
#     installed profile, and pin every unpublished name (including the
#     transitive headless bundle) with pnpm overrides, so the ^-range family
#     edges inside the tarballs never reach the registry. Published members
#     still resolve from the registry.
#
# Re-running over an installed profile needs --fresh. An installed profile
# carries node_modules, a pnpm-lock.yaml and the packed tarballs; a plain
# re-run would resolve against those, so freshly built source tarballs never
# reach the profile and the instance quietly keeps running the OLD build.
# --fresh removes all three first, so `--source --fresh` always installs what
# the checkout currently holds.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-eval"

# The profile's own files, listed explicitly. The repo root also holds the
# distribution wrapper (README, scripts, docs, CHANGELOG, LICENSE), so copying
# the directory would leak every future addition into the user's $DSH_HOME
# without a sound. A whitelist fails the other way: a new template file simply
# does not arrive, and the loader-row count printed below drops. Add new
# template files HERE.
PROFILE_FILES="package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml"

# The pack's agent presets, by preset id; each is a directory under presets/
# holding `agent.cordis.yml` (+ optional `preset.yml`). They do NOT live under
# the profile directory: `dsh-agent-presets` scans `$DSH_HOME/.agent-presets`,
# and the roster is per-HOME, not per-profile. Each listed id is replaced whole
# on install and on update, for the same reason cordis.patch.yml is (see
# update.sh): the eval preset is frozen decision 12's execution point —
# apparatus, not preference. A locally authored preset of the same id is
# overwritten; author your own under a different id.
#
# Because they sit outside $DSH_HOME/profiles/web-eval, uninstalling the
# profile does NOT remove them — the README says so beside the `rm -rf`.
PRESET_IDS="eval"

# Members source mode packs from the checkout — "no usable release on npm".
# Two reasons a member lands here, and docs/release-status.md is the authority
# for both:
#
#   1. never published (the evaluation family: eval, lab, datasets, mission,
#      the local-agent family, capability-catalog, …);
#   2. published, but only against an OLDER host line. npm's newest is the
#      0.2.0 wave (host 0.1.2-rc.1); this profile now boots on 0.1.5-rc.1, and
#      a plugin built against the older line fails at import with a missing
#      export (measured: `@deepseek-ai/dsh-settings` has no `settingsNamespace`
#      on 0.1.5, and context-guard / ui-shortcuts 0.2.0 import it). Their
#      0.1.5-aligned releases are cut in the repo but not on npm yet (the
#      publish freeze), so until that wave lands they are packed from source
#      like group 1. Remove a member from this list the moment its
#      host-aligned version is ON npm.
#
# Dependency order: the family core first, then tool-subagent, the headless
# bundle (local-agent-dsh's own dependency — packed so the override can pin
# it, never a direct profile dependency), then the providers, then the
# independents, then the published-but-lagging members.
UNPUBLISHED_DIRS="local-agent local-agent-tool-subagent local-agent-dsh-headless \
local-agent-kimi local-agent-codex local-agent-claude-code local-agent-dsh \
capability-catalog datasets eval inline-html-render lab local-files mission \
ankh-guard context-guard file-preview message-timeline message-tools taskpilot \
ui-file-preview ui-shortcuts session-title-edit whalesong"

SOURCE=""
FRESH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      [ $# -ge 2 ] || { echo "dsh-web-eval: --source needs a dsh-plugins checkout path" >&2; exit 2; }
      SOURCE="$2"; shift 2 ;;
    --source=*) SOURCE="${1#--source=}"; shift ;;
    --fresh) FRESH=1; shift ;;
    *) echo "dsh-web-eval: unknown argument $1 (usage: install.sh [--source <dsh-plugins checkout>] [--fresh])" >&2; exit 2 ;;
  esac
done

if [ -n "$SOURCE" ]; then
  SOURCE_ABS="$(cd "$SOURCE" 2>/dev/null && pwd)" || { echo "dsh-web-eval: no dsh-plugins checkout at $SOURCE" >&2; exit 2; }
  SOURCE="$SOURCE_ABS"
  for d in $UNPUBLISHED_DIRS; do
    if [ ! -f "$SOURCE/packages/$d/package.json" ]; then
      echo "dsh-web-eval: $SOURCE is missing packages/$d — pass the dsh-plugins repo root" >&2
      exit 2
    fi
  done
fi

# ── Machine-level preflight, BEFORE anything is written. ────────────────
# The first `dsh` call used to be two hundred lines down, after the profile
# files were copied, the agent presets replaced whole, and every member built
# and packed. On a machine without `dsh` on PATH that meant minutes of work
# and a REPLACED preset directory before the failure — and the trap only ever
# told you to remove $DEST. Everything this checks is a precondition of the
# machine, not of the install, so it is checked while nothing has changed yet.
preflight_fail() {
  echo "dsh-web-eval: preflight failed — nothing has been written." >&2
  echo "$1" >&2
  exit 2
}

command -v dsh >/dev/null 2>&1 || preflight_fail "  missing: \`dsh\` on PATH.
  The instance itself needs it (the eval profile pins cliLaunch: [dsh], so the
  dsh harness delegates by that name), and this script installs through it.
  Put the dsh CLI on PATH and re-run."

dsh --version >/dev/null 2>&1 || preflight_fail "  \`dsh\` is on PATH but \`dsh --version\` failed.
  Run it by hand and fix what it reports before installing."

# The host LINE, checked against what the members declare they need. A host
# older than a member's `dsh.compat.minHost` does not fail at install — it
# fails at boot, as a missing export inside a plugin import, which reads like
# a plugin bug and is not one (measured on this profile twice). Source mode
# knows exactly which members it is about to pack, so it can say so first.
if [ -n "$SOURCE" ]; then
  HOST_VERSION=$(dsh --version 2>/dev/null | tr -d '[:space:]')
  MINHOST_FAIL=$(SOURCE_CHECKOUT="$SOURCE" UNPUBLISHED_DIRS="$UNPUBLISHED_DIRS" HOST_VERSION="$HOST_VERSION" node <<'NODE'
const fs = require('node:fs')
/** Compare two dotted versions with an optional -rc.N / -alpha.N tail. */
const parse = (v) => {
  const [core, tail] = String(v).split('-')
  const nums = core.split('.').map(Number)
  // A release outranks its own prereleases; among prereleases, rc > alpha,
  // then by number. Anything unparseable sorts as "unknown", never as newer.
  const kinds = { alpha: 1, beta: 2, rc: 3 }
  const [kind, seq] = tail === undefined ? ['release', 0] : tail.split('.')
  return { nums, rank: tail === undefined ? 9 : (kinds[kind] ?? 0), seq: Number(seq ?? 0) }
}
const cmp = (a, b) => {
  const x = parse(a), y = parse(b)
  if (x.nums.some(Number.isNaN) || y.nums.some(Number.isNaN)) return null
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i += 1) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (x.rank !== y.rank) return x.rank < y.rank ? -1 : 1
  return x.seq === y.seq ? 0 : x.seq < y.seq ? -1 : 1
}
const host = process.env.HOST_VERSION
const behind = []
for (const dir of process.env.UNPUBLISHED_DIRS.split(/\s+/).filter(Boolean)) {
  const path = `${process.env.SOURCE_CHECKOUT}/packages/${dir}/package.json`
  if (!fs.existsSync(path)) continue
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'))
  const min = pkg.dsh?.compat?.minHost
  if (min === undefined) continue
  if (cmp(host, min) === -1) behind.push(`${pkg.name} needs >= ${min}`)
}
if (behind.length > 0) process.stdout.write(behind.join('\n'))
NODE
)
  if [ -n "$MINHOST_FAIL" ]; then
    preflight_fail "  the \`dsh\` on PATH is $HOST_VERSION, older than what these members declare:
$(printf '%s\n' "$MINHOST_FAIL" | sed 's/^/    /')
  Point PATH at a matching toolchain (e.g. ~/.dsh-toolchains/rc-<version>/node_modules/.bin)
  and re-run. A host below a member's minHost does not fail here — it fails at
  boot, inside a plugin import, as a missing export that reads like a plugin bug."
  fi
fi

# The headless bundle path the profile PINS. It is a machine-level
# precondition (the dataset repo's env/README documents how to stage it):
# the same path has to resolve on the host and inside an evaluation unit, or
# the dsh harness's rounds fail with a loader error nothing else explains.
HEADLESS_PIN=$(sed -n 's/^[[:space:]]*headlessBundleDir:[[:space:]]*//p' "$SRC/cordis.patch.yml" | head -1)
if [ -n "$HEADLESS_PIN" ] && [ ! -e "$HEADLESS_PIN" ]; then
  preflight_fail "  missing: $HEADLESS_PIN
  cordis.patch.yml pins this as the dsh harness's headless bundle, and the same
  path must exist on this host AND inside the evaluation image. Stage it (two
  symlinks on the host: the bundle and its runtime dependency closure) as the
  dataset repository's env/README describes, then re-run."
fi

if [ -d "$DEST" ]; then
  if [ -z "$FRESH" ]; then
    echo "dsh-web-eval: $DEST already exists — re-run with --fresh to reinstall over it." >&2
    if [ -d "$DEST/node_modules" ]; then
      echo "  It carries an installed node_modules: a re-run would resolve against it and the" >&2
      echo "  existing pnpm-lock.yaml, so newly packed source tarballs would NOT reach the" >&2
      echo "  profile — the instance would keep running the old build with no sign of it." >&2
      echo "  --fresh removes node_modules, pnpm-lock.yaml and tarballs/ before installing." >&2
    fi
    exit 1
  fi
  echo "dsh-web-eval: --fresh — removing node_modules, pnpm-lock.yaml and tarballs/ under $DEST"
  rm -rf "$DEST/node_modules" "$DEST/pnpm-lock.yaml" "$DEST/tarballs"
fi

mkdir -p "$DEST"
# The presets are replaced WHOLE (they are apparatus, not preference), so the
# previous copy is kept beside them until the install succeeds: a failure
# halfway through must not be the moment a person discovers their preset
# directory is gone.
PRESET_BACKUP="$DSH_HOME/.agent-presets/.web-eval-backup.$$"
trap 'echo "dsh-web-eval: install failed — $DEST is half-installed; remove it before re-running" >&2
  if [ -d "$PRESET_BACKUP" ]; then
    echo "  the agent preset(s) were replaced; the previous copy is at $PRESET_BACKUP" >&2
    echo "  restore with: rm -rf $DSH_HOME/.agent-presets/<id> && mv $PRESET_BACKUP/<id> $DSH_HOME/.agent-presets/" >&2
  fi' 0
for f in $PROFILE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
done

PRESET_ROOT="$DSH_HOME/.agent-presets"
for id in $PRESET_IDS; do
  [ -d "$SRC/presets/$id" ] || { echo "dsh-web-eval: presets/$id missing from the clone" >&2; exit 1; }
  mkdir -p "$PRESET_ROOT"
  if [ -d "$PRESET_ROOT/$id" ]; then
    mkdir -p "$PRESET_BACKUP"
    cp -R "$PRESET_ROOT/$id" "$PRESET_BACKUP/$id"
  fi
  rm -rf "$PRESET_ROOT/$id"
  cp -R "$SRC/presets/$id" "$PRESET_ROOT/$id"
  echo "dsh-web-eval: installed agent preset \"$id\" into $PRESET_ROOT/$id"
done

if [ -n "$SOURCE" ]; then
  TARBALLS="$DEST/tarballs"
  mkdir -p "$TARBALLS"

  # Build each unpublished member in the checkout, scoped like deploy-3080
  # (GEN_TYPERT_ONLY) so a neighbor's WIP cannot block the install, then pack
  # it with its @khorsheed family so cross-family edges land as ^ranges — the
  # overrides written below pin those names to these tarballs.
  NAMES=""
  for d in $UNPUBLISHED_DIRS; do
    NAMES="$NAMES $(node -p "require('$SOURCE/packages/$d/package.json').name")"
  done
  GEN_TYPERT_ONLY="$(printf '%s' "$NAMES" | sed 's/^ //' | tr -s ' ' ',')"
  export GEN_TYPERT_ONLY
  (
    cd "$SOURCE"
    for d in $UNPUBLISHED_DIRS; do
      name=$(node -p "require('$SOURCE/packages/$d/package.json').name")
      echo "dsh-web-eval: building $name"
      pnpm --filter "$name" build
    done
    for d in $UNPUBLISHED_DIRS; do
      name=$(node -p "require('$SOURCE/packages/$d/package.json').name")
      version=$(node -p "require('$SOURCE/packages/$d/package.json').version")
      family=$(node -p "const p=require('$SOURCE/packages/$d/package.json'); [...new Set([...Object.keys(p.dependencies??{}),...Object.keys(p.peerDependencies??{})])].filter(n=>n.startsWith('@khorsheed/')).join(',')")
      echo "dsh-web-eval: packing $name@$version"
      if [ -n "$family" ]; then
        npx tsx scripts/pack-dist.ts --package "packages/$d" --scope @khorsheed --version "$version" --out "$TARBALLS" --family "$family"
      else
        npx tsx scripts/pack-dist.ts --package "packages/$d" --scope @khorsheed --version "$version" --out "$TARBALLS"
      fi
    done
  )

  # Rewrite the installed copies (the template itself stays npm-range): direct
  # dependencies to their tarballs, and every unpublished name as an override
  # so the tarballs' family edges resolve locally instead of 404-ing. Relative
  # file: specs resolve against the profile directory — pnpm always runs there
  # (dsh plugin forwards with cwd = profile dir), and the profile stays
  # relocatable.
  SOURCE_CHECKOUT="$SOURCE" PROFILE_DEST="$DEST" UNPUBLISHED_DIRS="$UNPUBLISHED_DIRS" node <<'NODE'
    const fs = require('node:fs')
    const src = process.env.SOURCE_CHECKOUT
    const dest = process.env.PROFILE_DEST
    const manifestPath = `${dest}/package.json`
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const overrides = []
    for (const dir of process.env.UNPUBLISHED_DIRS.split(' ')) {
      const pkg = JSON.parse(fs.readFileSync(`${src}/packages/${dir}/package.json`, 'utf8'))
      const spec = `file:tarballs/khorsheed-${pkg.name.replace('@khorsheed/', '')}-${pkg.version}.tgz`
      if (manifest.dependencies?.[pkg.name] !== undefined) manifest.dependencies[pkg.name] = spec
      overrides.push(`  '${pkg.name}': '${spec}'`)
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    const wsPath = `${dest}/pnpm-workspace.yaml`
    const ws = fs.readFileSync(wsPath, 'utf8')
    if (/^overrides:/m.test(ws)) {
      process.stderr.write('dsh-web-eval: the template pnpm-workspace.yaml now carries overrides — merge the source-mode block by hand\n')
      process.exit(1)
    }
    fs.writeFileSync(wsPath, ws.trimEnd() + '\n\noverrides:\n' + overrides.join('\n') + '\n')
NODE
fi

dsh plugin --profile web-eval install
DUMP=$(dsh --profile web-eval --dump-config 2>/dev/null || true)
# Distinct @khorsheed names, not raw matches: the composed dump repeats each
# member (layer header + entry row) and tool-subagent appears only through its
# per-provider entries — distinct names is the member invariant (23).
MEMBERS=$(printf '%s\n' "$DUMP" | grep -o '@khorsheed/[a-z0-9-]*' | sort -u | wc -l | tr -d ' ')
ROWS=$(printf '%s\n' "$DUMP" | grep -c '^- id: ' || true)
trap - 0
[ -d "$PRESET_BACKUP" ] && rm -rf "$PRESET_BACKUP"
echo "dsh-web-eval: installed into $DEST — $MEMBERS @khorsheed members, $ROWS patch rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # hand the running instance over to web-eval on the same port"
