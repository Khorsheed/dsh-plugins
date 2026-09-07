# Agent Note: codex delegations carry --skip-git-repo-check

Status: implemented

## Problem

`codex exec` refuses to start when its working directory is not inside a Git repository:

```
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

It prints that line and exits before emitting a single `--json` stream event. The provider therefore has nothing to fold, nothing to attribute, and no stderr worth surfacing — the delegation surfaces to the caller as a bare `Error: subagent run failed`, with no indication that the cause was the working directory rather than credentials, the model, or the task.

The working directory is the **caller's** choice. Since the facade gained a `cwd` option, a delegation runs wherever the caller points it, and nothing about that path is required to be a repository. The failure was found by the web-eval pilot, whose orchestrator materializes each cell into `$DSH_HOME/state/eval/cells/<runId>/<missionId>/attempt-N/` — a plain directory tree it creates itself. Every codex cell failed identically, while dsh cells in the same run succeeded. It is not an evaluation-specific problem: any caller delegating into a scratch directory, a freshly created output directory, or any non-repository path hits the same wall, and the message it gets back names none of it.

Two non-fixes were measured before the flag was chosen. Codex's `projects.<path>.trust_level = "trusted"` config entry does not satisfy the check under `exec` — neither for the exact directory nor for a parent (verified against codex-cli 0.144.0, both forms still refused). And making the *parent* of the cells a repository does satisfy codex, but in an evaluation it lets a player run `git status` from its own cell and see — then read — every other player's answers. Cross-contamination is a worse defect than the one being fixed.

## Decision

`--skip-git-repo-check` rides every `codex exec` argv the one-shot provider builds — the fresh shape and the `resume` shape alike, positioned before the `resume` subcommand so codex's positional parsing is unaffected.

The check is codex's own guard for a human who has wandered into a stray directory interactively. A delegation has already been aimed at its workspace by the caller, so the guard can only ever reject work that was explicitly asked for. Skipping it restores the provider's contract: the delegation runs where the caller said.

**Sandboxing is untouched.** The `--sandbox` tier still rides its own flag and still decides what the process may write. The Git check is not a sandbox — it gates *starting*, not *permissions* — and conflating the two is the reading this note exists to prevent.

The live driver (`codex app-server`) does not take this flag and does not need it: the app-server wire carries the working directory per thread and has no equivalent guard.

## Testing

`tests/non-git-cwd.spec.ts` pins the flag onto both argv shapes and asserts it precedes `resume`, plus that `--sandbox` is still present — so a future edit cannot drop the flag, or "fix" this by loosening the sandbox instead. The three pre-existing argv assertions (one in `codex-cli-provider.spec.ts`, two in `member-bridge-injection.spec.ts`) were updated to the new argv. 112 tests pass in the package.

Verified against the real CLI: `codex exec --sandbox workspace-write --skip-git-repo-check --json` in a non-repository directory reaches `turn.completed`, where the same command without the flag exits on the refusal line.

## Alternatives considered

**Make the delegation cwd a Git repository.** Either `git init` per cell (the orchestrator creates those directories mid-run, so nothing outside it can win the race) or `git init` on their common parent (which is what the cross-contamination paragraph above rules out). Both also push a codex-specific requirement onto every caller, when only one of the four harnesses has it.

**Trust the directory through codex's own config.** The intended shape, and it was tried first: `-c 'projects."<path>".trust_level="trusted"'` for the exact directory and for its parent. Neither satisfies `exec` on codex-cli 0.144.0 — the refusal is unchanged. Even had it worked, it would need a config entry per cell, written before each spawn, which is a moving part where a constant flag will do.

**Surface the refusal instead of preventing it.** Parsing codex's stderr for this specific line and re-throwing something readable would turn an opaque failure into a clear one — but it would still be a failure, and the delegation would still not run. Worth doing on top as a general diagnostic (any pre-stream exit currently reads as `subagent run failed`); it is not a substitute for letting the delegation work.

## Consequences

Codex delegations now start in any directory the caller names, which is what every other provider in the family already did. The guard that was doing the refusing was never protecting the caller from anything — sandboxing, which is, is unchanged.

What remains unfixed is the diagnostic: a codex process that exits before its first stream event still reports `subagent run failed` with the reason only in stderr the caller never sees. This fix removes the most common instance of that class, not the class.
