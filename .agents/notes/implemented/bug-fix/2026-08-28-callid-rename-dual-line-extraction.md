# Agent Note: CallId→ToolCallId rename — extract the field type, never name either brand

Status: implemented

English | [中文](2026-08-28-callid-rename-dual-line-extraction.zh.md)

## Problem

Host 0.1.2-alpha.1 renamed the tool-call id brand in `@deepseek-ai/dsh-llm/brand`: the npm line (devDependencies `^0.1.1-rc.1`, no 0.1.2 on the registry yet) exports `CallId`; the alpha source exports `ToolCallId` — and nothing else changed about the field (still a compile-time-only `Branded<…>` string). The local-agent family called `CallId(x)` as a **runtime function** when folding transcript tool lines into `tool/call` events and `createToolResultMessage` inputs, so under the alpha source plane every fold threw `TypeError: CallId is not a function` inside the stream callback and cascaded into hung/timed-out runs — 52 failing tests across local-agent-kimi (8), local-agent-codex (15), local-agent-claude-code (21), and local-agent-tool-subagent (8). Neither name can be written in our source: `ToolCallId` fails tsc against the rc.2 types (it does not exist there), and `CallId(x)` fails at alpha runtime.

## Decision

Never name either brand. A brand is compile-time-only and the runtime value is a plain string, so every call site passes the raw string with a type assertion whose target is **extracted from the consuming API** — an anchor that exists, with the same field name, on both host lines:

- `SessionEventMap['tool/call']['callId']` (from `@deepseek-ai/dsh-session`) for `childSession.append('tool/call', …)` payloads — `packages/local-agent-kimi/src/session-mirror.ts:288`, `packages/local-agent-claude-code/src/claude-cli-provider.ts:1019`, `packages/local-agent-codex/src/codex-cli-provider.ts:858`.
- `Parameters<typeof createToolResultMessage>[0]['callId']` for tool-result message inputs — `session-mirror.ts:249,298`, `claude-cli-provider.ts:1028`, `codex-cli-provider.ts:867`.
- `ToolExecutionInput['callId']` (from `@deepseek-ai/dsh-tools`) for `ctx.tools.execute(…)` in tests — `packages/local-agent-tool-subagent/tests/tool-subagent.spec.ts:54`.

Each file carries a three-line comment stating why the extraction pattern is used; the `CallId` import (value and type positions) is gone from all four packages. The pattern generalizes: any future host brand rename is handled the same way — anchor on the field you fill, not on the brand's name.

## Verification

Both lines are green on the same source: alpha source plane (`DSH_HARNESS=~/code/deepseek-harness-alpha`, vitest alias) — kimi 121, codex 93, claude-code 88, tool-subagent 11 tests all pass; npm rc.2 types — `pnpm --filter … run build` (tsc) passes for all five local-agent packages; rc.2 source plane (`DSH_HARNESS=~/code/deepseek-harness`) — same suites plus local-agent core 160 tests all pass. The local-agent core's remaining alpha-plane red is `tests/browser-plugin.client.spec.ts` (`window is not defined` from the removed `dsh-client-runtime`) — the client-runtime migration wave owns it, not this fix.

## Alternatives considered

- **Import `ToolCallId` behind a runtime probe** (`const brand = CallId ?? ToolCallId`) — rejected: `ToolCallId` is absent from the rc.2 *types*, so even a guarded value import fails tsc; devDependencies cannot move to alpha because it is not on npm.
- **Define a local structurally-compatible brand** (`type CallIdCompat = string & { … }`) — rejected: nominal brands are deliberately non-interchangeable, so a homemade brand is not assignable to the host's field type on either line without a second cast; extracting the field type says exactly "whatever this field wants" with no inventiveness.
- **Drop to `string` and cast** — rejected: `line.id as string` would not satisfy the branded field; the assertion target has to be the field's own type anyway, which is the chosen form.

## Consequences

- The local-agent family now compiles against the npm rc.2 types and runs against the 0.1.2-alpha.1 source from one source tree — the first dual-line adaptation pattern for the alpha wave; the client-runtime migration and any other brand renames should copy it.
- `file-preview/tests/fold.spec.ts` still has `import type { CallId }` (type-only, erased at runtime but a tsc break once dev types move) and `taskpilot` has matching test-site usage — both are outside this fix's package scope and remain for their owners.
- When 0.1.2 reaches npm and the dev baseline moves up, the extraction anchors stay correct unchanged; the comments can be simplified then, but there is no urgency — the pattern has no runtime cost.
