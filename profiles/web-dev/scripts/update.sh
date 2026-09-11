#!/bin/sh
# dsh-web-dev updater: refresh the profile template in $DSH_HOME after members change.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-dev"

# Overwritten on update: the member list and its lockfile are ours to maintain.
# cordis.patch.yml is deliberately NOT here — that layer is yours, and an
# update must never touch it. Add new template files HERE as well as in
# install.sh's PROFILE_FILES.
UPDATE_FILES="package.json pnpm-workspace.yaml pnpm-lock.yaml"

# The pack's agent presets, by preset id; each is a directory under presets/
# holding `agent.cordis.yml` (+ optional `preset.yml`). They live OUTSIDE the
# profile directory (`dsh-agent-presets` scans `$DSH_HOME/.agent-presets` —
# the roster is per-HOME), and each listed id is replaced whole on update:
# the dev preset is pack apparatus (its tool rows ARE the mode), and a local
# edit must not survive an update silently — author your own under a
# different id. Keep the list in step with install.sh's PRESET_IDS. Note
# uninstalling the profile does NOT remove them (same caveat as web-eval).
PRESET_IDS="dev"

if [ ! -d "$DEST" ]; then
  echo "dsh-web-dev: $DEST not found — run install.sh first" >&2
  exit 1
fi

for f in $UPDATE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
done

PRESET_ROOT="$DSH_HOME/.agent-presets"
for id in $PRESET_IDS; do
  [ -d "$SRC/presets/$id" ] || { echo "dsh-web-dev: presets/$id missing from the clone" >&2; exit 1; }
  mkdir -p "$PRESET_ROOT"
  rm -rf "$PRESET_ROOT/$id"
  cp -R "$SRC/presets/$id" "$PRESET_ROOT/$id"
  echo "dsh-web-dev: refreshed agent preset \"$id\" at $PRESET_ROOT/$id"
done

dsh plugin --profile web-dev install
ROWS=$(dsh --profile web-dev --dump-config 2>/dev/null | grep -c '^- id: ' || true)
echo "dsh-web-dev: updated $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-dev.sh   # restart to pick up the new members"
