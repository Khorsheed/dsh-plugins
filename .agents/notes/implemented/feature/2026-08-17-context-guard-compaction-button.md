# Agent Note: context-guard proactive compaction button

Status: implemented

English | [中文](2026-08-17-context-guard-compaction-button.zh.md)

## Problem

The official compaction-basic engine compacts at `agent/pre-step` once the token-meter estimate crosses 80% of the model's context window. That check leaves a window in which the provider rejects every main-loop request with no in-UI warning:

- **The check excludes the output budget.** Providers reject a request when `prompt + max_tokens > context_length`. The pressure check compares only the meter's context estimate against 80% of the window, so a request whose prompt sits below 80% but whose prompt + output budget exceeds the window fails with `CONTEXT_WINDOW_EXCEEDED`. The overflow recovery then compacts and retries — its summarization call reserves only its own small output cap, so the replay still fits and the retry succeeds — but the user pays a failed send first. Long tool-calling turns widen the gap: each step appends output and tool results while the danger stays invisible in the estimate.
- **The estimator deliberately underprices.** The token-meter estimator "systematically underprices CJK text and JSON schemas", so a CJK-heavy or schema-heavy session can sit under the 80% estimate while the provider-side count is already past the point where `context + maxTokens` fits.

The result is a silent failure the user cannot see coming: sends start failing with `CONTEXT_WINDOW_EXCEEDED` (recovery compacts and retries, but `maxOverflowRetries` defaults to 1, so a second failure aborts the turn), and nothing in the UI signals that the next send is about to fail.

## Decision

New client-only plugin `@khorsheed/dsh-context-guard` (browser half only, no host half, no official-code changes). It contributes one `conversation.input.right` entry — a compact button in the composer's tool row that renders nothing until the **next request's budget** crosses a threshold, then appears automatically:

- **Data**: the official `contextPressure` session projection (`projectedTokens` — the provider sample carried forward over the surface's movement since, so a compaction shows immediately, with the bare sample as fallback — plus `contextWindow`).
- **Formula**: `(projectedTokens + maxTokens) / contextWindow >= thresholdRatio` (default `0.8`) → amber button; `>= 1` → red button (the main request's budget already exceeds the window; a manual `/compact` still fits because its summarization call reserves only a small output cap — click now).
- **Action**: the official `/compact` command channel (`remote.commands.execute` → host `ctx.commands` → `ctx.compaction.compactNow`), so the host owns idle-gating, the compaction lock, and flow-node presentation.
- **Config**: `enabled`, `thresholdRatio`, `maxTokens` (default 256000, matching the deepseek adapter's default output cap — the reservation the main loop makes; the summarizer's own 8192 cap is deliberately not the model, because the summarizer keeps fitting long after the main request is rejected).
- **Locales**: zh/en under the `context-guard` namespace; an invariant companion reserves package ownership.

## Alternatives considered

- **Host-half projection folding its own surface state plus `request/header` maxTokens.** Rejected: the loop deletes `maxTokens` from the logged header when the adapter owns the default (`adapterDefaults.maxTokens`), and the effective cap is resolved asynchronously (`ctx.llm.resolveModelInfo().defaultMaxTokens`) — a session projection cannot await, so the host half adds plumbing without closing the accuracy gap.
- **Async `resolveModelInfo` pushed through a new RPC.** Rejected: adds API surface for one number; the configured `maxTokens` is precise enough and degrades safely (a conservative value only makes the button appear earlier, and an early compaction always fits).
- **DOM-anchored floating banner.** Rejected: the composer tool row is the sanctioned clickable seat; a DOM anchor would need a fallback and can break on official DOM changes.

## Consequences

- The danger is surfaced while the numbers are still inside the window, so the user compacts early — before context + maxTokens exceeds the window. The red `overdue` state at `>= 100%` communicates that the main request is already rejected — a manual `/compact` still fits and is the required next step.
- The plugin touches only official public surface (slots, the `contextPressure` projection, the commands Remote, locale), so it installs and uninstalls alone and composes out of cordis.yml with zero residue.
- A wrong `maxTokens` config shifts when the button appears rather than breaking anything; the default models the main request's reservation (the deepseek adapter's 256k cap), not the summarizer's 8192 cap — the two were originally conflated, and the 8192 default placed the button after the provider wall (regression fixed with this note).
- No auto-compaction: the official 80% pre-step rule keeps running unchanged, and the button disappears on its own once a landed compaction shrinks the projected surface.

## Verification

- 37 tests green across five files: guard decision math (threshold ladder, overdue clamp, unknown-input degradation, plus pins — the 256k-reservation warning fires before the provider wall, and overdue keys off the CONFIGURED window — 544k warning / 744k overdue at a 1,000,000 catalog window, ahead of the real 1,048,576 provider wall), config defaults and clamping (default `maxTokens` 256000), zh/en key parity, slot registration with fiber-teardown removal (HMR safety), the inject face's three `/compact` result paths against a stubbed command Remote, and the button component (presence conditions, warning/overdue styling, click → injected verb, rejected-compact error status).
- `pnpm --filter @khorsheed/dsh-context-guard build` (tsc + tsdown) and `typecheck` green; the emitted `lib/client.js` carries the `window.__ModuleLoader__.load` registration header required by the client module loader.
