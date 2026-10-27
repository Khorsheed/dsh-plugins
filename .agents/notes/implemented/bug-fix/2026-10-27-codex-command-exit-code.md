# Agent Note: a finished Codex command always carries its result

Status: implemented

## Problem

In a Codex member (bcc89add…, 10-27), a Blender command crashed: Codex's rollout records exit code 139 and an empty output. The mirror showed it as 「（工具调用被中断，未能记录返回结果）」, which reads as a mirror loss rather than a failed command. Both folds, the exec stream (`command_execution`: `aggregated_output`, `exit_code`, `status`) and the app-server live driver (`commandExecution`: `aggregatedOutput`, `exitCode`, `status`), kept only a non-empty output as the result. They never read the exit code, so every silent failure, and every silent success, became "no result". Five commands in that one round were affected.

## Decision

`commandOutcome(output, exitCode, status)` in `codex-cli-provider.ts` is shared by both folds. A finished command (one with an exit code, or a `completed`/`failed` status) always yields a result: its output, or 「（无输出）」. A non-zero exit code is appended (「（退出码 139，无输出）」) and the result is marked failed, so the tool/result carries `isError`. A command still running yields no result, and the fold keeps waiting for it.

## Alternatives considered

- **Show the bare placeholder but mark it failed.** The user still could not tell a crash from a mirror loss. The exit code is the fact they need.

## Consequences

Failed commands read as failed, with their exit code. The 「被中断」 placeholder is left only for calls that truly never finished. Logs written before this change keep the placeholder.

## Testing

`local-agent-codex` (258): unit specs for crash, failure with output, silent success and still-running, plus an exec-stream spec that folds `exit_code: 139` with empty output into a failed result.
