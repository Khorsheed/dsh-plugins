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
#
# `presets` is a DIRECTORY: the profile-local declarative preset bundle
# (@khorsheed/dsh-web-eval-preset, one `preset-eval` row), which package.json
# depends on as `file:presets`. It is copied with the profile so that relative
# spec resolves inside $DEST, and it is replaced whole (rm first — `cp -R dir
# existing-dir` would nest it as presets/presets).
PROFILE_FILES="package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml presets"

# The host line this pack supports: 0.2.0 and later ONLY (user decision
# 2026-10-01, T82). The agent preset is a declarative `@deepseek-ai/dsh-agent-
# preset` row, a row type older hosts either lack (0.1.5: directory presets) or
# carry under a different composition contract (0.1.7); the members' compat
# floors say the same. There is no older-host branch left in this script.
MIN_HOST="0.2.0-rc.2"
MIN_HOST_TOOLCHAIN="~/.dsh-toolchains/rc-0.2.0-rc.2"

# The pack's agent preset is NOT a directory any more. Host 0.2.0's
# agent-preset-registry neither scans directories nor accepts preset paths: a
# preset is a `@deepseek-ai/dsh-agent-preset` loader row. The `eval` preset
# therefore ships in the profile-local bundle `presets/` (see PROFILE_FILES)
# and becomes the default through cordis.patch.yml's `agent-preset-registry`
# pin. The 0.1.5-era branch that replaced $DSH_HOME/.agent-presets/eval whole
# was removed with the directory version (T82).

# The pack's SKILLS, by skill name; each is a directory under skills/ holding
# `SKILL.md`. They do NOT live under the profile directory:
# `dsh-skill-filesystem` scans `$DSH_HOME/skills` (its `user-dsh` root), so the
# roster is per-HOME, and the eval preset's own `skill-filesystem` row is what
# surfaces them in an evaluation session's skill catalog.
#
# Replaced WHOLE on install and on update, for the same reason the eval preset is:
# `eval-planning` teaches the one drafting verb (eval_plan_draft) and where the
# line between drafting and starting is — apparatus, not preference. A locally
# authored skill of the same name is overwritten; author your own under a
# different name.
#
# Because they sit outside $DSH_HOME/profiles/web-eval, uninstalling the
# profile does NOT remove them — the README says so beside the `rm -rf`.
SKILL_IDS="eval-planning"

# Members source mode packs from the checkout — "no usable release on npm".
# Two reasons a member lands here, and docs/release-status.md is the authority
# for both:
#
#   1. never published (the evaluation family: eval, lab, datasets, mission,
#      the local-agent family, capability-catalog, …);
#   2. published, but only against an OLDER host line. npm's newest is the
#      0.2.0 wave (host 0.1.2-rc.1); this profile boots on host 0.2.0-rc.2
#      and later only (T82), and a plugin built against an older line fails
#      at import with a missing export (measured on 0.1.5: `@deepseek-ai/
#      dsh-settings` has no `settingsNamespace`, which context-guard /
#      ui-shortcuts 0.2.0 import). Their host-aligned releases are cut in the
#      repo but not on npm yet (the publish freeze), so until that wave lands
#      they are packed from source like group 1. Remove a member from this
#      list the moment its host-aligned version is ON npm.
#
# Dependency order: the family core first, then the headless bundle
# (local-agent-dsh's own dependency — packed so the override can pin it, never
# a direct profile dependency), then the providers, then the independents,
# then the published-but-lagging members, then the evaluation family bundle
# after its four members. (The family's shared tool package
# local-agent-tool-subagent left this list at the 2026-09-30 fold: the
# delegation tools moved into each provider's ./tool composition entry. The
# three evaluation companions mission-tool / datasets-tool / eval-tool left it
# at the T88 fold the same way: each is its core's ./tool entry now. The four
# evaluation members stay listed although the profile depends only on
# bundle-eval — they reach the profile transitively, and the overrides pin
# them to these tarballs, like local-agent-dsh-headless.)
UNPUBLISHED_DIRS="local-agent local-agent-dsh-headless \
local-agent-kimi local-agent-codex local-agent-claude-code local-agent-dsh \
capability-catalog datasets eval inline-html-render lab local-files mission \
ankh-guard context-guard file-preview message-timeline message-tools taskpilot \
ui-shortcuts session-title-edit whalesong \
bundle-eval"

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

