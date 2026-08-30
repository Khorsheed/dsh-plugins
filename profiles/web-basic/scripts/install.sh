#!/bin/sh
# dsh-web-basic installer: drop the profile template into $DSH_HOME and install it.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-basic"

# The profile's own files, listed explicitly. The repo root also holds the
# distribution wrapper (README, scripts, docs, CHANGELOG, LICENSE), so copying
# the directory would leak every future addition into the user's $DSH_HOME
# without a sound. A whitelist fails the other way: a new template file simply
# does not arrive, and the loader-row count printed below drops. Add new
# template files HERE.
PROFILE_FILES="package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml"

if [ -d "$DEST" ]; then
  echo "dsh-web-basic: $DEST already exists — remove it first if you want a clean reinstall" >&2
  exit 1
fi

mkdir -p "$DEST"
for f in $PROFILE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
done
dsh plugin --profile web-basic install
ROWS=$(dsh --profile web-basic --dump-config 2>/dev/null | grep -c '^- id: ' || true)
echo "dsh-web-basic: installed into $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-basic.sh   # hand the running instance over to web-basic on the same port"
