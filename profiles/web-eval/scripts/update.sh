#!/bin/sh
# dsh-web-eval updater: refresh the profile template in $DSH_HOME after members change.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-eval"

# Overwritten on update: the member list, its lockfile, AND cordis.patch.yml.
# The patch layer belongs to the pack here, unlike dsh-dev where it is the
# user's: every row in it is an execution point of a frozen decision (drive,
# sandbox tier, reasoning effort, tool-by-domain), and a frozen decision is
# apparatus, not preference. Leaving it to the user means an update can
# silently change the sandbox tier or the reasoning effort while run.meta
# still records the old one — "the subject under test is the same" then means
# nothing. Keep your own overrides in a preset layer, not here.
# Add new template files HERE as well as in install.sh's PROFILE_FILES.
#
# `presets` is the profile-local declarative preset bundle (one `preset-eval`
# row; package.json depends on it as `file:presets`). It is overwritten for the
# same reason as the pins: the eval preset is frozen decision 12's execution
# point — the evaluation instance's agent carries no Bash and no container
# controls — so it is apparatus, and a person's edit to it must not survive an
# update silently. Directories are replaced whole (rm first, then copy).
UPDATE_FILES="package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml presets"

# Host 0.2.0 and later only — same floor and reason as install.sh's MIN_HOST.
MIN_HOST="0.2.0-rc.2"
MIN_HOST_TOOLCHAIN="~/.dsh-toolchains/rc-0.2.0-rc.2"

# Same as install.sh: the pack ships NO skills any more (T100). `eval-planning` moved into
# @khorsheed/dsh-eval and is registered by its `./tool` row — the row the eval
# preset names — so only evaluation sessions list it. The scripts used to copy
# it into `$DSH_HOME/skills`, the root `dsh-skill-filesystem` scans for EVERY
# preset that composes it, which put the evaluation skill into the dev and
# writing sessions of the same home. A copy those scripts left behind is
# retired after a successful run (retire_legacy_skill below): removed when its
# frontmatter carries the pack's signature (`name: eval-planning` plus
# `iteration: I5` — the scripts always replaced that directory whole, so it was
# never the person's), reported and left alone otherwise.
LEGACY_SKILL_DIR="$DSH_HOME/skills/eval-planning"
retire_legacy_skill() {
  [ -f "$LEGACY_SKILL_DIR/SKILL.md" ] || return 0
  _fm=$(sed -n '1,12p' "$LEGACY_SKILL_DIR/SKILL.md")
  if printf '%s\n' "$_fm" | grep -qx 'name: eval-planning' && printf '%s\n' "$_fm" | grep -qx '  iteration: I5'; then
    rm -rf "$LEGACY_SKILL_DIR"
    echo "dsh-web-eval: removed the old pack copy of the eval-planning skill from $DSH_HOME/skills — @khorsheed/dsh-eval now ships it to evaluation sessions only"
  else
    echo "dsh-web-eval: note — $LEGACY_SKILL_DIR is not the pack's copy, so it was left alone. It shows in every session that scans $DSH_HOME/skills and duplicates the eval-planning skill @khorsheed/dsh-eval registers; rename or remove it."
  fi
}

# ── Machine-level preflight, BEFORE anything is written. ────────────────
# Same rule as install.sh, and for the same reason: an update replaces the
# pinned patch layer and the preset bundle WHOLE, and the first `dsh` call is
# at the very bottom. A machine missing its preconditions must find out while
# the installed profile is still the one that works.
preflight_fail() {
  echo "dsh-web-eval: preflight failed — nothing has been written." >&2
  echo "$1" >&2
  exit 2
}

command -v dsh >/dev/null 2>&1 || preflight_fail "  missing: \`dsh\` on PATH.
  The instance needs it (the eval profile pins cliLaunch: [dsh]) and this
  script updates through it. Put the dsh CLI on PATH and re-run."

dsh --version >/dev/null 2>&1 || preflight_fail "  \`dsh\` is on PATH but \`dsh --version\` failed.
  Run it by hand and fix what it reports before updating."

HOST_VERSION=$(dsh --version 2>/dev/null | tr -d '[:space:]')
HOST_CMP=$(A="$HOST_VERSION" B="$MIN_HOST" node <<'NODE'
const parse = (v) => {
  const [core, tail] = String(v).split('-')
  const nums = core.split('.').map(Number)
  const kinds = { alpha: 1, beta: 2, rc: 3 }
  const [kind, seq] = tail === undefined ? ['release', 0] : tail.split('.')
  return { nums, rank: tail === undefined ? 9 : (kinds[kind] ?? 0), seq: Number(seq ?? 0) }
}
const x = parse(process.env.A), y = parse(process.env.B)
let out = 0
if (x.nums.length < 2 || x.nums.some(Number.isNaN)) out = '?'
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
)
case "$HOST_CMP" in
  0|1) ;;
  *) preflight_fail "  the \`dsh\` on PATH is ${HOST_VERSION:-unreadable}; dsh-web-eval supports host $MIN_HOST and later only.
  Put a matching toolchain first on PATH and re-run, e.g.:
    PATH=$MIN_HOST_TOOLCHAIN/node_modules/.bin:\$PATH sh $0" ;;
esac

HEADLESS_PIN=$(sed -n 's/^[[:space:]]*headlessBundleDir:[[:space:]]*//p' "$SRC/cordis.patch.yml" | head -1)
if [ -n "$HEADLESS_PIN" ] && [ ! -e "$HEADLESS_PIN" ]; then
  preflight_fail "  missing: $HEADLESS_PIN
  cordis.patch.yml pins this as the dsh harness's headless bundle, and the same
  path must exist on this host AND inside the evaluation image. Stage it as the
  dataset repository's env/README describes, then re-run."
fi

if [ ! -d "$DEST" ]; then
  echo "dsh-web-eval: $DEST not found — run install.sh first" >&2
  exit 1
fi

# The update replaces the pinned template files (preset bundle included) whole,
# so they get a backup that survives until the update succeeds — and a trap that says
# where it is. update.sh had no trap at all: a failure between the preset
# replacement and `dsh plugin install` left a half-updated profile with
# nothing on screen about it.
UPDATE_BACKUP="$DEST/.web-eval-update-backup.$$"
trap 'echo "dsh-web-eval: update failed — $DEST may be half-updated" >&2
  if [ -d "$UPDATE_BACKUP" ]; then
    echo "  the previous template files are at $UPDATE_BACKUP (restore with cp -R $UPDATE_BACKUP/. $DEST/)" >&2
  fi' 0

mkdir -p "$UPDATE_BACKUP"
for f in $UPDATE_FILES; do
  [ -e "$DEST/$f" ] && cp -R "$DEST/$f" "$UPDATE_BACKUP/$f"
done

for f in $UPDATE_FILES; do
  if [ -e "$SRC/$f" ]; then rm -rf "$DEST/$f"; cp -R "$SRC/$f" "$DEST/$f"; fi
done

dsh plugin --profile web-eval install
ROWS=$(dsh --profile web-eval --dump-config 2>/dev/null | grep -c '^- id: ' || true)
trap - 0
rm -rf "$UPDATE_BACKUP"
retire_legacy_skill
echo "dsh-web-eval: updated $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # restart to pick up the new members"
