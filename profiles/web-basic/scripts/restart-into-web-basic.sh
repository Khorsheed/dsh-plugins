#!/bin/sh
# restart-into-web-basic — hand the running instance over to the web-basic
# profile on the SAME port, through the pack's own ankh-guard watchdog.
#
# Why the guard and not nohup: an agent running INSIDE the current instance
# dies with it, and a sandboxed session reaps merely-nohup'd children at
# teardown. The guard's watchdog is a properly detached supervisor that
# stops the old instance, boots web-basic with a canary, rolls back if the
# boot fails — and keeps supervising the instance afterwards.
#
# Usage:
#   sh scripts/restart-into-web-basic.sh [port]        (default 3080)
# Env:
#   DSH_BIN   dsh binary to boot with (default: dsh from PATH)
#   DSH_HOME  profile home          (default: $HOME/.dsh)
set -eu

PORT="${1:-3080}"
DSH_BIN="${DSH_BIN:-dsh}"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
CLONE="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$HOME_DIR/profiles/web-basic/node_modules/@khorsheed/dsh-ankh-guard/lib/cli.js"
STATE="$HOME_DIR/state"

if [ ! -f "$GUARD" ]; then
  echo "restart-into-web-basic: ankh-guard CLI not found at $GUARD — run scripts/install.sh first" >&2
  exit 1
fi

# 0. Environment gate: a sandboxed agent session reaps the detached watchdog
# mid-flight. Refuse early with a readable reason instead of half-restarting.
if ! node "$GUARD" check-env --state-dir "$STATE" --repo "$CLONE" > /dev/null 2>&1; then
  echo "restart-into-web-basic: environment check failed — this session looks sandboxed, so the detached watchdog would be reaped when it ends. Re-run from a full-access session (or a plain terminal)." >&2
  exit 1
fi

# 1. Green credential: the evidence is the finished install plus the offline
# composition check, bound to this clone's HEAD.
node "$GUARD" checkpoint --message "web-basic install" --repo "$CLONE" --state-dir "$STATE"
node "$GUARD" record deployment --command "install.sh completed; web-basic composition verified offline" --repo "$CLONE" --state-dir "$STATE"

# 2. Drive the handoff with the `restart` verb — one self-contained
#    stop→start→canary shot. Do NOT pre-adopt with `supervise`: the ankh-guard
#    plugin inside web-basic establishes supervision itself when the pack
#    boots, and a pre-adopted watchdog plus the plugin's own means TWO
#    supervisors on the same port — every restart report then arrives twice
#    (2026-08-24, observed on the 3086 acceptance run).
#    NOTE: no --initiator here — the restart report finds its owner (the
#    session that asked for the install) via $DSH_SESSION_ID in your env.
node "$GUARD" restart --port "$PORT" --start "DSH_HOME='$HOME_DIR' '$DSH_BIN' --profile web-basic --port $PORT --no-open" --profile web-basic --state-dir "$STATE" --repo "$CLONE"

echo "handing the instance on :$PORT over to web-basic (stop → start → canary) — this session will disconnect; the pack comes back on the same port, supervised."
