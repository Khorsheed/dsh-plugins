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
UPDATE_FILES="package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml"

# Overwritten on update too, and for the same reason: the pack's agent presets.
# `presets/eval` is frozen decision 12's execution point — the evaluation
# instance's agent carries no Bash and no container controls — so it is
# apparatus, like the pins above, and a person's edit to it must not survive an
# update silently. Keep the id list in step with install.sh's PRESET_IDS; the
# destination is $DSH_HOME/.agent-presets, outside the profile directory,
# because the preset roster is per-HOME.
PRESET_IDS="eval"

# Overwritten on update too: the pack's skills. `eval-planning` teaches the one
# drafting verb and where the line between drafting and starting is, so it is
# apparatus like the preset. Keep the list in step with install.sh's SKILL_IDS;
# the destination is $DSH_HOME/skills — `dsh-skill-filesystem`'s `user-dsh`
# root, outside the profile directory, because the skill roster is per-HOME.
SKILL_IDS="eval-planning"

# ── Machine-level preflight, BEFORE anything is written. ────────────────
# Same rule as install.sh, and for the same reason: an update replaces the
# pinned patch layer and the agent presets WHOLE, and the first `dsh` call is
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

# The update replaces the pinned template files and the presets whole, so both
# get a backup that survives until the update succeeds — and a trap that says
# where it is. update.sh had no trap at all: a failure between the preset
# replacement and `dsh plugin install` left a half-updated profile with
# nothing on screen about it.
UPDATE_BACKUP="$DEST/.web-eval-update-backup.$$"
PRESET_BACKUP="$DSH_HOME/.agent-presets/.web-eval-backup.$$"
SKILL_BACKUP="$DSH_HOME/skills/.web-eval-backup.$$"
trap 'echo "dsh-web-eval: update failed — $DEST may be half-updated" >&2
  if [ -d "$UPDATE_BACKUP" ]; then
    echo "  the previous template files are at $UPDATE_BACKUP (restore with cp -R $UPDATE_BACKUP/. $DEST/)" >&2
  fi
  if [ -d "$PRESET_BACKUP" ]; then
    echo "  the previous agent preset(s) are at $PRESET_BACKUP" >&2
    echo "  restore with: rm -rf $DSH_HOME/.agent-presets/<id> && mv $PRESET_BACKUP/<id> $DSH_HOME/.agent-presets/" >&2
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
  echo "dsh-web-eval: refreshed agent preset \"$id\" at $PRESET_ROOT/$id"
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
if [ -d "$PRESET_BACKUP" ]; then rm -rf "$PRESET_BACKUP"; fi
if [ -d "$SKILL_BACKUP" ]; then rm -rf "$SKILL_BACKUP"; fi
echo "dsh-web-eval: updated $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # restart to pick up the new members"
