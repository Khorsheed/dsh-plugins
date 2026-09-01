---
name: dsh-self-restart-guard
description: Use before ANY self-modification batch that may end in restarting the running dsh web instance (product code, client plugins, tsconfig/bundle registrations, dependencies). Enforces the green-build credential gate, the pre-batch checkpoint, and the post-restart canary so a broken self-change rolls back instead of taking the instance down. Also consult it to query the guard state or the recorded pitfalls before deployment.
---

# Self-Restart Guard: atomic self-modification protocol

Self-modification ends in a restart of the running instance — the process that hosts the conversation. A broken change therefore kills the session. This protocol makes every restart conditional on proof and recoverable on failure. The guard is the `@khorsheed/dsh-ankh-guard` package installed into the active profile (CLI + `selfRestartGuard` service, state file at `$DSH_HOME/state/self-restart-guard.json`).

Invoke the CLI through the installed package (resolve once, then reuse):

```sh
GUARD="node $(ls "$DSH_HOME"/profiles/*/node_modules/@khorsheed/dsh-ankh-guard/lib/cli.js 2>/dev/null | head -1)"
```

If a profile `.bin` directory is on PATH, `dsh-ankh-guard <verb>` works too.

## Resolve your own environment first (do NOT assume defaults)

Never restart "the instance" from a recipe — restart the one you are actually in. Resolve these three from your own context, in this order:

1. **State dir**: `$DSH_HOME/state` (already in your environment). If `DSH_HOME` is unset, the deployment is custom — ask the user rather than guessing.
2. **Start command and repo**: read `$DSH_HOME/state/instance-launch.json` once the plugin has booted there — the plugin records the instance's exact launch command (cwd, env, full argv incl. `--import` chains) at every boot. `restart`/`supervise` consume it automatically, so `--start` is usually unnecessary. Only construct a start command yourself when the record does not exist (plugin not loaded yet).
3. **Port**: the GUI address in your context (e.g. the system prompt's URL), else `lsof -a -p <instance-pid> -iTCP -sTCP:LISTEN -P`. The `restart` verb also defaults `--port` from the launch record.

Run `$GUARD check-env --state-dir "$DSH_HOME/state" --repo <repo>` for a one-shot readout of all of the above plus sandbox status and watchdog presence.

## The protocol (every batch)

1. **Checkpoint** — before touching anything, snapshot the working tree of the repo you are about to change:

```sh
$GUARD checkpoint --message "before <batch-name>" --repo <repo> --state-dir "$DSH_HOME/state"
```

2. **Modify** — make the change; register every surface the change needs (package `files`, `dsh.bundle.patch`, identity triangle, dependencies). Missing registrations are the single most common failure class — an unregistered package is invisible to every gate.

3. **Prove green** — run the build and tests that cover the change, then record the green-build credential bound to the repo's HEAD (freshness window 10 minutes):

```sh
$GUARD record build --command "<the command that went green>" --repo <repo> --state-dir "$DSH_HOME/state"
$GUARD verify --repo <repo> --state-dir "$DSH_HOME/state"
```

4. **Preflight** — the composition dry-run gate; a FAIL blocks the restart and must never be bypassed:

```sh
$GUARD preflight --profile web
```

5. **Restart or launch cutover** — the path depends on supervision and whether the complete launch specification changes:
   - **No watchdog yet** (e.g. right after installing the plugin): drive it with the `restart` verb — it owns stop → start → canary in a detached driver and self-detaches from the dying instance. `--start` defaults to the launch record when one exists.
   - **Watchdog-supervised, same command, home, credential repo, harness root, and profile**: `schedule-exit --port <port> --delay-ms 5000 --repo <credential-repo> --harness-root <host-root>`. It re-verifies the credential against the repo's CURRENT HEAD, runs composition preflight against the independent host root, exits the instance after the delay (so the current turn finishes), and the watchdog respawns + canaries automatically. Do NOT use bare `restart` against a supervised instance — it fights the supervisor. **Never pass `--initiator` by hand**: it defaults to `$DSH_SESSION_ID`, which the shell environment already sets to THIS session's id — that is what routes the post-restart wake-up report back to you. An invented value sends the report to a session that does not exist and you are never woken (a branch name is not a session id).
   - **Watchdog-supervised, command, home, credential repo, harness root, or profile changes**: first ensure `launch-status` shows a complete durable previous spec. If it does not, explicitly initialize the real current values with `configure-launch`; never infer previous from the target repo or legacy command record. Then use `reconfigure --start "<complete target command>" --repo <target-credential-repo> --harness-root <target-host-root> --on-failure <policy> --browser-handoff required`. Before running it, obtain the user's explicit recovery choice: `restore-previous` restores the entire previous launch specification; `wait-for-user` parks without resetting a repository. `reconfigure` atomically transfers the pidfile to a replacement watchdog before the old host is stopped. Online port changes are refused; deploy a separately supervised authority and cut traffic over instead.
   - Never hand-roll `sleep; kill; nohup start` scripts — they die with the instance (teardown reaps managed processes).

6. **Verify after** — the port must listen again and the canary must PASS (`$DSH_HOME/state/restart.log` for the verb path, `watchdog.log` for the supervised path). For `reconfigure`, wait for `launch-status` to show a terminal receipt, read `$DSH_HOME/state/launch-cutover.json`, and report its supervisor/child PIDs, redacted launch summaries, authentication handoff, retries, canary, and recovery outcome. On repeated ordinary boot failure the watchdog rolls the checkout back to the last known-good revision; a cutover follows only its pre-approved full-spec recovery policy.

## Querying state

```sh
$GUARD status --state-dir "$DSH_HOME/state"   # credentials, checkpoints, restart records
$GUARD launch-status --state-dir "$DSH_HOME/state"   # redacted selected spec + durable cutover receipt
$GUARD canary --port <port> --state-dir "$DSH_HOME/state" --repo <repo>
```

## Pitfalls this protocol exists for

- **Credential/HEAD mismatch**: `schedule-exit`/`restart` refuse when the credential's revision ≠ current HEAD — rebuild and re-record after every commit. Record with `--state-dir` pointing at the SAME state the restart reads (`$DSH_HOME/state`); a record without it lands in a stray `<cwd>/.dsh-guard-state` and the gate will not see it.
- **Sandboxed sessions**: restart verbs refuse in a sandboxed turn (a detached driver would be reaped). Escalate through your host's per-command approval, or the user runs `/permission danger-full-access` in the session — settings pages only affect NEW sessions.
- **Preflight FAIL is information, not friction**: it has caught unbootable profile patches and duplicate loader entry ids before they could take prod down. Fix the composition; never bypass.
- **Profile `link:`/`file:` deps**: after rebuilding a plugin, refresh the profile install (`dsh plugin --profile web add <path-or-tarball>`) before restarting — a restart serves whatever the profile's `node_modules` currently contains.
- **401 is transport, not readiness**: a protected final process must announce a same-authority launch URL; the watchdog proves URL → 303 → cookie-authenticated `/` → 200 with a temporary jar. With `--browser-handoff required` it opens that final URL once before canary/session wake. Never copy a candidate instance's URL into the final restart, and never persist or print bearer URLs in a report.
