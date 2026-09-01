#!/bin/bash
# dsh watchdog — launcher-layer babysitter for one dsh web instance.
#
# Owns a TCP port, respawns the host when it dies (including intentional
# self-restarts), runs the self-restart-guard canary on intentional restarts,
# rolls the repository back to the last known-good revision (the healthy-boot
# stamp — deployment-proven — else the guard checkpoint, else the green
# credential's HEAD) when the instance repeatedly fails to come up — leaving
# guard-backup-* branches on the discarded HEAD and uncommitted work — and
# serves a crash page with a retry button when it gives up. A boot failure
# whose error subject is a path outside the repository skips the rollback:
# reverting the checkout cannot fix a broken profile overlay or installed
# plugin. The enforcement point of the restart-safety mechanism lives here,
# outside the protected process — spawned detached (setsid) by the guard CLI's
# `supervise` verb or by a launcher, never by hand in normal operation.
#
# Process model: the watchdog reaps the instance it spawned, and on the way
# out (EXIT/TERM/INT) anything it still owns (the instance child, the give-up
# crash page) — supervision never leaves orphans. It does NOT assume a process
# group: the instance is not setsid'd, so reaping walks the descendant tree
# (pgrep -P) instead of killing a group. The supervised instance is expected to
# manage its own children on graceful shutdown; the tree walk is the
# best-effort net for the forced paths (SIGKILL cannot be trapped, and the next
# start's free_port covers that case).
#
# Everything is parameterized by environment (the guard CLI's `supervise` verb
# sets these); nothing here is machine-specific:
#   WD_HOME=DIR        dsh root (default: $DSH_HOME)
#   WD_STATE_DIR=DIR   state dir: markers, pidfile, logs (default: <WD_HOME>/state)
#   WD_PORT=N          port to own (default 3080)
#   WD_REPO=DIR        credential/rollback repository (not the host checkout)
#   WD_HARNESS_ROOT=DIR host checkout exported to the child as DSH_HARNESS
#   WD_START="CMD"     shell command that starts the supervised instance
#   WD_PROFILE=NAME    the profile the instance boots (default web) — its
#                      composition inputs are snapshotted at healthy boots and
#                      restored when boot failures originate outside the repo
#   WD_GUARD="CMD"     how to invoke the guard CLI (default: dsh-ankh-guard)
#   WD_WAIT_OWNER=1    don't adopt the port; wait for the current owner to exit
#   WD_DELAY=N         sleep N seconds before adopting/observing the port
#   WD_INITIATOR=ID    session that established supervision; the adoption
#                      takeover's report record is addressed to it
#   WD_ADOPTION=1      the CLI saw a live owner at supervise time — the first
#                      boot is a takeover (report it), not a first-ever boot
#   WD_SUPERVISE=1     write/check the pidfile (one watchdog only)
#   WD_BOOT_TIMEOUT=N  seconds to prove application readiness (default 60)
#   WD_TAKEOVER_FROM=P replace this live watchdog's pidfile claim before the
#                      old instance is interrupted (launch cutover only)
#   WD_CUTOVER_ID=ID   durable launch-cutover receipt transaction
#   WD_CUTOVER_POLICY= restore-previous or wait-for-user (approved pre-stop)
#   WD_CUTOVER_DELAY_SECONDS=N grace after supervisor claim before old-child stop
#   WD_BROWSER_HANDOFF=required|off after an authenticated launch-URL exchange
#   WD_TEST_FAKE=1     launch a throwaway http server instead of the instance
#   WD_TEST_BREAK=1    launch a command that always fails (give-up testing)
#
# Markers under the state directory (written by the app or the agent):
#   restart-requested.json  -> intentional restart: respawn + canary + clear
#   watchdog-stop           -> exit the watchdog without respawn
set -u

# CLI convenience flag: `--supervise` == WD_SUPERVISE=1.
if [ "${1:-}" = "--supervise" ]; then SUPERVISE=1; else SUPERVISE=0; fi

DSH_ROOT="${WD_HOME:-${DSH_HOME:-}}"
PORT="${WD_PORT:-3080}"
DELAY="${WD_DELAY:-0}"
BOOT_TIMEOUT="${WD_BOOT_TIMEOUT:-60}"
REPO="${WD_REPO:-}"
HARNESS_ROOT="${WD_HARNESS_ROOT:-${DSH_HARNESS:-}}"
PROFILE="${WD_PROFILE:-web}"
START_CMD="${WD_START:-}"
CUTOVER_ID="${WD_CUTOVER_ID:-}"
CUTOVER_POLICY="${WD_CUTOVER_POLICY:-}"
CUTOVER_ROLE="${WD_CUTOVER_ROLE:-target}"
PREVIOUS_START="${WD_PREVIOUS_START:-}"
PREVIOUS_HOME="${WD_PREVIOUS_HOME:-}"
PREVIOUS_REPO="${WD_PREVIOUS_REPO:-}"
PREVIOUS_HARNESS_ROOT="${WD_PREVIOUS_HARNESS_ROOT:-}"
PREVIOUS_PROFILE="${WD_PREVIOUS_PROFILE:-}"
BROWSER_HANDOFF="${WD_BROWSER_HANDOFF:-off}"
TARGET_FAILURE_LIMIT="${WD_TARGET_FAILURE_LIMIT:-2}"
# Every marker, the pidfile, and the attempt log live in ONE state directory:
# WD_STATE_DIR when the guard CLI names it (its --state-dir), else the
# conventional <home>/state. Deriving it here as <home>/state while the guard
# plugin reads its own configured stateDir breaks whenever the two differ (an
# explicit --state-dir, or the '<cwd>/.dsh-guard-state' fallback) — the marker
# the CLI wrote and the snapshot the plugin reads would land in two places.
STATE_DIR="${WD_STATE_DIR:-$DSH_ROOT/state}"
GIVE_UP_MARKER="$STATE_DIR/watchdog-gave-up"
RESTART_MARKER="$STATE_DIR/restart-requested.json"
STOP_MARKER="$STATE_DIR/watchdog-stop"
PIDFILE="$STATE_DIR/watchdog.pid"
ATTEMPT_LOG="$STATE_DIR/boot-attempt.log"

[ -n "$DSH_ROOT" ] || { echo "[watchdog] WD_HOME or DSH_HOME must be set" >&2; exit 1; }
export DSH_HOME="$DSH_ROOT"
mkdir -p "$STATE_DIR"

