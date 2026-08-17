# Agent Note: 空输出静默判成功与 codex 格式漂移零预警修复

Status: implemented

English | [中文](2026-08-17-empty-output-error-and-codex-drift-warn.zh.md)

## Problem

Two silent-failure gaps in the one-shot CLI delegation providers (kimi/codex/claude), surfaced by review and confirmed against the official provider behavior:

1. **Empty output settles as "success"** — the providers' attempt branches returned `{ output: collectOutput(), stopReason: 'completed' }` whenever the CLI exited 0, without checking whether any output was actually parsed. The upstream `settleRunResult` (harness `out-of-process.ts`) does not re-check output emptiness, so "exit 0 + no parsed answer" reported a successful delegation with empty content. This is not limited to schema drift: codex internal errors that exit normally, or truncated stdout, all produce it. The official `subagent-codex` provider explicitly throws `'Codex completed without a final answer'` when the output is empty (`run.ts:199-202`).

2. **Codex event-schema drift is invisible** — `parseCodexJsonStream` skips malformed lines with `catch { continue }`, and the `codex exec --json` event field names (`thread_id`, `item.completed`, `input_tokens`) are snake_case while the official JSON Schema exports are all camelCase (`threadId`, `turnId`) — the event stream has no contract backing. A schema change in a codex upgrade would silently produce empty parses, which gap 1 then reported as success.

## Decision

1. **Empty output on exit 0 settles 'error'** in all three providers: the exit-0 branch calls `collectOutput()` and throws when it is empty, so `settleRunResult` flattens the throw to `stopReason: 'error'`. The abort path is untouched — it settles 'aborted' through `abortBranch` before the exit-0 branch is ever reached. The `turn/end` error reason remains the generic diagnostic; the real error text (e.g. "exited 0 but produced no answer") settles through `run.result` for the parent model.

2. **Codex zero-item-completed warn** — on a normally-exited (exit 0) stream, if `parseCodexJsonStream` parsed zero `item.completed` lines at all, the provider reports one `onError` warn naming the schema-drift suspicion ("parsed no codex events — check the codex --json event schema"), then throws the same empty-answer error. The warn fires once per run, never per line, and does not change settle semantics — the empty output already reports 'error' either way.

## Alternatives considered

- **Let the upstream seam check emptiness** — rejected: `settleRunResult` is official harness code, and the providers own the "what counts as output" decision (each parses a different wire format).
- **Silently return an empty 'completed' and let the parent notice** — rejected: matches the bug being fixed; the parent has no signal to distinguish "no content" from "success".
- **Warn per malformed line** — rejected: a drifted schema would spam the log on every line of every run; one warn per run is the signal that survives.

## Consequences

- A CLI that exits 0 without producing an answer now visibly fails the delegation (parent sees the error text) instead of silently succeeding.
- Codex schema drift is detectable in the logs the day it happens, without changing settle behavior.
- The generic `turn/end` error message for these cases is unchanged; the specific reason reaches the model through `run.result` (existing seam contract).
