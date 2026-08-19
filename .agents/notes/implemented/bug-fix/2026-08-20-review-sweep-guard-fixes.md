# Agent Note: review-sweep fixes — resume decoupling, one state dir, atomic writes

Status: implemented

English | [中文](2026-08-20-review-sweep-guard-fixes.zh.md)

## Problem

A full code review of ankh-guard (fresh-machine restart testing era) surfaced four defects worth shipping fixes for, plus a tail of items consciously not fixed (see Consequences):

1. **Session resume was silently coupled to the report mode** (`src/index.ts`): the entire resume half — SIGTERM snapshot, resume pass, continue injection — lived inside `if (reportMode === 'followup')`, so `reportRestartContext: 'step'|'off'` disabled interrupted-session recovery (default-on) with no error or warning.
2. **Two derivations of the state location** (`src/cli.ts` + `scripts/dsh-watchdog.sh`): the CLI's `schedule-exit`/`supervise` derived a home (`DSH_HOME ?? dirname(stateDir)`) and re-appended `state`, while the plugin read `stateDir` directly. Any `stateDir` that is not literally `$DSH_HOME/state` (explicit `--state-dir`, or the `<cwd>/.dsh-guard-state` fallback) split markers, the pidfile, and the restart record across two directories — report and resume both silently lost.
3. **`currentHead` leaked git's stderr** (`src/git.ts`): `execFileSync` without `stdio` forwards stderr to the parent, so every gate check outside a git repo printed `fatal: not a git repository…` into the host log — an expected state must stay silent.
4. **Non-atomic durable writes** (`src/state.ts`, `src/restart-context.ts`): a crash mid-`writeFileSync` could truncate the state file, and a malformed state file throws in `loadState` — the guard's own state taking the host's boot invariant down. The audit array was also the only field cast without a predicate.

## Decision

- The resume half is gated by `resumeInterrupted` alone, the report half by `reportMode` alone; the `agent/created` listener registers when either is on. Two latent edge cases in `deliver()` fixed along the way: the pending-continue entry is deleted only after a successful injection (a throwing `followup` keeps the session eligible), and a record with nothing to report (no `exitAt`/`error` yet) no longer swallows the session's continue.
- One state directory everywhere: `schedule-exit` writes `restart-requested.json` / `last-restart.json` / its log into `stateDir` directly; `supervise` reads the pidfile from `stateDir` and passes `WD_STATE_DIR=stateDir` to the watchdog, which resolves `STATE_DIR="${WD_STATE_DIR:-$WD_HOME/state}"` and uses it for every marker, the pidfile, the attempt log, the boot stamp, and its `--state-dir` guard calls.
- `currentHead` passes `stdio: 'pipe'`, matching its sibling helpers.
- `saveState`, `acknowledgeRestartRecord`, and `writeInterruptedSnapshot` write tmp-file-then-rename; `loadState` validates audit entries with `isAuditEntry` like the credential/checkpoint predicates.

## Alternatives considered

- **Reject incompatible config combinations at apply time** (throw when `resumeInterrupted` meets a non-followup mode) — the combination is legitimate (report off, recovery on), so the coupling was the bug, not the config.
- **Keep deriving the watchdog's state dir from WD_HOME** — any derivation duplicates knowledge the CLI already has; passing the resolved directory down removes the class of drift instead of narrowing it.

## Consequences

- Regression coverage: `reportRestartContext: 'off'` still resumes and continues interrupted sessions; `schedule-exit` with a state dir that is not `<home>/state` lands marker and result in that dir.
- Follow-up review round (same day, second pass): `supervise` no longer derives the instance's home from the state dir — without `DSH_HOME` it requires `--home` and refuses loudly (a guessed home boots the instance on the wrong profiles/credentials); `buildResumeOptions` warns when `agentDefaultModel` resolves but yields no complete provider/model (the silent-drift止血; the real fix — peerDep + `import type` declaration merging — stays with the refactor batch); the preflight drift tripwire defaults its home probe to `~/.dsh` so it actually runs on a deployment machine instead of skipping silently (it passes against rc.8); test ports come from `freePort()` (bind-0) instead of `20000 + random`.
- Still deferred by conscious call, not oversight: the structural-type/`as` cleanups beyond the warn above and `checkPort`/`resolveHarnessRoot` duplication (no behavior change; refactor candidates), the `~/code/deepseek-harness` default (repo-wide convention, overridable via `DSH_HARNESS`/`--repo`), `DSH_PREFLIGHT_COMMAND` as a full gate bypass (a test hook; the guard is not a security boundary against an operator who can already set the instance's environment — documented in the README's trust notes), and the single-file test-suite split (real coverage, slow but truthful).
