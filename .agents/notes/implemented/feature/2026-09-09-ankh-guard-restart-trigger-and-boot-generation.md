# Agent Note: ankh-guard in-process restart trigger and boot-generation refresh

Status: implemented

English | [中文](2026-09-09-ankh-guard-restart-trigger-and-boot-generation.zh.md)

## Problem

Two gaps blocked UI-grade restart flows (the mode switcher's profile switching). First, the only restart trigger was the CLI: the in-process `selfRestartGuard` service exposed verification and recording but no way to initiate a restart, so a settings-page button had no channel. Second, the browser handoff (long-poll → overlay → reload) only existed for reconfigure cutovers, because its readiness was computed from the cutover receipt; after an ordinary restart or a watchdog crash respawn, open tabs silently reconnected over WebSocket and never picked up a changed client bundle.

A trigger seam also had to avoid two known traps. Under a live watchdog the `restart` verb with an explicit `--start` is not refused — it proceeds into exactly the double-start race the fallback refusal guards against, because the watchdog respawns its baked-in command while the new command binds the same port. And a hand-filled `initiator` had twice routed restart reports to nonexistent sessions.

## Decision

**`requestRestart({ start, profile, initiator })` on `ctx.selfRestartGuard`.** Validation is fail-fast: all three fields are required, and `initiator` can never default, because the UI caller knows the real session id. The port comes from the instance launch record, never the caller. Dispatch is supervision-aware: no live watchdog → the `restart` verb's self-contained stop→start→canary; supervised → `reconfigure` (transactional cutover with `--on-failure restore-previous`), the only path that changes the launch command without fighting the watchdog's respawn. The trigger shells out to this package's own CLI (source/built split resolved from the module file path), so the full gate chain — cutover conflict, credential, sandbox, composition preflight, pending marker, restart lock — keeps exactly one behavior source and the detached driver keeps its proven lifetime rules. Refusals record a machine-readable verdict (`CliRefusal`, first refusal wins) which the CLI writes to a caller-named verdict file (`DSH_ANKH_VERDICT_FILE`, scrubbed from every long-lived child the caller spawns); the service maps exit code plus verdict to `{ accepted, stage, reason }`. The terminal's human stderr text and exit codes are byte-identical to before. A refusal never stops the instance.

**Boot-generation browser channel.** Ordinary restarts write no cutover receipt, so the handoff handler gained a second readiness signal: the serving process's own pid + start token is its boot id, carried on every 200 poll response. A tab stores the last-seen id in sessionStorage and sends it as `knownBootId`; a stale id with no active cutover answers `ready/reload` — the process the tab knew is gone. The reload is one-shot because the tab learns the successor's id from the ready response before reloading; no capability registration or ack is needed (those exist for the cutover's two-listener window and token handout). An active cutover always wins: during one, the old tab's known id is already stale, and answering on the generation branch would race the receipt protocol's pacing. Unavailable process identity (ps blocked) degrades to the pre-generation flow, identical to an old client. The client also raises a neutral "connection lost" overlay after ~5 s of sustained failure — time-based, not retry-count-based, because the exponential backoff already stretches retries to seconds and a count would flash on transient blips; the copy makes no auto-recovery promise, since a bare exit may never return. Supervised mode switches keep using the receipt handoff; the generation channel covers unsupervised restarts and crash respawns, where a changed client bundle is precisely what a silent WebSocket reconnect cannot fetch.

## Alternatives considered

**Extract the caller-side gate sequences into a shared module both the CLI and the service import.** Rejected: the restart/reconfigure arms had just been hardened by three independent efforts (transactional cutover, execution-bound preflight, restart evidence), so moving that code buys purer layering at the price of churn and merge risk on the most safety-critical paths in the package.

**Import the CLI module into the plugin runtime and drive `runCli` in-process.** Tried first and reverted after it broke the built CLI: a runtime import edge from the plugin graph makes tsdown chunk cli.ts out of `lib/cli.js`, so the entry's `isDirectInvocation` guard (and `cliInvocation`'s self path) resolves against a chunk URL and every `node lib/cli.js …` call silently exits 0 doing nothing — two integration lanes caught it (exit-0 control writers leaving no marker; a watchdog whose guard calls all no-opped giving up and parking the crash page). The subprocess design has no such edge; the module doc of `restart-request.ts` carries the warning, and only erased type-only imports remain.

**Refuse `restart` whenever a watchdog is live, even with explicit `--start`.** Not done here; the dispatch rule makes the seam always choose correctly instead, and hardening the CLI's explicit-flag path is a separate behavioral decision.

**Synthesize a cutover receipt for ordinary restarts to reuse the existing protocol.** Rejected again, now in code: receipt semantics (`awaiting-user`, target/restored ownership, recovery, launch-url issuance) are cutover-specific, and `cutoverBlocksWake()` would misread ordinary restarts as cutovers and suppress the follow-up injection.

**Cover only guard-initiated restarts with the generation channel.** Rejected: crash respawns also strand tabs on stale bundles, and the boot id cannot distinguish intent anyway — the signal is simply "the process you knew is gone".

## Consequences

- Old client bundles never send `knownBootId`, so the first restart after an upgrade does not auto-reload (pre-change behavior); later restarts do.
- A supervised `requestRestart` requires the durable launch spec (`configure-launch` / `supervise` state); without it the refusal names the missing prerequisite instead of half-acting.
- A crash loop reloads tabs on every respawn until the watchdog gives up and parks; the give-up path bounds it.
- The mode switcher (M1) consumes `requestRestart` and both refresh channels; nothing in this change requires host/harness modifications.
