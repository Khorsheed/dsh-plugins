#!/bin/sh
# dsh-web-dev installer: drop the profile template into $DSH_HOME and install it.
set -eu

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DSH_HOME/profiles/web-dev"

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
# and the roster is per-HOME, not per-profile. Each listed id is replaced
# whole on install and on update (see update.sh): the dev preset is pack
# apparatus — its tool rows ARE the mode. A locally authored preset of the
# same id is overwritten; author your own under a different id. Uninstalling
# the profile does NOT remove them (the roster outlives the profile).
PRESET_IDS="dev"

if [ -d "$DEST" ]; then
  echo "dsh-web-dev: $DEST already exists — remove it first if you want a clean reinstall" >&2
  exit 1
fi

mkdir -p "$DEST"
for f in $PROFILE_FILES; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DEST/$f"
done

PRESET_ROOT="$DSH_HOME/.agent-presets"
for id in $PRESET_IDS; do
  [ -d "$SRC/presets/$id" ] || { echo "dsh-web-dev: presets/$id missing from the clone" >&2; exit 1; }
  mkdir -p "$PRESET_ROOT"
  rm -rf "$PRESET_ROOT/$id"
  cp -R "$SRC/presets/$id" "$PRESET_ROOT/$id"
  echo "dsh-web-dev: installed agent preset \"$id\" into $PRESET_ROOT/$id"
done

dsh plugin --profile web-dev install
ROWS=$(dsh --profile web-dev --dump-config 2>/dev/null | grep -c '^- id: ' || true)
echo "dsh-web-dev: installed into $DEST — $ROWS loader rows composed"
echo "next: sh $(cd "$(dirname "$0")/.." && pwd)/scripts/restart-into-web-dev.sh   # hand the running instance over to web-dev on the same port"
