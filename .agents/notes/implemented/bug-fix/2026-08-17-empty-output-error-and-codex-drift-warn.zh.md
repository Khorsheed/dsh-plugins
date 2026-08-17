# Agent Note: 空输出静默判成功与 codex 格式漂移零预警修复

Status: implemented

[English](2026-08-17-empty-output-error-and-codex-drift-warn.md) | 中文

## Problem

one-shot CLI 委派 provider（kimi/codex/claude）的两个静默失败缺口，由评审提出并经官方 provider 行为核实：

1. **空输出静默判"成功"**——provider 的 attempt 分支只要 CLI 退出码 0 就返回 `{ output: collectOutput(), stopReason: 'completed' }`，不检查是否真的解析出内容。上游 `settleRunResult`（harness `out-of-process.ts`）不复查 output 是否为空，于是"退出 0 + 没解析出内容"被报成成功委派但内容为空。这不限于格式漂移：codex 内部异常但正常退出、stdout 被截断都会触发。官方 `subagent-codex` provider 在输出为空时**明确**抛 `'Codex completed without a final answer'`（`run.ts:199-202`）。

2. **codex 事件格式漂移零预警**——`parseCodexJsonStream` 对 malformed 行 `catch { continue }` 静默跳过，且 `codex exec --json` 的事件字段名（`thread_id`、`item.completed`、`input_tokens`）是 snake_case，而官方 JSON Schema 导出全是 camelCase（`threadId`/`turnId`）——事件流没有契约背书。codex 升级改 schema 时解析会静默变空，然后被缺口 1 报成成功。

## Decision

1. **退出 0 且输出为空 settle 为 'error'**（三个 provider 一致）：exit-0 分支调用 `collectOutput()`，为空即 throw，`settleRunResult` 把 throw 压成 `stopReason: 'error'`。abort 路径不受影响——它经 `abortBranch` 先 settle 'aborted'，永远到不了这个分支。`turn/end` 的 error reason 仍是通用诊断文案；真实错误文本（如 "exited 0 but produced no answer"）经 `run.result` 交给父模型。

2. **codex 零 item.completed 预警**——正常退出（exit 0）的流里若 `parseCodexJsonStream` 一条 `item.completed` 都没解析出来，provider 报一次 `onError` warn 点名漂移嫌疑（"parsed no codex events — check the codex --json event schema"），再抛同样的空答案错误。warn 每轮只发一次、绝不一行一行刷，且不改 settle 语义——空输出无论怎样都已报 'error'。

## Alternatives considered

- **让上游 seam 检查空输出**——否：`settleRunResult` 是官方 harness 代码；"什么算输出"由各 provider 决定（各家解析不同的 wire 格式）。
- **静默返回空 'completed' 让父模型自己发现**——否：正是被修的 bug；父模型没有任何信号区分"无内容"与"成功"。
- **每行 malformed 都 warn**——否：schema 漂移时会在每次运行的每一行刷屏；每轮一次 warn 才是能存活的信号。

## Consequences

- 退出 0 却无回答的 CLI 现在会**可见地失败**委派（父模型看到错误文本），不再静默成功。
- codex 的 schema 漂移当天就能在日志里看见，且不改 settle 行为。
- 这些场景下 `turn/end` 的通用错误文案不变；具体原因经 `run.result` 到达模型（既有 seam 契约）。
