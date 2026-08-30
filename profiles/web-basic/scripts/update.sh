#!/bin/sh
# dsh-web-basic updater: refresh the profile template in $DSH_HOME after members change.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-basic"

# Overwritten on update: the member list and its lockfile are ours to maintain.
# cordis.patch.yml is deliberately NOT here — that layer is yours, and an
# update must never touch it. Add new template files HERE as well as in
# install.sh's PROFILE_FILES.
UPDATE_FILES="package.json pnpm-workspace.yaml pnpm-lock.yaml"

if [ ! -d "$DEST" ]; then
  echo "dsh-web-basic: $DEST not found — run install.sh first" >&2
  exit 1
fi

for f in $UPDATE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
done
dsh plugin --profile web-basic install
ROWS=$(dsh --profile web-basic --dump-config 2>/dev/null | grep -c '^- id: ' || true)
echo "dsh-web-basic: updated $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-basic.sh   # restart to pick up the new members"