# The host LINE, in every mode: this pack supports 0.2.0 and later only.
# Below that the profile cannot even express its own agent preset, so the
# install would "succeed" and the instance would boot without `eval` — the
# T86 symptom on 0.1.7 was "Unknown agent preset: eval" and a lab page that
# failed whole. Fail here instead, naming the toolchain that works.
HOST_VERSION=$(dsh --version 2>/dev/null | tr -d '[:space:]')
semver_cmp() {
  # Print -1 / 0 / 1 for $1 vs $2 (dotted core plus optional -alpha/-beta/-rc.N
  # tail; a release outranks its prereleases), or "?" when either is
  # unparseable.
  A="$1" B="$2" node <<'NODE'
const parse = (v) => {
  const [core, tail] = String(v).split('-')
  const nums = core.split('.').map(Number)
  const kinds = { alpha: 1, beta: 2, rc: 3 }
  const [kind, seq] = tail === undefined ? ['release', 0] : tail.split('.')
  return { nums, rank: tail === undefined ? 9 : (kinds[kind] ?? 0), seq: Number(seq ?? 0) }
}
const x = parse(process.env.A), y = parse(process.env.B)
let out = 0
if (x.nums.length < 2 || y.nums.length < 2 || x.nums.some(Number.isNaN) || y.nums.some(Number.isNaN)) out = '?'
else {
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length) && out === 0; i += 1) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) out = d < 0 ? -1 : 1
  }
  if (out === 0 && x.rank !== y.rank) out = x.rank < y.rank ? -1 : 1
  if (out === 0 && x.seq !== y.seq) out = x.seq < y.seq ? -1 : 1
}
process.stdout.write(String(out))
NODE
}
case "$(semver_cmp "$HOST_VERSION" "$MIN_HOST")" in
  0|1) ;;
  -1) preflight_fail "  the \`dsh\` on PATH is $HOST_VERSION; dsh-web-eval supports host $MIN_HOST and later only.
  Older hosts cannot load this pack's agent preset (a declarative bundle row since
  0.2.0), so the instance would boot without its \`eval\` preset. Put a matching
  toolchain first on PATH and re-run, e.g.:
    PATH=$MIN_HOST_TOOLCHAIN/node_modules/.bin:\$PATH sh $0 ..." ;;
  *) preflight_fail "  could not read a host version from \`dsh --version\` (got: \"$HOST_VERSION\").
  dsh-web-eval supports host $MIN_HOST and later only; run \`dsh --version\` by hand." ;;
esac

# The host LINE, checked against what the members declare they need. A host
# older than a member's `dsh.compat.minHost` does not fail at install — it
# fails at boot, as a missing export inside a plugin import, which reads like
# a plugin bug and is not one (measured on this profile twice). Source mode
# knows exactly which members it is about to pack, so it can say so first.
if [ -n "$SOURCE" ]; then
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

# Source mode builds every member here, and the typert generator (gen-typert)
# reads the HARNESS CHECKOUT named by DSH_HARNESS (default
# ~/code/deepseek-harness) — not the toolchain on PATH. A checkout from an older
# host line generates remote types for an API the running host no longer has
# (the T78 failure on 0.1.5: generator on the 0.1.7 checkout). Nothing is
# hard-coded here: name the checkout, and it must be on the supported line.
if [ -n "$SOURCE" ]; then
  HARNESS_DIR="${DSH_HARNESS:-$HOME/code/deepseek-harness}"
  [ -f "$HARNESS_DIR/apps/cli/package.json" ] || preflight_fail "  missing: a deepseek-harness checkout at $HARNESS_DIR (DSH_HARNESS).
  Source mode's typert generation reads it. Point DSH_HARNESS at a checkout of
  host $MIN_HOST or later (e.g. a dsh-v$MIN_HOST worktree) and re-run."
  HARNESS_VERSION=$(node -p "require('$HARNESS_DIR/apps/cli/package.json').version" 2>/dev/null || true)
  case "$(semver_cmp "$HARNESS_VERSION" "$MIN_HOST")" in
    0|1) echo "dsh-web-eval: host $HOST_VERSION; typert generated from DSH_HARNESS=$HARNESS_DIR ($HARNESS_VERSION)" ;;
    *) preflight_fail "  DSH_HARNESS=$HARNESS_DIR is host $HARNESS_VERSION, below $MIN_HOST.
  Its generated remote types would target an older API than the host you install
  on. Point DSH_HARNESS at a checkout of $MIN_HOST or later and re-run." ;;
  esac
fi

# The headless bundle path the profile PINS. It is a machine-level
# precondition (the dataset repo's env/README documents how to stage it):
# the same path has to resolve on the host and inside an evaluation unit, or
# the dsh harness's rounds fail with a loader error nothing else explains.
# Since T91 this profile pins `unitHeadlessBundleDir` instead: the in-unit path
# only, which needs nothing on the host (host rounds link to the instance's own
# headless), so the check below guards only a patch pinning the shared form.
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
# The skills are replaced WHOLE (they are apparatus, not preference), so the
# previous copy is kept beside them until the install succeeds: a failure
# halfway through must not be the moment a person discovers their skill
# directory is gone.
SKILL_BACKUP="$DSH_HOME/skills/.web-eval-backup.$$"
trap 'echo "dsh-web-eval: install failed — $DEST is half-installed; remove it before re-running" >&2
  if [ -d "$SKILL_BACKUP" ]; then
    echo "  the skill(s) were replaced; the previous copy is at $SKILL_BACKUP" >&2
    echo "  restore with: rm -rf $DSH_HOME/skills/<id> && mv $SKILL_BACKUP/<id> $DSH_HOME/skills/" >&2
  fi' 0
for f in $PROFILE_FILES; do
  if [ -e "$SRC/$f" ]; then rm -rf "$DEST/$f"; cp -R "$SRC/$f" "$DEST/$f"; fi
done

SKILL_ROOT="$DSH_HOME/skills"
for id in $SKILL_IDS; do
  [ -f "$SRC/skills/$id/SKILL.md" ] || { echo "dsh-web-eval: skills/$id/SKILL.md missing from the clone" >&2; exit 1; }
  mkdir -p "$SKILL_ROOT"
  if [ -d "$SKILL_ROOT/$id" ]; then
    mkdir -p "$SKILL_BACKUP"
    cp -R "$SKILL_ROOT/$id" "$SKILL_BACKUP/$id"
  fi
  rm -rf "$SKILL_ROOT/$id"
  cp -R "$SRC/skills/$id" "$SKILL_ROOT/$id"
  echo "dsh-web-eval: installed skill \"$id\" into $SKILL_ROOT/$id"
done

if [ -n "$SOURCE" ]; then
  TARBALLS="$DEST/tarballs"
  mkdir -p "$TARBALLS"

  # Build each unpublished member in the checkout, scoped like deploy-3080
  # (GEN_TYPERT_ONLY) so a neighbor's WIP cannot block the install, then pack
  # it with its @khorsheed family so cross-family edges land as ^ranges — the
  # overrides written below pin those names to these tarballs.
  #
  # The scoping is NOT free, and dropping it was measured rather than assumed
  # (T50, 2026-09-14). Scoped runs never read or write gen-typert's freshness
  # stamp, so every typert package among the 27 `pnpm --filter … build` calls
  # below regenerates the very same artifacts: the same 8 registered typert
  # packages, ~44s per call, ~6 of the 6m20s this script took over a WARM
  # checkout — nearly all of it. (T35b saw ~80 minutes against ~12 for full
  # mode; that was a cold checkout, where tsc and tsdown dominate instead.
  # Either way the repeated generation is what full mode would remove.)
  #
  # What full mode would also change is the bytes. The generator's shared
  # type-declaration table depends on the ANALYZED SET, and full mode analyzes
  # all 11 registered typert packages — including room, worktrees and canvas,
  # which this profile does not install. Measured: full mode appends room's 14
  # Room* declarations (+4154 bytes) to mission, file-preview and local-agent's
  # typert.host.js and to local-files' remote client; the packed
  # khorsheed-dsh-mission tarball carries 0 of those declarations today.
  # Shipping a member with the types of a package the profile never loads is
  # not a speed/size trade the installer gets to make silently, so the scoping
  # stays. The saving is real and still available — it needs the STAMP to key
  # on the selected set so a scoped run can hit it too, which is a change to
  # gen-typert's cache contract, not to this script.
  NAMES=""
  for d in $UNPUBLISHED_DIRS; do
    NAMES="$NAMES $(node -p "require('$SOURCE/packages/$d/package.json').name")"
  done
  GEN_TYPERT_ONLY="$(printf '%s' "$NAMES" | sed 's/^ //' | tr -s ' ' ',')"
  export GEN_TYPERT_ONLY

  # pack-dist ranges every family manifest edge on the TARGET member's own
  # version, so a bare `--family <name>` is rewrite-only and is an error the
  # moment that name appears in a dependency / peerDependency edge ("is a
  # family edge but no version was given for it"). Index the checkout once —
  # package name → that package's own version — and pass every member as
  # `name=version` in the pack loop below.
  PKG_VERSIONS=$(SOURCE_CHECKOUT="$SOURCE" node <<'NODE'
const fs = require('node:fs')
const root = `${process.env.SOURCE_CHECKOUT}/packages`
const rows = []
for (const dir of fs.readdirSync(root).sort()) {
  const path = `${root}/${dir}/package.json`
  if (!fs.existsSync(path)) continue
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'))
  if (typeof pkg.name === 'string' && typeof pkg.version === 'string') rows.push(`${pkg.name}=${pkg.version}`)
}
process.stdout.write(rows.join('\n'))
NODE
)
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
      # devDependencies count too: pack-dist drops that section from the dist
      # manifest, but a member it knows of gets its name rewritten and its
      # version on hand (T77 — a workspace:* devDependency left unrewritten made
      # pnpm pack fail ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL).
      members=$(node -p "const p=require('$SOURCE/packages/$d/package.json'); [...new Set([...Object.keys(p.dependencies??{}),...Object.keys(p.peerDependencies??{}),...Object.keys(p.devDependencies??{})])].filter(n=>n.startsWith('@khorsheed/')).join(' ')")
      # Each member as name=version, looked up in the index built above. A name
      # the checkout holds no version for goes in bare — correct for a member
      # that only needs rewriting, and pack-dist still fails loudly if that
      # name turns out to carry an edge.
      family=""
      for n in $members; do
        v=$(printf '%s\n' "$PKG_VERSIONS" | sed -n "s|^$n=||p")
        [ -n "$v" ] || echo "dsh-web-eval: warn — no version for family member $n under $SOURCE/packages; passing it bare" >&2
        family="$family,$n${v:+=$v}"
      done
      family="${family#,}"
      echo "dsh-web-eval: packing $name@$version${family:+ (family $family)}"
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
# member (layer header + entry row), so the raw count is nearly double.
#
# Three counts, each composed differently (measured on a 0.2.0-rc.2 temp
# instance after T88 switched the evaluation family to its bundle) — a drop in
# any of them is the symptom this line exists to surface:
#   23  tarballs packed above, one per UNPUBLISHED_DIRS entry (the four
#       evaluation members AND bundle-eval each pack one);
#   19  @khorsheed dependencies in the profile's own package.json — every
#       tarball except local-agent-dsh-headless (local-agent-dsh pulls it in
#       transitively and the overrides pin it, never a direct dependency) and
#       the four evaluation members (bundle-eval hard-depends on them), plus
#       the profile-local preset bundle (`file:presets`, T82);
#   24  distinct names in the dump: the 19 @khorsheed bundles (bundle-eval and
#       the preset bundle among them), the four evaluation members whose rows
#       bundle-eval's patch carries verbatim, and local-agent-dsh-headless (no
#       row at all — it is the sub-dsh's headless bundle). The eval preset row
#       names `@khorsheed/dsh-datasets/tool` and `@khorsheed/dsh-eval/tool`;
#       this grep stops at the slash, so they merge into their cores' names.
#       (The delegation tools left the dump at the 2026-09-30 family fold:
#       they are per-preset `./tool` rows now, granted by the presets that
#       name them — this profile's eval preset names none.)
MEMBERS=$(printf '%s\n' "$DUMP" | grep -o '@khorsheed/[a-z0-9-]*' | sort -u | wc -l | tr -d ' ')
ROWS=$(printf '%s\n' "$DUMP" | grep -c '^- id: ' || true)
# The default preset. cordis.patch.yml pins the registry's deployment default
# to `eval`; the composed dump is the proof it landed. A per-home choice made in
# 设置 → Agent 预设 (the registry's volatile `selectedDefault`) still wins for
# new sessions — that is the person's explicit act, so it is reported, not
# overwritten.
DEFAULT_PRESET=$(printf '%s\n' "$DUMP" | awk '/^- id: agent-preset-registry$/{f=1;next} f&&/^- id: /{f=0} f&&/^[[:space:]]+default:/{print $2; exit}')
trap - 0
if [ -d "$SKILL_BACKUP" ]; then rm -rf "$SKILL_BACKUP"; fi
echo "dsh-web-eval: installed into $DEST — $MEMBERS @khorsheed members, $ROWS patch rows composed"
if [ "$DEFAULT_PRESET" = "eval" ]; then
  echo "dsh-web-eval: default agent preset: eval (pinned by cordis.patch.yml; a default chosen in 设置 → Agent 预设 overrides it for new sessions)"
else
  echo "dsh-web-eval: WARNING — the composed default agent preset is \"${DEFAULT_PRESET:-unknown}\", not eval." >&2
  echo "  Open 设置 → Agent 预设 and set 评测模式 (eval) as the default before starting a session." >&2
fi
if [ -d "$DSH_HOME/.agent-presets/eval" ]; then
  echo "dsh-web-eval: note — $DSH_HOME/.agent-presets/eval is the 0.1.5-era directory preset; host 0.2.0 never reads it. Remove it when convenient (rm -rf \"$DSH_HOME/.agent-presets/eval\")."
fi
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # hand the running instance over to web-eval on the same port"
