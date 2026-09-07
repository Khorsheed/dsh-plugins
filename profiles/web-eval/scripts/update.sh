#!/bin/sh
# dsh-web-eval updater: refresh the profile template in $DSH_HOME after members change.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-eval"

# Overwritten on update: the member list, its lockfile, AND cordis.patch.yml.
# The patch layer belongs to the pack here, unlike dsh-web-dev where it is the
# user's: every row in it is an execution point of a frozen decision (drive,
# sandbox tier, reasoning effort, tool-by-domain), and a frozen decision is
# apparatus, not preference. Leaving it to the user means an update can
# silently change the sandbox tier or the reasoning effort while run.meta
# still records the old one — "the subject under test is the same" then means
# nothing. Keep your own overrides in a preset layer, not here.
# Add new template files HERE as well as in install.sh's PROFILE_FILES.
UPDATE_FILES="package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml"

if [ ! -d "$DEST" ]; then
  echo "dsh-web-eval: $DEST not found — run install.sh first" >&2
  exit 1
fi

for f in $UPDATE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
done
dsh plugin --profile web-eval install
ROWS=$(dsh --profile web-eval --dump-config 2>/dev/null | grep -c '^- id: ' || true)
echo "dsh-web-eval: updated $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-eval.sh   # restart to pick up the new members"
