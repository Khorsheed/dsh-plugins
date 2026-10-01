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

# Overwritten on update too: the pack's skills. `eval-planning` teaches the one
# drafting verb and where the line between drafting and starting is, so it is
# apparatus like the eval preset. Keep the list in step with install.sh's SKILL_IDS;
# the destination is $DSH_HOME/skills — `dsh-skill-filesystem`'s `user-dsh`
# root, outside the profile directory, because the skill roster is per-HOME.
SKILL_IDS="eval-planning"

# ── Machine-level preflight, BEFORE anything is written. ────────────────
# Same rule as install.sh, and for the same reason: an update replaces the
# pinned patch layer, the preset bundle and the skills WHOLE, and the first `dsh` call is
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

# The update replaces the pinned template files (preset bundle included) and the
# skills whole, so both get a backup that survives until the update succeeds — and a trap that says
# where it is. update.sh had no trap at all: a failure between the preset
# replacement and `dsh plugin install` left a half-updated profile with
# nothing on screen about it.
UPDATE_BACKUP="$DEST/.web-eval-update-backup.$$"
SKILL_BACKUP="$DSH_HOME/skills/.web-eval-backup.$$"
trap 'echo "dsh-web-eval: update failed — $DEST may be half-updated" >&2
  if [ -d "$UPDATE_BACKUP" ]; then
    echo "  the previous template files are at $UPDATE_BACKUP (restore with cp -R $UPDATE_BACKUP/. $DEST/)" >&2
  fi
  if [ -d "$SKILL_BACKUP" ]; then
    echo "  the previous skill(s) are at $SKILL_BACKUP" >&2
    echo "  restore with: rm -rf $DSH_HOME/skills/<id> && mv $SKILL_BACKUP/<id> $DSH_HOME/skills/" >&2
  fi' 0

mkdir -p "$UPDATE_BACKUP"
for f in $UPDATE_FILES; do
  [ -e "$DEST/$f" ] && cp -R "$DEST/$f" "$UPDATE_BACKUP/$f"
done

for f in $UPDATE_FILES; do
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
  echo "dsh-web-eval: refreshed skill \"$id\" at $SKILL_ROOT/$id"
done
dsh plugin --profile web-eval install
ROWS=$(dsh --profile web-eval --dump-config 2>/dev/null | grep -c '^- id: ' || true)
trap - 0
rm -rf "$UPDATE_BACKUP"
if [ -d "$SKILL_BACKUP" ]; then rm -rf "$SKILL_BACKUP"; fi
echo "dsh-web-eval: updated $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # restart to pick up the new members"
