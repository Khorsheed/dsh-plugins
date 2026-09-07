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

# Members not on npm yet — docs/release-status.md in the dsh-plugins checkout
# is the authority; when a member ships, remove its directory here (and when
# the last one does, source mode retires). Dependency order: the family core
# first, then tool-subagent, the headless bundle (local-agent-dsh's own
# dependency — packed so the override can pin it, never a direct profile
# dependency), then the providers, then the independents.
UNPUBLISHED_DIRS="local-agent local-agent-tool-subagent local-agent-dsh-headless \
local-agent-kimi local-agent-codex local-agent-claude-code local-agent-dsh \
capability-catalog datasets eval inline-html-render lab local-files mission"

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
trap 'echo "dsh-web-eval: install failed — $DEST is half-installed; remove it before re-running" >&2' 0
for f in $PROFILE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
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
echo "dsh-web-eval: installed into $DEST — $MEMBERS @khorsheed members, $ROWS patch rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # hand the running instance over to web-eval on the same port"