launch_instance() {
  if [ "${WD_TEST_BREAK:-0}" = "1" ]; then sleep 1; exit 1; fi
  if [ "${WD_TEST_FAKE:-0}" = "1" ]; then
    node -e "require('http').createServer((q,s)=>s.end('ok')).listen($PORT,'127.0.0.1')"
    exit
  fi
  if [ -z "$START_CMD" ]; then echo "[watchdog] launch command unset — nothing to supervise" >&2; exit 1; fi
  # The instance inherits this process's environment: scrub EVERY WD_* so no
  # supervision variable can leak into the shells the instance hosts. A leaked
  # WD_STATE_DIR retargets any watchdog script those shells spawn (observed
  # 2026-08-29: an agent session inside the supervised deployment ran the test
  # suite straight into the PROD state dir — racers yielded to the live
  # pidfile owner, and the reclaim case never saw its temp pidfile). The scrub
  # is prefix-based, not a name list: the CLI adds WD_* variables over time
  # (WD_GUARD, WD_WAIT_OWNER, WD_ADOPTION, …) and a list silently goes stale.
  # WD_START is captured first: the unset would otherwise eat the command
  # itself. The guard CLI's bare-restart spawn applies the same scrub.
  local start_cmd=$START_CMD launch_home=$DSH_ROOT launch_harness_root=$HARNESS_ROOT
  (
    export DSH_HOME="$launch_home"
    if [ -n "$launch_harness_root" ]; then export DSH_HARNESS="$launch_harness_root"; fi
    cd "$launch_home/home" 2>/dev/null || cd /tmp || exit 1
    for v in $(env | sed -n 's/^\(WD_[^=]*\)=.*/\1/p'); do unset "$v"; done
    sh -c "$start_cmd"
  )
}

http_status() {
  curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null || true
}

cutover_event() {
  [ -n "$CUTOVER_ID" ] || return 0
  guard_cmd cutover-event "$CUTOVER_ID" "$@" --state-dir "$STATE_DIR" >/dev/null 2>&1
}

# Receipt updates are part of the transaction, not telemetry. Keep the proven
# child (or the still-running old child during supervisor handoff) available
# while retrying a transient state/CLI failure; never advance in memory past a
# durable event that crash recovery depends on.
cutover_event_required() {
  [ -n "$CUTOVER_ID" ] || return 0
  while ! cutover_event "$@"; do
    echo "[watchdog] could not persist cutover event $1 — retrying; service state is unchanged" >&2
    sleep 1
  done
}

# The host owns the shape of its per-process launch URL. Discovery is generic:
# the first HTTP URL printed by THIS attempt whose authority is exactly the
# supervised loopback authority and whose query is non-empty. No parameter
# name ("token" or otherwise) is part of the watchdog protocol.
launch_url_from_output() {
  node -e '
    const fs = require("fs")
    const [file, port] = process.argv.slice(1)
    let text = ""
    try { text = fs.readFileSync(file, "utf8") } catch {}
    for (const match of text.matchAll(/https?:\/\/[^\s)]+/g)) {
      try {
        const url = new URL(match[0])
        if (url.protocol === "http:" && url.hostname === "127.0.0.1"
          && url.port === port && url.pathname === "/" && url.search !== "") {
          process.stdout.write(url.href)
          break
        }
      } catch {}
    }
  ' "$ATTEMPT_LOG" "$PORT" 2>/dev/null
}

# The process output is durable operational evidence, but a launch URL is a
# bearer credential. Once captured in memory, overwrite every matching URL in
# place with an equal-length marker. Equal length preserves the active child's
# append offset; an atomic rename here would strand later output on an unlinked
# inode. The failure path calls this too, so a process that prints then exits
# cannot have its credential mirrored into the watchdog log.
redact_launch_urls_in_output() {
  node -e '
    const fs = require("fs")
    const [file, port] = process.argv.slice(1)
    let text
    try { text = fs.readFileSync(file, "utf8") } catch { process.exit(0) }
    const edits = []
    for (const match of text.matchAll(/https?:\/\/[^\s)]+/g)) {
      try {
        const url = new URL(match[0])
        if (url.protocol === "http:" && url.hostname === "127.0.0.1"
          && url.port === port && url.pathname === "/" && url.search !== "") {
          const start = Buffer.byteLength(text.slice(0, match.index))
          const length = Buffer.byteLength(match[0])
          edits.push({ start, length })
        }
      } catch {}
    }
    if (edits.length === 0) process.exit(0)
    const fd = fs.openSync(file, "r+")
    try {
      for (const { start, length } of edits) {
        const label = Buffer.from("[launch-url-redacted]")
        const replacement = Buffer.alloc(length, 0x20)
        label.copy(replacement, 0, 0, Math.min(label.length, replacement.length))
        fs.writeSync(fd, replacement, 0, replacement.length, start)
      }
    } finally { fs.closeSync(fd) }
  ' "$ATTEMPT_LOG" "$PORT" 2>/dev/null || true
}

open_launch_url() {
  local url=$1
  if [ -n "${WD_BROWSER_OPEN_COMMAND:-}" ]; then
    "${WD_BROWSER_OPEN_COMMAND}" "$url" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1
  elif command -v gio >/dev/null 2>&1; then
    gio open "$url" >/dev/null 2>&1
  else
    return 1
  fi
}

last_transport_status=''
launch_url_reported=0
launch_url_value=''
browser_handoff_done=0
browser_handoff_reported=0
handoff_cookie_jar=''
readiness_detail=''

