# Agent Note: ankh-guard transactional launch-configuration cutover

Status: implemented

English | [中文](2026-09-01-ankh-guard-launch-cutover.zh.md)

## Problem

The original watchdog protocol assumed that a restart preserved its launch command. `schedule-exit` stopped the child and the already-running watchdog respawned the command it had captured in `WD_START`. That assumption breaks across a host upgrade that changes the command, dsh home, credential repository, host root, or profile. The credential/rollback repository can be a plugin migration worktree while preflight and the child use a separate harness checkout, so one overloaded `repo` field is not a complete launch specification. It also breaks when the new host protects its root: a naked HTTP 401 proves a listener exists but not that the application is usable, and a launch URL printed by a candidate process cannot authenticate the different final process.

Changing one repository or accepting any HTTP response as healthy would make the failure silent. The old host must stay available until a successor supervisor exists; recovery must restore one coherent launch configuration; authentication and browser handoff must be proved for the final child; and the agent that was interrupted must not wake before those proofs and the canary finish.

## Decision

ankh-guard has a generic launch cutover protocol, independent of any host version or query-parameter name.

- `LaunchSpec` is the complete launch unit: command, port, dsh home, credential/rollback repository, harness root, and profile. Credential checks and repository rollback use `credentialRepo`; composition preflight and the child `DSH_HARNESS` use `harnessRoot`. `launch-spec.json` stores either one stable active spec or a cutover containing previous, target, and the atomically selected side. It is mode 0600 because commands may contain sensitive environment values.
- `configure-launch --if-absent` initializes that state without overwriting a previous cutover decision. Initialization requires an explicit host root (flag or `DSH_HARNESS`). A legacy `instance-launch.json` records only command and port, so `reconfigure` refuses until an operator initializes the real previous home, credential repo, harness root, and profile; it never backfills previous from the target `--repo`. The launchd and systemd installers persist both repository roles, then start `supervise --foreground` from the durable selected spec instead of pinning installer-time flags forever.
- `reconfigure` requires a target command and an explicit pre-stop recovery policy: `restore-previous` or `wait-for-user`. It runs the credential and composition gates, writes the credential-free receipt, selects target, then starts a replacement watchdog.
- The replacement watchdog atomically replaces `watchdog.pid` while the old host still serves. That pidfile rename is the supervisor handoff commit point. After the configured grace interval the replacement watchdog itself stops the old child and starts the final target, so the short-lived CLI caller is not part of the durability chain. A yielding old watchdog leaves its child alive and exits nonzero so an outer launchd/systemd launcher stays engaged behind the successor.
- A foreground launchd/systemd launcher that finds a live watchdog waits rather than exiting. When that owner exits, the waiter rereads both `launch-spec.json` and the cutover receipt before it spawns. Therefore a target that failed and restored previous while the waiter was blocked cannot be resurrected from the waiter's stale pre-wait target snapshot; an `awaiting-user` receipt remains parked.
- Online port changes are refused. They require a second supervised authority plus an external traffic cutover; pretending one pidfile transaction can make two authorities atomic would be false continuity.

## Readiness and authentication contract

Readiness has two layers. Any HTTP status other than transport failure is `transport-up`; only a public root HTTP 200 is directly ready. Otherwise the watchdog reads the current attempt's output and accepts the first HTTP launch URL whose authority exactly matches the supervised loopback authority, whose path is `/`, and whose query is nonempty. No `token` name or host release is hard-coded.

The watchdog keeps that final-process URL only in memory, overwrites it in the mode-0600 attempt log with an equal-length redaction, and never includes it in an event or receipt. A temporary mode-0600 cookie jar must observe launch URL HTTP 303 and then authenticated root HTTP 200. A cutover defaults to one browser URL handoff after the jar proof; `--browser-handoff off` is explicit. Only after readiness, browser handoff when required, and the guard canary does the receipt become terminal and session wake-up release.

## Durable receipt and recovery

`launch-cutover.json` is the operator/agent receipt. It contains redacted command hashes and the non-secret spec fields, previous/driver/replacement supervisor PIDs, previous/target/restored child PIDs, attempt history, transport and authentication statuses, browser handoff, canary, and recovery result. `launch-status` prints the redacted state and receipt, never the commands.

Target boot/readiness or canary failure follows only the policy recorded before the stop. `restore-previous` changes command, home, credential repo, harness root, and profile together, exports the previous `DSH_HARNESS`, boots that previous spec, and records `restored`; `wait-for-user` serves/parks at the crash page and records `awaiting-user`. Cutovers never fall through to repository or profile-composition rollback. The restart report is written before the receipt becomes terminal, and both followup and interrupted-session resume remain gated until that terminal rename.

## Alternatives considered

- **Mutate `WD_START` and use `schedule-exit`.** Rejected because `WD_START` belongs to the already-running watchdog's memory; changing a file or the next launcher invocation cannot reconfigure that process, and stopping the child first creates an outage before a successor owns supervision.
- **Probe a candidate and reuse its launch URL for the final restart.** Rejected because launch credentials can be process- and authority-bound. The only meaningful proof is extracted from and exchanged against the final child.
- **Treat 401 or any HTTP response as healthy.** Rejected because this proves only TCP/HTTP transport. It would run the canary and wake sessions while users still see an unauthenticated application.
- **Recover by resetting the target repository.** Rejected because a launch change can span command, home, credential repo, harness root, and profile, and may not be caused by repository contents at all. Recovery is the previous complete spec or an explicit wait.
- **Let the `reconfigure` caller schedule the old-child exit.** Rejected because the caller is hosted inside the process being replaced and may disappear after the supervisor handoff. The committed replacement watchdog owns every irreversible step.

## Consequences

- Same-command restarts retain the smaller `schedule-exit` path; launch changes have a distinct transaction and explicit recovery decision.
- Hosts with protected roots must print a same-authority launch URL before the boot timeout. The URL's parameter vocabulary remains host-owned, but the 303 and authenticated-200 exchange is the interoperability contract.
- Browser handoff success means the platform opener accepted the URL; the watchdog cannot inspect a user's browser cookie store. The temporary jar independently proves the authentication flow first.
- Full launch commands are durable for recovery but access-restricted; receipts and CLI status are safe summaries. A SIGKILL can still prevent graceful interrupted-session snapshotting, but it does not make a nonterminal cutover look ready.
- Unit tests pin atomic state/receipt transitions, independent repository roles, refusal to invent a legacy previous spec, and full-spec restoration. Integration tests pin supervisor-before-child handoff, post-wait durable-state refresh (including target failure and previous restoration), protected-root authentication, launch-URL redaction, and the terminal wake gate.
