#!/bin/sh
# restart-resume.sh — detached supervisor for a guard-less self-restart.
#
# An agent running INSIDE the instance being upgraded cannot survive the
# restart it performs, and a merely-backgrounded child is reaped when the
# session tears down. This script is spawned FULLY DETACHED (setsid, stdin
# from /dev/null, output to a log file) so it outlives the old instance, then:
#
#   1. waits for the old process to die,
#   2. starts the new host,
#   3. polls a health URL until it answers,
#   4. on failure kills the new host and rolls back to the OLD launch command,
#      health-checking that too,
#   5. records the outcome in a status file for the post-restart session.
#
# It never stops the old instance itself — the caller writes the handoff note,
# spawns this supervisor, verifies it is alive, and only then stops the old
# process.
#
# Required env:
#   OLD_PID        pid of the running instance to wait for
#   NEW_HOST_CMD   shell command that starts the new host (must background
#                  cleanly; this script appends its own log redirection)
#   HEALTH_URL     URL that returns HTTP 2xx/3xx once the host is up
#                  (e.g. http://127.0.0.1:3080/)
# Optional env:
#   ROLLBACK_CMD   shell command that starts the OLD host again; when empty or
#                  when the rollback also fails, the status file says the
#                  instance is DOWN and needs manual recovery
#   STATUS_FILE    outcome record (default: ./restart-resume.status)
#   LOG_FILE       new host's own stdout/stderr (default: ./restart-resume.host.log)
#   STOP_TIMEOUT   seconds to wait for OLD_PID to exit (default 120)
#   HEALTH_TIMEOUT seconds to poll HEALTH_URL per boot attempt (default 120)
#
# Exit code: 0 = new host healthy; 1 = rollback healthy (running old host);
# 2 = everything failed, manual recovery needed.

set -u

OLD_PID="${OLD_PID:?OLD_PID is required}"
NEW_HOST_CMD="${NEW_HOST_CMD:?NEW_HOST_CMD is required}"
HEALTH_URL="${HEALTH_URL:?HEALTH_URL is required}"
ROLLBACK_CMD="${ROLLBACK_CMD:-}"
STATUS_FILE="${STATUS_FILE:-./restart-resume.status}"
LOG_FILE="${LOG_FILE:-./restart-resume.host.log}"
STOP_TIMEOUT="${STOP_TIMEOUT:-120}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

log() { echo "[restart-resume $(date '+%H:%M:%S')] $*"; }

# status <verdict> <detail> — the post-restart session reads this first.
status() {
  {
    echo "verdict: $1"
    echo "at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "detail: $2"
  } > "$STATUS_FILE"
}

pid_alive() { kill -0 "$1" 2>/dev/null; }

# healthy — one HTTP probe; ANY HTTP status code counts as alive: hosts may
# gate the index behind one-time-token auth (0.1.2+ answers a bare GET / with
# 401 and prints the `?token=` URL on stdout), so 4xx is alive too. Only a
# missing answer (curl's 000) is down. If you need a 2xx, extract the token
# from the new host's log first and poll "$HEALTH_URL?token=<token>".
healthy() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --noproxy '*' "$HEALTH_URL" 2>/dev/null)
  case "$code" in 000|'') return 1 ;; *) return 0 ;; esac
}

# wait_dead <pid> <seconds>
wait_dead() {
  elapsed=0
  while pid_alive "$1"; do
    [ "$elapsed" -ge "$2" ] && return 1
    sleep 2; elapsed=$((elapsed + 2))
  done
  return 0
}

# wait_healthy <seconds>
wait_healthy() {
  elapsed=0
  while ! healthy; do
    [ "$elapsed" -ge "$1" ] && return 1
    sleep 3; elapsed=$((elapsed + 3))
  done
  return 0
}

# boot <command> — start a host detached from this supervisor, return its pid.
boot() {
  log "starting: $1"
  setsid sh -c "$1" </dev/null >>"$LOG_FILE" 2>&1 &
  echo $!
}

status "supervising" "waiting for old pid $OLD_PID to exit"
log "waiting for old pid $OLD_PID to exit (up to ${STOP_TIMEOUT}s)"
if ! wait_dead "$OLD_PID" "$STOP_TIMEOUT"; then
  status "aborted" "old pid $OLD_PID still alive after ${STOP_TIMEOUT}s — nothing was restarted"
  log "ABORT: old instance did not exit; leaving it running untouched"
  exit 2
fi

NEW_PID=$(boot "$NEW_HOST_CMD")
status "booting-new" "new host pid $NEW_PID, polling $HEALTH_URL"
log "new host pid $NEW_PID; polling $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)"
if wait_healthy "$HEALTH_TIMEOUT"; then
  status "upgraded" "new host healthy at $HEALTH_URL (pid $NEW_PID)"
  log "new host is healthy — upgrade complete"
  exit 0
fi

log "new host FAILED its health check — killing pid $NEW_PID and rolling back"
kill "$NEW_PID" 2>/dev/null
sleep 2
kill -9 "$NEW_PID" 2>/dev/null

if [ -z "$ROLLBACK_CMD" ]; then
  status "down" "new host failed health check; no ROLLBACK_CMD given — manual recovery needed (see $LOG_FILE)"
  log "no ROLLBACK_CMD — instance is DOWN, manual recovery needed"
  exit 2
fi

OLD_NEW_PID=$(boot "$ROLLBACK_CMD")
status "rolling-back" "old host pid $OLD_NEW_PID, polling $HEALTH_URL"
log "rollback started (pid $OLD_NEW_PID); polling $HEALTH_URL"
if wait_healthy "$HEALTH_TIMEOUT"; then
  status "rolled-back" "new host failed; old host healthy again at $HEALTH_URL (pid $OLD_NEW_PID) — see $LOG_FILE for the boot error"
  log "rollback healthy — running the OLD host again"
  exit 1
fi

status "down" "new host failed AND rollback failed — instance is DOWN; recover manually with the old launch command (see $LOG_FILE)"
log "FATAL: rollback failed its health check too — manual recovery needed"
exit 2