# Readiness has two layers. Any HTTP response proves transport-up; only a bare
# 200, or a same-authority launch-URL exchange (303 + cookie-authenticated 200)
# proves application readiness. A naked 401 therefore never counts as ready.
ready_probe() {
  local status url jar exchange authenticated
  status=$(http_status)
  if [ -n "$status" ] && [ "$status" != "000" ] && [ "$status" != "$last_transport_status" ]; then
    last_transport_status=$status
    cutover_event_required transport "$status"
    if [ "$status" != "200" ]; then
      echo "[watchdog] transport up on :$PORT (HTTP $status); application readiness still pending"
    fi
  fi
  if [ "$status" = "200" ]; then
    readiness_detail="plain HTTP 200"
    return 0
  fi

  if [ -z "$launch_url_value" ]; then
    launch_url_value=$(launch_url_from_output)
    [ -n "$launch_url_value" ] && redact_launch_urls_in_output
  fi
  url=$launch_url_value
  [ -n "$url" ] || return 1
  if [ "$launch_url_reported" = "0" ]; then
    echo "[watchdog] observed same-authority launch URL (credential redacted)"
    cutover_event_required launch-url
    launch_url_reported=1
  fi
  jar=$(mktemp "${TMPDIR:-/tmp}/ankh-guard-handoff.XXXXXX") || return 1
  handoff_cookie_jar=$jar
  chmod 600 "$jar" 2>/dev/null || true
  exchange=$(curl -sS --noproxy '*' -c "$jar" -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || true)
  cutover_event_required auth-exchange "${exchange:-0}"
  if [ "$exchange" != "303" ]; then rm -f "$jar"; handoff_cookie_jar=''; return 1; fi
  authenticated=$(curl -sS --noproxy '*' -b "$jar" -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  rm -f "$jar"
  handoff_cookie_jar=''
  cutover_event_required authenticated "${authenticated:-0}"
  [ "$authenticated" = "200" ] || return 1

  if [ "$BROWSER_HANDOFF" = "required" ] && [ "$browser_handoff_done" = "0" ]; then
    if ! open_launch_url "$url"; then
      if [ "$browser_handoff_reported" = "0" ]; then
        echo "[watchdog] browser launch-URL handoff failed — not ready"
        cutover_event_required browser-handoff failed
        browser_handoff_reported=1
      fi
      return 1
    fi
    browser_handoff_done=1
    browser_handoff_reported=1
    cutover_event_required browser-handoff accepted
    echo "[watchdog] browser launch-URL handoff accepted (URL credential redacted)"
  elif [ "$BROWSER_HANDOFF" = "off" ] && [ "$browser_handoff_reported" = "0" ]; then
    cutover_event_required browser-handoff off
    browser_handoff_reported=1
  fi
  if [ "$browser_handoff_done" = "1" ]; then
    readiness_detail="authenticated launch URL: 303 exchange, cookie / = 200, browser handoff accepted"
  else
    readiness_detail="authenticated launch URL: 303 exchange, cookie / = 200"
  fi
  return 0
}

transport_up() {
  local status
  status=$(http_status)
  [ -n "$status" ] && [ "$status" != "000" ]
}

# Reap a pid AND its descendants, deepest first (best effort). The watchdog
# guarantees the direct child; the sweep keeps grandchildren from outliving
# the instance — a single-pid kill is what orphaned listeners and left the
# EADDRINUSE race behind.
kill_tree() {
  local pid=$1 sig=${2:-TERM} child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill -s "$sig" "$pid" 2>/dev/null || true
}

# Echo a pid and all its descendants, one per line.
pid_tree() {
  local pid=$1 child
  echo "$pid"
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    pid_tree "$child"
  done
}

# Every TCP port the instance tree is listening on, one per line. Used only to
# explain a boot-window timeout: a `--start` command that omits the port flag
# binds the application default instead of the supervised port, so the instance
# is healthy on a port nobody is watching while this watchdog polls an empty
# one. `lsof` takes the whole tree because the started command usually execs
# into the server through a shell.
instance_listen_ports() {
  local pids
  pids=$(pid_tree "$1" | paste -sd, -)
  [ -n "$pids" ] || return 0
  lsof -nP -a -p "$pids" -iTCP -sTCP:LISTEN 2>/dev/null \
    | awk 'NR > 1 { n = split($9, a, ":"); print a[n] }' | sort -u
}

# Free the port: the watchdog is the declared owner, so it adopts an existing
# listener (the one-time bounce that moves a running instance under supervision).
free_port() {
  local pid p
  pid=$(lsof -tiTCP:$PORT -sTCP:LISTEN -P 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "[watchdog] freeing :$PORT from pid(s) $pid"
    for p in $pid; do kill_tree "$p" TERM; done
    sleep 2
  fi
}

# The rollback target: the last DEPLOYMENT-PROVEN revision (stamped by this
# watchdog on every healthy boot — a green credential proves build+test
# passed, never that the deployment composes and the instance comes up),
# falling back to the guard checkpoint, then the credential's HEAD.
# The reset itself (guard CLI) leaves guard-backup-* recovery anchors for the
# discarded HEAD and any uncommitted work, so recovery never needs the reflog.
rollback_sha() {
  node -e "
    const fs = require('fs')
    let sha = ''
    try {
      const boot = JSON.parse(fs.readFileSync('$STATE_DIR/last-good-boot.json', 'utf8'))
      if (typeof boot.revision === 'string' && boot.revision !== '') sha = boot.revision
    } catch {}
    if (sha === '') {
      try {
        const s = require('$STATE_DIR/self-restart-guard.json')
        sha = s.checkpoint?.revision ?? s.credential?.revision ?? ''
      } catch {}
    }
    process.stdout.write(sha)
  " 2>/dev/null
}

# A healthy boot proves the current HEAD runs in this deployment: stamp it as
# the preferred rollback target.
stamp_last_good_boot() {
  [ -n "$REPO" ] || return 0
  local sha
  sha=$(git -C "$REPO" rev-parse HEAD 2>/dev/null) || return 0
  [ -n "$sha" ] || return 0
  printf '{"revision":"%s","at":%s}\n' "$sha" "$(date +%s)000" > "$STATE_DIR/last-good-boot.json"
}

# A healthy boot also proves the current PROFILE COMPOSITION runs: snapshot
# its inputs (the bundles patch layer + the profile manifest). This is the
# rollback target for failures a checkout reset cannot fix — a freshly
# installed plugin whose row breaks the real boot lives in the profile, not
# the repository.
snapshot_composition() {
  local dir="$DSH_ROOT/profiles/$PROFILE"
  [ -f "$dir/cordis.patch.yml" ] || return 0
  mkdir -p "$STATE_DIR/last-good-composition"
  cp "$dir/cordis.patch.yml" "$STATE_DIR/last-good-composition/"
  if [ -f "$dir/package.json" ]; then cp "$dir/package.json" "$STATE_DIR/last-good-composition/"; fi
}

# Restore the snapshotted composition over the live one, backing the current
# (failing) inputs up first and computing the delta for the recovery report.
# Returns 1 when there is nothing to restore to (no snapshot, or the snapshot
# already IS the live composition — retrying a boot with unchanged inputs is
# pointless).
restore_composition() {
  local snap="$STATE_DIR/last-good-composition"
  local dir="$DSH_ROOT/profiles/$PROFILE"
  [ -f "$snap/cordis.patch.yml" ] || return 1
  local same=1
  diff -q "$snap/cordis.patch.yml" "$dir/cordis.patch.yml" >/dev/null 2>&1 || same=0
  if [ -f "$snap/package.json" ] || [ -f "$dir/package.json" ]; then
    diff -q "$snap/package.json" "$dir/package.json" >/dev/null 2>&1 || same=0
  fi
  [ "$same" = "0" ] || return 1
  # What the rollback unmounts — names for the recovery report.
  comp_restore_detail=$(node -e '
    const fs = require("fs")
    const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch { return {} } }
    const live = read(process.argv[1]), snap = read(process.argv[2])
    const added = (a, b) => a.filter((x) => !b.includes(x))
    const parts = []
    const rows = added(live.dsh?.profile?.bundles ?? [], snap.dsh?.profile?.bundles ?? [])
    if (rows.length > 0) parts.push(`卸载挂载行: ${rows.join(", ")}`)
    const deps = added(Object.keys(live.dependencies ?? {}), Object.keys(snap.dependencies ?? {}))
    if (deps.length > 0) parts.push(`移除依赖: ${deps.join(", ")}`)
    process.stdout.write(parts.join(";"))
  ' "$dir/package.json" "$snap/package.json" 2>/dev/null)
  if ! diff -q "$snap/cordis.patch.yml" "$dir/cordis.patch.yml" >/dev/null 2>&1; then
    comp_restore_detail="${comp_restore_detail:+$comp_restore_detail;}回滚 profile patch 层变更"
  fi
  local backup="$STATE_DIR/composition-backup-$(date +%s)"
  mkdir -p "$backup"
  cp "$dir/cordis.patch.yml" "$backup/" 2>/dev/null || true
  if [ -f "$dir/package.json" ]; then cp "$dir/package.json" "$backup/"; fi
  cp "$snap/cordis.patch.yml" "$dir/cordis.patch.yml"
  if [ -f "$snap/package.json" ]; then cp "$snap/package.json" "$dir/package.json"; fi
  echo "[watchdog] restored the last healthy profile composition over $dir (failing inputs backed up to $backup)"
  return 0
}

# Roll back to a known-good revision — unless that revision already IS HEAD:
# the reset would be a commit no-op whose only effect is wiping uncommitted
# work (a real hazard with concurrent sessions on a shared checkout), so skip
# it. Returns 1 when the reset was skipped, so the boot-failure path keeps
# counting toward give-up instead of retrying a boot that cannot change.
rollback_to() {
  local sha="$1" head
  head=$(git -C "$REPO" rev-parse HEAD 2>/dev/null)
  if [ -n "$head" ] && [ "$sha" = "$head" ]; then
    echo "[watchdog] rollback target $sha is the current HEAD — skipping reset (nothing to roll back; a reset would only wipe uncommitted work)"
    return 1
  fi
  echo "[watchdog] rolling repo back to last known-good $sha"
  guard_reset "$sha"
}

# Where did the boot failure originate? The error's subject is the first
# absolute path on the `Error:` message line of the attempt log. Node's
# uncaught-exception printout leads with the THROW SITE (a repo-internal path
# naming the parser, not the cause) and follows with `    at ` stack frames,
# so the message line is the only reliable carrier of the offending path; the
# non-frame scan is the fallback for output without an `Error:` line. A
# subject outside the repository means a rollback — which only reverts the
# checkout — cannot fix this failure.
failure_subject_outside_repo() {
  [ -n "$REPO" ] || return 1
  local subject
  subject=$(grep -m1 -E '^[A-Za-z]*Error: ' "$ATTEMPT_LOG" 2>/dev/null | grep -oE '/[^ )]+' | head -1)
  if [ -z "$subject" ]; then
    subject=$(grep -v '^ *at ' "$ATTEMPT_LOG" 2>/dev/null | grep -oE '/[^ )]+' | head -1)
  fi
  [ -n "$subject" ] || return 1
  case "$subject" in
    "$REPO"|"$REPO"/*) return 1 ;;
    *) return 0 ;;
  esac
}

guard_cmd() {
  local bin="${WD_GUARD:-dsh-ankh-guard}"
  $bin "$@"
}

guard_verify() {
  guard_cmd verify --repo "$REPO" --state-dir "$STATE_DIR" >/dev/null 2>&1
}

guard_reset() {
  guard_cmd reset "$1" --repo "$REPO" --state-dir "$STATE_DIR"
}

# Give-up crash page: a tiny HTTP server served by the watchdog itself, with a
# retry button that signals the watchdog (SIGUSR1) — no terminal needed.
page_script() {
  cat <<'EOF'
const http = require('http');
const port = Number(process.env.WD_PORT || 3080);
const wd = Number(process.env.WD_PID);
const handler = (req, res) => {
  if (req.url === '/restart') {
    try { process.kill(wd, 'SIGUSR1'); res.end('retrying...'); }
    catch (e) { res.statusCode = 500; res.end('signal failed: ' + e.message); }
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  // 503, never 200: a probe that treats any 200 as "service healthy" must not
  // read the give-up page as the instance it replaced.
  res.statusCode = 503;
  res.end('<!doctype html><meta charset="utf-8"><title>dsh 未能启动</title>'
    + '<body style="font-family:system-ui;display:flex;height:100vh;align-items:center;justify-content:center">'
    + '<div style="text-align:center"><h2>dsh 服务未能启动</h2>'
    + '<p>看门狗多次尝试仍未拉起服务。点击重试，或查看看门狗日志。</p>'
    + '<form action="/restart"><button style="font-size:18px;padding:10px 28px">重试</button></form></div></body>');
};
// An occupied port is the COMMON case at give-up (the boot failures were
// often EADDRINUSE themselves). Dying on the bind error — an unhandled
// 'error' event — would return the watchdog's `wait` and drop it back into
// the boot loop, fighting the healthy occupant it just gave up against
// (observed 2026-08-30 in an e2e rig: four give-up cycles, the occupant
// killed over and over). Park instead: retry the bind every 5s; SIGUSR1
// still re-arms the boot loop.
let noted = false;
function bind() {
  const server = http.createServer(handler);
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      if (!noted) {
        noted = true;
        process.stderr.write('[watchdog] crash page cannot bind :' + port + ' (occupied) — retrying every 5s; SIGUSR1 to ' + wd + ' re-arms the boot loop\n');
      }
      setTimeout(bind, 5000);
      return;
    }
    throw e;
  });
  server.listen(port, '127.0.0.1');
}
bind();
EOF
}

retry_on_usrs() {
  echo "[watchdog] USR1 received — clearing give-up marker and retrying"
  rm -f "$GIVE_UP_MARKER"
  if [ -n "${page_pid:-}" ]; then kill "$page_pid" 2>/dev/null; fi
  failures=0
  reset_done=0
  port_races=0
}

# --supervise: one watchdog only. The claim must be atomic — a check-then-write
# (`[ -f ]` + `kill -0`, then `>`) is a TOCTOU window in which two watchdogs
# starting together both find no live owner, both write, and both supervise the
# same port. `set -C` (noclobber) makes the redirect itself fail when the file
# exists, so exactly one racer creates it and the others take the exit path.
# Note this runs BEFORE the cleanup trap is installed: a loser must not remove
# the winner's pidfile on its way out.
if [ "$SUPERVISE" = "1" ]; then
  mkdir -p "$(dirname "$PIDFILE")" 2>/dev/null || true
  claimed=0
  attempt=0
  empty_reads=0
  if [ -n "${WD_TAKEOVER_FROM:-}" ]; then
    owner=$(cat "$PIDFILE" 2>/dev/null)
    if [ "$owner" != "$WD_TAKEOVER_FROM" ] || ! kill -0 "$owner" 2>/dev/null; then
      echo "[watchdog] takeover refused: expected live pidfile owner $WD_TAKEOVER_FROM, found ${owner:-none}" >&2
      exit 1
    fi
    takeover_tmp="$PIDFILE.takeover.$$"
    echo $$ > "$takeover_tmp"
    # Atomic rename is the ownership handoff commit point. The previous
    # watchdog already knows how to yield to a different live pidfile owner
    # without reaping its child, so this works even when that watchdog is the
    # older package version that had no reconfigure verb.
    mv -f "$takeover_tmp" "$PIDFILE"
    claimed=1
    echo "[watchdog] claimed supervision from watchdog $owner; old child remains running until the scheduled exit"
    cutover_event_required supervisor-ready "$$"
  else
    while [ "$attempt" -lt 5 ]; do
      attempt=$((attempt + 1))
      if (set -C; echo $$ > "$PIDFILE") 2>/dev/null; then claimed=1; break; fi
      owner=$(cat "$PIDFILE" 2>/dev/null)
      if [ -n "$owner" ]; then
        if kill -0 "$owner" 2>/dev/null; then
          echo "[watchdog] already supervised by pid $owner; exiting"
          exit 0
        fi
        # A real but dead claim: safe to drop below.
        empty_reads=0
      else
        # An EMPTY pidfile is a rival's claim mid-write: the noclobber create
        # and the echo are two disk operations, and a preempted winner sits
        # between them. Deleting the file here re-opens the race and can
        # cascade until every racer exhausts its attempts (observed under
        # deploy-gate load: 8 concurrent racers, zero survivors). Give the
        # writer a beat to land its pid; only treat the file as abandoned
        # after several consecutive empty reads.
        empty_reads=$((empty_reads + 1))
        if [ "$empty_reads" -le 3 ]; then
          attempt=$((attempt - 1))
          sleep 0.2
          continue
        fi
      fi
      # Stale (owner gone, or abandoned mid-write): drop it and race for the
      # claim again. Losing that race is correct — the next pass sees a live
      # owner and exits through the branch above.
      rm -f "$PIDFILE"
    done
  fi
  if [ "$claimed" != "1" ]; then
    echo "[watchdog] could not claim $PIDFILE after $attempt attempts" >&2
    exit 1
  fi
fi

# Graceful launch: let the scheduling turn finish before the adoption bounce.
if [ "$DELAY" -gt 0 ] 2>/dev/null; then sleep "$DELAY"; fi

rm -f "$GIVE_UP_MARKER"
failures=0
reset_done=0
port_races=0
target_attempt=0
previous_attempt=0
yielded=0
comp_restore_done=0
comp_restored=0
comp_restore_detail=''

trap 'retry_on_usrs' USR1

# Reap what we spawned on the way out — the instance child and the give-up
# crash page. Without this, TERM/INT (or a plain exit) orphans them to PPID 1:
# the leak that left three crash pages on 8/16, and the held port the
# EADDRINUSE branch then had to free. SIGKILL cannot be trapped; the next
# start's free_port covers that case. (`set -u` — guard every var.)
cleanup() {
  if [ -n "${handoff_cookie_jar:-}" ]; then rm -f "$handoff_cookie_jar"; fi
  if [ -n "${page_pid:-}" ]; then kill "$page_pid" 2>/dev/null; fi
  # A YIELDING watchdog leaves its instance running for the new owner (the
  # port is healthy; killing it would just make the successor respawn).
  if [ -n "${child:-}" ] && [ "${yielded:-0}" != "1" ]; then kill_tree "$child" TERM; fi
  # Drop the pidfile ONLY while it names us: a successor watchdog may have
  # already claimed it in the restart window, and deleting theirs would let a
  # second supervisor in.
  if [ -f "$PIDFILE" ] && [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ]; then
    if [ -n "${WD_TAKEOVER_FROM:-}" ] && kill -0 "$WD_TAKEOVER_FROM" 2>/dev/null; then
      takeover_restore="$PIDFILE.restore.$$"
      echo "$WD_TAKEOVER_FROM" > "$takeover_restore"
      mv -f "$takeover_restore" "$PIDFILE"
      echo "[watchdog] takeover aborted while old watchdog $WD_TAKEOVER_FROM is alive — restored its pidfile claim"
    else
      rm -f "$PIDFILE"
    fi
  fi
  return 0
}
trap cleanup EXIT
trap 'cleanup; exit 143' TERM INT

write_cutover_restart_marker() {
  node -e '
    const fs = require("fs")
    const [file, id, initiator] = process.argv.slice(1)
    fs.writeFileSync(file, JSON.stringify({
      reason: "launch configuration cutover",
      cutoverId: id,
      requestedAt: Date.now(),
      ...(initiator === "" ? {} : { initiator }),
    }) + "\n")
  ' "$RESTART_MARKER" "$CUTOVER_ID" "${WD_INITIATOR:-}"
}

if [ -n "${WD_TAKEOVER_FROM:-}" ]; then
  # The atomic pidfile claim above is the cutover commit point. From here the
  # replacement watchdog — not the short-lived reconfigure caller — owns the
  # delayed old-child stop, so a caller/session death cannot strand the
  # transaction between "supervisor-ready" and "host stopped".
  cutover_delay="${WD_CUTOVER_DELAY_SECONDS:-5}"
  echo "[watchdog] supervision claimed; leaving the old host uninterrupted for ${cutover_delay}s"
  sleep "$cutover_delay"
  # Do not publish the restart marker while the previous watchdog is still
  # alive. Older watchdogs consume that marker themselves; if one wins that
  # race, the replacement child can become healthy while the cutover receipt
  # remains permanently nonterminal. The previous child stays up throughout
  # this wait. A healthy old watchdog notices our pidfile claim on its next
  # supervision pass and yields without reaping the child.
  if kill -0 "$WD_TAKEOVER_FROM" 2>/dev/null; then
    echo "[watchdog] waiting for old watchdog $WD_TAKEOVER_FROM to yield; old host remains available"
    while kill -0 "$WD_TAKEOVER_FROM" 2>/dev/null; do sleep 0.2; done
  fi
  # Publish the intentional-restart marker only at the irreversible boundary.
  # Writing it in the reconfigure caller lets the OLD watchdog consume and
  # clear it before yielding, leaving the final child ready but the receipt
  # permanently nonterminal. The old instance still sees the marker during
  # SIGTERM and can snapshot interrupted sessions with the correct initiator.
  write_cutover_restart_marker
  free_port
  echo "[watchdog] old host stopped — taking over :$PORT"
  # This is the irreversible boundary. Never restore a possibly recycled old
  # supervisor pid during a much later cleanup.
  WD_TAKEOVER_FROM=""
elif [ -n "$CUTOVER_ID" ]; then
  # OS-level crash recovery: this watchdog claimed a stale/empty pidfile and
  # resumes the atomically selected side of an existing transaction. Replace
  # any orphan listener from the failed supervisor, then prove a fresh final
  # child; never compact the transaction merely because its driver died.
  echo "[watchdog] resuming launch cutover $CUTOVER_ID on selected side $CUTOVER_ROLE"
  cutover_event_required supervisor-ready "$$"
  write_cutover_restart_marker
  free_port
elif [ "${WD_WAIT_OWNER:-0}" = "1" ]; then
  # Adoption ahead of a self-restart: the current owner exits on its own.
  echo "[watchdog] waiting for the current owner of :$PORT to exit"
  while lsof -tiTCP:$PORT -sTCP:LISTEN -P >/dev/null 2>&1; do sleep 1; done
  echo "[watchdog] port free — taking over"
else
  free_port
fi

while true; do
  # Self-heal the ownership claim FIRST: if the state dir (or the pidfile) was
  # cleaned underneath a live watchdog, reclaim it; if another LIVE watchdog
  # now holds it, yield — two supervisors on one port reap each other's
  # instance (observed: stale watchdog + deleted pidfile → second watchdog
  # spawned → both fought over the port).
  if [ "$SUPERVISE" = "1" ]; then
    if [ ! -f "$PIDFILE" ]; then (set -C; echo $$ > "$PIDFILE") 2>/dev/null || true; fi
    pidowner=$(cat "$PIDFILE" 2>/dev/null)
    if [ -n "$pidowner" ] && [ "$pidowner" != "$$" ] && kill -0 "$pidowner" 2>/dev/null; then
      echo "[watchdog] pidfile now owned by live pid $pidowner — yielding"
      yielded=1
      # Non-zero keeps launchd/systemd's stable launcher alive: it restarts,
      # reads the newly selected durable spec, then waits behind the successor.
      # A detached parent simply observes the code and is unaffected.
      exit 75
    fi
  fi
  # Snapshot BEFORE this boot rewrites it: the stamp exists iff this
  # deployment has ever come up healthy — the discriminator between
  # "recovered an unplanned exit" and "first boot ever" (a first boot must
  # not file a crash report). Durable (not a process flag) so a restarted
  # watchdog still judges correctly.
  had_boot_stamp=0
  [ -f "$STATE_DIR/last-good-boot.json" ] && had_boot_stamp=1
  if [ "$CUTOVER_ROLE" = "target" ]; then
    target_attempt=$((target_attempt + 1))
    current_attempt=$target_attempt
  else
    previous_attempt=$((previous_attempt + 1))
    current_attempt=$previous_attempt
  fi
  # Keep the long-standing "starting instance" prefix stable for operators and
  # log consumers; the role is additive cutover metadata.
  echo "[watchdog] starting instance on :$PORT (role=$CUTOVER_ROLE, failures=$failures, attempt=$current_attempt)"
  # Capture this attempt's output for failure-domain classification. Plain
  # redirection only — never > >(tee …) process substitution: a sandboxed or
  # detached spawner can EPERM on the /dev/fd/N that >() opens (workspace-write
  # sandboxes do), killing the instance before it runs. On failure the attempt
  # log is mirrored into this log below; a healthy run's boot message names
  # the file its output lives in.
  : > "$ATTEMPT_LOG"
  chmod 600 "$ATTEMPT_LOG" 2>/dev/null || true
  launch_instance > "$ATTEMPT_LOG" 2>&1 &
  child=$!
  cutover_event_required child-started "$CUTOVER_ROLE" "$current_attempt" "$child"
  last_transport_status=''
  launch_url_reported=0
  launch_url_value=''
  readiness_detail=''
  # Boot window: transport-up is not enough. A protected root can answer 401;
  # ready_probe completes the process's announced launch-URL cookie exchange.
  up=0
  boot_limit=$(( $(date +%s) + BOOT_TIMEOUT ))
  while [ "$(date +%s)" -lt "$boot_limit" ]; do
    if ! kill -0 "$child" 2>/dev/null; then break; fi
    if ready_probe; then up=1; break; fi
    sleep 1
  done

  if [ "$up" = "0" ]; then
    # Read the bound ports BEFORE reaping — once the child is gone there is no
    # way left to tell "never started" from "started on the wrong port".
    bound=""
    if kill -0 "$child" 2>/dev/null; then bound=$(instance_listen_ports "$child"); fi
    # Never came up (or died); stop a still-alive child and reap it.
    if kill -0 "$child" 2>/dev/null; then kill "$child" 2>/dev/null; fi
    wait "$child" 2>/dev/null
    # Strip bearer launch URLs before any durable failure output is mirrored.
    redact_launch_urls_in_output
    # Mirror the captured output into the watchdog log: with plain redirection
    # (see the launch site) the attempt log is the only place the failure was
    # written, and the watchdog log is where an operator looks first.
    sed 's/^/[instance] /' "$ATTEMPT_LOG" 2>/dev/null

    if grep -q 'EADDRINUSE' "$ATTEMPT_LOG" 2>/dev/null; then
      if grep 'EADDRINUSE' "$ATTEMPT_LOG" | grep -qE "[:.]$PORT([^0-9]|$)"; then
        # The supervised port was still held (a leftover process, a slow exit)
        # — an operational race, not a code regression. The watchdog owns this
        # port, so free it and retry WITHOUT counting toward rollback or
        # give-up. Bounded: once freeing stops winning the port back, the owner
        # is outside this watchdog's reach and retrying is a hot spin.
        port_races=$((port_races + 1))
        if [ "$port_races" -le 5 ]; then
          echo "[watchdog] boot hit EADDRINUSE on :$PORT — freeing the port and retrying (not a code failure, attempt $port_races/5)"
          free_port
          continue
        fi
        echo "[watchdog] :$PORT is still held after 5 free attempts — counting this as a boot failure"
      else
        # EADDRINUSE on a port this watchdog does not own: the start command
        # targets somewhere else, and freeing :$PORT cannot release it. The
        # unconditional retry this replaces never counted the attempt, so a
        # start command aimed at an occupied foreign port respawned the
        # instance in a tight loop with no backoff and no give-up.
        echo "[watchdog] boot hit EADDRINUSE on a port other than the supervised :$PORT — the --start command targets a port this watchdog does not own; freeing :$PORT cannot fix that"
        reset_done=1
      fi
    fi

    failures=$((failures + 1))
    echo "[watchdog] instance failed to come up (failure #$failures)"
    cutover_event_required attempt-failed "$CUTOVER_ROLE" "$current_attempt" "readiness not proven within ${BOOT_TIMEOUT}s"

    # The instance came up on a port this watchdog does not own: a start-command
    # argument, not a code regression. Resetting the checkout cannot change a
    # command line, so mark the rollback spent (same escape hatch as a failure
    # whose subject lives outside the repository) and keep counting toward the
    # crash page, which is what makes the misconfiguration visible.
    if [ -n "$bound" ] && ! printf '%s\n' "$bound" | grep -qx "$PORT"; then
      echo "[watchdog] instance bound :$(printf '%s' "$bound" | paste -sd, -) but supervision owns :$PORT — the --start command does not bind the supervised port; a repository rollback cannot fix that"
      reset_done=1
    fi

    # A launch cutover recovers the complete previous spec or waits, exactly as
    # approved before the stop. It never falls through to the ordinary
    # repository/composition reset machinery: neither can repair a command,
    # home, credential repo, host root, or profile change as one unit.
    if [ -n "$CUTOVER_ID" ] && [ "$failures" -ge "$TARGET_FAILURE_LIMIT" ]; then
      if [ "$CUTOVER_ROLE" = "target" ] && [ "$CUTOVER_POLICY" = "restore-previous" ] \
        && [ -n "$PREVIOUS_START" ] && [ -n "$PREVIOUS_HOME" ] && [ -n "$PREVIOUS_REPO" ] \
        && [ -n "$PREVIOUS_HARNESS_ROOT" ]; then
        echo "[watchdog] target launch failed after $failures attempt(s) — restoring the approved previous launch specification"
        cutover_event_required restoring "target failed after $failures attempt(s); restoring previous spec"
        START_CMD="$PREVIOUS_START"
        DSH_ROOT="$PREVIOUS_HOME"
        REPO="$PREVIOUS_REPO"
        HARNESS_ROOT="$PREVIOUS_HARNESS_ROOT"
        PROFILE="${PREVIOUS_PROFILE:-web}"
        export DSH_HOME="$DSH_ROOT"
        CUTOVER_ROLE="previous"
        # Any earlier accepted handoff belonged to a rejected target process.
        # A protected restored process must hand off its own launch URL.
        browser_handoff_done=0
        browser_handoff_reported=0
        failures=0
        reset_done=1
        port_races=0
        continue
      fi
      echo "[watchdog] launch cutover cannot become ready — approved policy is ${CUTOVER_POLICY:-wait-for-user}; parking for user action"
      cutover_event_required awaiting-user "$CUTOVER_ROLE launch failed after $failures attempt(s)"
      printf '%s launch cutover waiting after %s failures\n' "$(date '+%F %T')" "$failures" > "$GIVE_UP_MARKER"
      WD_PORT="$PORT" WD_PID="$$" node -e "$(page_script)" &
      page_pid=$!
      wait "$page_pid"
      page_pid=''
      continue
    fi

    if [ -z "$CUTOVER_ID" ] && [ "$failures" -ge 2 ] && [ "$reset_done" -eq 0 ]; then
      sha=$(rollback_sha)
      if [ -z "$sha" ]; then
        echo "[watchdog] no guard credential/checkpoint recorded; cannot roll back"
      elif failure_subject_outside_repo; then
        # The failure lives outside the checkout (profile overlay, installed
        # plugin, environment) — reverting the repository cannot fix it. But
        # the COMPOSITION can be rolled back: if a healthy-boot snapshot of
        # the profile inputs exists and differs from the live one, restore it
        # (unmounting the newest plugin change) and retry with a clean count.
        if [ "$comp_restore_done" -eq 0 ] && restore_composition; then
          comp_restore_done=1
          comp_restored=1
          failures=0
          continue
        fi
        echo "[watchdog] boot failure originates outside $REPO — repository rollback cannot fix it; leaving the checkout untouched"
        reset_done=1
      else
        if rollback_to "$sha"; then
          reset_done=1
          failures=0
          continue
        fi
        # The target already is HEAD: the reset was skipped, so keep counting
        # toward give-up — retrying a boot that cannot change is pointless.
        reset_done=1
      fi
    fi

    if [ "$failures" -ge 4 ]; then
      echo "[watchdog] giving up after $failures consecutive failures"
      printf '%s giving up after %s failures\n' "$(date '+%F %T')" "$failures" > "$GIVE_UP_MARKER"
      echo "[watchdog] serving crash page on :$PORT — click 重试 or send SIGUSR1 to $$"
      WD_PORT="$PORT" WD_PID="$$" node -e "$(page_script)" &
      page_pid=$!
      wait "$page_pid"
      page_pid=''
      continue
    fi

    sleep $((failures * 5))
    continue
  fi

  # Instance is up.
  echo "[watchdog] instance ready on :$PORT ($readiness_detail) — instance output: $ATTEMPT_LOG"
  if [ "$comp_restored" = "1" ]; then
    # The boot only succeeded because the composition was rolled back — the
    # recovery (newest plugin change unmounted) must be reported, not silent.
    guard_cmd record-composition-recovery --state-dir "$STATE_DIR" --detail "$comp_restore_detail"
    comp_restored=0
  fi

  # Intentional restart: run the guard canary (credential fresh + HEAD match).
  if [ -f "$RESTART_MARKER" ]; then
    if guard_verify; then
      echo "[watchdog] canary PASS — clearing restart marker"
      cutover_event_required canary pass
      if [ -n "$CUTOVER_ID" ]; then
        rm -f "$RESTART_MARKER"
        cutover_event_required ready "$CUTOVER_ROLE"
        CUTOVER_ID=''
      fi
      rm -f "$RESTART_MARKER"
    else
      if [ -n "$CUTOVER_ID" ]; then
        echo "[watchdog] canary FAIL during launch cutover"
        cutover_event_required canary fail "credential/head verification failed"
        if [ "$CUTOVER_ROLE" = "target" ] && [ "$CUTOVER_POLICY" = "restore-previous" ] \
          && [ -n "$PREVIOUS_START" ] && [ -n "$PREVIOUS_HOME" ] && [ -n "$PREVIOUS_REPO" ] \
          && [ -n "$PREVIOUS_HARNESS_ROOT" ]; then
          kill_tree "$child" TERM
          wait "$child" 2>/dev/null || true
          cutover_event_required restoring "target became ready but canary failed; restoring previous spec"
          START_CMD="$PREVIOUS_START"
          DSH_ROOT="$PREVIOUS_HOME"
          REPO="$PREVIOUS_REPO"
          HARNESS_ROOT="$PREVIOUS_HARNESS_ROOT"
          PROFILE="${PREVIOUS_PROFILE:-web}"
          export DSH_HOME="$DSH_ROOT"
          CUTOVER_ROLE="previous"
          browser_handoff_done=0
          browser_handoff_reported=0
          failures=0
          reset_done=1
          continue
        fi
        if [ "$CUTOVER_ROLE" = "previous" ]; then
          # The previous service is restored and ready; a credential tied to a
          # different target repo may legitimately fail. Preserve that fact in
          # the receipt, release the report, and leave the recovered service up.
          rm -f "$RESTART_MARKER"
          cutover_event_required ready previous
          CUTOVER_ID=''
        else
          kill_tree "$child" TERM
          wait "$child" 2>/dev/null || true
          cutover_event_required awaiting-user "target canary failed"
          printf '%s launch cutover waiting after canary failure\n' "$(date '+%F %T')" > "$GIVE_UP_MARKER"
          WD_PORT="$PORT" WD_PID="$$" node -e "$(page_script)" &
          page_pid=$!
          wait "$page_pid"
          page_pid=''
          continue
        fi
      else
      echo "[watchdog] canary FAIL — rolling back to last known-good"
      sha=$(rollback_sha)
      if [ -n "$sha" ]; then rollback_to "$sha" || true; fi
      rm -f "$RESTART_MARKER"
      failures=0
      reset_done=0
      continue
      fi
    fi
  else
    # Unplanned exit (crash, or a stop outside the guard): leave a record the
    # plugin reports on this boot — crash recovery must not be silent. Only
    # when the deployment has come up before (stamp snapshotted at the loop
    # top); the record semantics (pending protection, atomic write) live in
    # the guard CLI, where they typecheck and unit-test.
    if [ "$had_boot_stamp" = "1" ]; then
      guard_cmd record-unexpected-exit --state-dir "$STATE_DIR"
    elif [ "${WD_ADOPTION:-0}" = "1" ]; then
      # Adoption takeover — the first restart this deployment ever saw (the
      # CLI detected the previous owner at supervise time; probing here would
      # race the owner's exit). The session that established supervision
      # promised a verification report; this record wakes it after the bounce.
      # A first-EVER boot (WD_ADOPTION=0) reports nothing.
      guard_cmd record-adoption --state-dir "$STATE_DIR" --initiator "${WD_INITIATOR:-}"
    fi
  fi

  # Only a fully ready + canary-settled boot becomes the deployment rollback
  # target. Stamping before the cutover canary once made a rejected target the
  # very revision ordinary rollback preferred.
  stamp_last_good_boot
  snapshot_composition

  failures=0
  reset_done=0
  port_races=0
  # Watch the instance with a poll loop rather than a bare wait: the ownership
  # claim needs the same self-heal while the instance is healthy (the state
  # dir can be cleaned underneath a live watchdog at any time — that is how a
  # second supervisor once got spawned and both fought over the port).
  while kill -0 "$child" 2>/dev/null; do
    if [ "$SUPERVISE" = "1" ]; then
      if [ ! -f "$PIDFILE" ]; then (set -C; echo $$ > "$PIDFILE") 2>/dev/null || true; fi
      pidowner=$(cat "$PIDFILE" 2>/dev/null)
      if [ -n "$pidowner" ] && [ "$pidowner" != "$$" ] && kill -0 "$pidowner" 2>/dev/null; then
        echo "[watchdog] pidfile now owned by live pid $pidowner — yielding (instance left running for the new owner)"
        yielded=1
        exit 75
      fi
    fi
    sleep 2
  done
  wait "$child"

  # Explicit stop: exit the watchdog without respawn.
  if [ -f "$STOP_MARKER" ]; then
    echo "[watchdog] stop marker present — exiting"
    rm -f "$STOP_MARKER" "$PIDFILE"
    exit 0
  fi

  sleep 3
  if transport_up; then
    free_port
  fi
done
