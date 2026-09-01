# Agent Note: ankh-guard restart evidence and same-launch continuity

Status: implemented

English | [中文](2026-09-02-ankh-guard-restart-evidence.zh.md)

## Problem

The [transactional launch-cutover protocol](../feature/2026-09-01-ankh-guard-launch-cutover.md) made changed launch configurations recoverable, but the ordinary same-launch path still trusted procedure at three safety boundaries.

First, `record --command "..."` asserted that a build passed without executing it, and verification compared only the credential revision to HEAD. Staged, unstaged, or untracked inputs added after recording could therefore ride a still-valid credential. Second, `checkpoint` staged the whole tree immediately and made an empty commit even for a clean pure restart; a hook failure could leave the caller's index changed, while a successful innocent-looking command could sweep unrelated work into history. Third, `schedule-exit` warned about a missing watchdog but still scheduled the host kill, and caller flags could diverge from the durable active spec. A just-started detached supervisor also returned before its pidfile claim, creating a race in which an immediate safe restart was refused or, under the old warning behavior, scheduled without proven ownership.

The operational instructions compounded the cost: they required both a standalone preflight and a restart verb that runs the same preflight internally, treated checkpoint as mandatory for pure restarts, and did not distinguish the exit-agent PID in output. Untimestamped watchdog lines made a multi-process restart receipt harder to correlate.

## Decision

- CLI credential recording is execution-backed by default. `record <scope> --run -- PROGRAM ARG...` spawns the exact argv without an implicit shell, streams its output, clears any older credential before execution, and records only after exit 0 when HEAD is unchanged and the complete working tree remains clean. Shell composition is explicit (`--run -- sh -c '...'`). `--trust-command --command "..."` is a named seam only for an orchestrator that already observed the real result; the repository deployment driver uses that seam openly.
- Credential verification includes `git status --porcelain` with staged, unstaged, and untracked paths. CLI verify, canary, restart, reconfigure, schedule-exit, and the in-app service all fail closed when status is unavailable or dirty. The trusted synchronous service also refuses to record on a dirty checkout.
- A clean checkpoint records the existing HEAD and creates no empty commit. A dirty checkpoint refuses until `--include-dirty` explicitly approves the complete snapshot. The approved path commits through a temporary index, so hook/commit failure leaves the caller's staging area and HEAD untouched; success settles the real index to the new full-snapshot HEAD.
- `schedule-exit` hard-refuses without a live watchdog before preflight or marker creation. In stable durable state it derives port, credential repo, harness root, and profile from the active launch spec; explicit conflicts are rejected with `reconfigure` guidance, and the supervisor-sourced instance record must prove the same full command. The detached exit process is labelled `exit-agent pid`.
- Detached `supervise` waits up to five seconds for its spawned watchdog to claim the durable pidfile before returning success. This makes a successful supervise call a usable ownership barrier for an immediately following schedule.
- Pure restarts skip only the pre-edit checkpoint. They still require fresh execution-backed build/test evidence, a clean checkout, the restart verb's one internal composition preflight, live supervision for `schedule-exit`, and the post-boot canary. Standalone `preflight` remains a diagnostic rather than a mandatory duplicate. Watchdog lifecycle lines now carry ISO-like local timestamps.

## Alternatives considered

**Keep self-attested credentials and improve the skill wording.** Rejected because the enforcement point must observe the evidence. Procedure cannot distinguish a command that really exited zero from text claiming it did, and cannot prevent a second session from mutating the tree afterward.

**Automatically reuse a last-good boot as a build/test waiver for pure restarts.** Rejected because the healthy-boot stamp proves that a revision once listened, not that the current profile composition, generated artifacts, dependencies, or test scope are still the same. Pure restart is faster only by omitting a meaningless checkpoint.

**Let `schedule-exit` fall back to legacy caller flags even when a durable spec exists.** Rejected because that recreates the stale-target resurrection class the cutover protocol was built to close. Stable state is authoritative; a change uses `reconfigure`.

**Always commit dirty checkpoints.** Rejected because broad staging is a destructive policy decision and conflicts with repositories that require explicit-path staging. The complete snapshot remains available, but only through a loud reviewed option.

**Rotate watchdog logs in the child script.** Deferred: launchd/systemd and detached parents hold their redirected file descriptors open, so an in-child rename does not rotate those streams reliably. Timestamps ship now; descriptor-aware rotation belongs to the external supervisor/deployment layer.

## Consequences

- Existing automation that called bare `record` must choose an honest proof path. Tests use the explicit trusted-fixture seam; the production deployment driver names its external proof; ordinary agents use `--run`.
- A checkout modified after evidence cannot restart until it is committed or cleaned and the evidence is rerun. This intentionally removes the old rollback test path where dirty work survived until a failed boot: the healthy instance is now never stopped in that state.
- A first-install `schedule-exit` becomes a refusal instead of a warning. Operators establish supervision or use the detached single-shot `restart` loop.
- Tests cover exact argv and failure clearing, dirty-tree invalidation, default checkpoint refusal, temporary-index hook failure, stable-spec/instance-record conflicts, no-watchdog refusal, the supervise-claim barrier, and the real exit-agent/watchdog takeover.
