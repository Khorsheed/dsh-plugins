# Agent Note: context-guard proactive compaction button

Status: implemented

English | [中文](2026-08-17-context-guard-compaction-button.zh.md)

## Problem

The official compaction-basic engine compacts at `agent/pre-step` once the token-meter estimate crosses 80% of the model's context window. That check leaves a window in which the provider rejects every main-loop request with no in-UI warning:

- **The check excludes the output budget.** Providers reject a request when `prompt + max_tokens > context_length`. The pressure check compares only the meter's context estimate against 80% of the window, so a request whose prompt sits below 80% but whose prompt + output budget exceeds the window fails with `CONTEXT_WINDOW_EXCEEDED`. The overflow recovery then compacts and retries — its summarization call reserves only its own small output cap, so the replay still fits and the retry succeeds — but the user pays a failed send first. Long tool-calling turns widen the gap: each step appends output and tool results while the danger stays invisible in the estimate.
- **The estimator deliberately underprices.** The token-meter estimator "systematically underprices CJK text and JSON schemas", so a CJK-heavy or schema-heavy session can sit under the 80% estimate while the provider-side count is already past the point where `context + maxTokens` fits.

The result is a silent failure the user cannot see coming: sends start failing with `CONTEXT_WINDOW_EXCEEDED` (recovery compacts and retries, but `maxOverflowRetries` defaults to 1, so a second failure aborts the turn), and nothing in the UI signals that the next send is about to fail.

## Decision

Plugin `@khorsheed/dsh-context-guard` (a browser half plus a thin host half that registers the `context-guard` settings namespace; no official-code changes). The browser half contributes one `conversation.input.right` entry — a compact button in the composer's tool row that renders nothing until the **context occupancy** crosses a threshold, then appears automatically — plus one `settings.plugin.item` card in the plugin configuration tab that edits the same number live:

- **Data**: the official `contextPressure` session projection (`projectedTokens` — the provider sample carried forward over the surface's movement since, so a compaction shows immediately, with the bare sample as fallback — plus `contextWindow`).
- **Formula**: `projectedTokens / contextWindow >= thresholdRatio` (default `0.8`) → amber button, always in the warning tint. The occupancy is the SAME number the composer's context ring shows — the guard is a reminder on top of the ring, not a second figure (an earlier draft added the output budget and produced a second, higher percentage that contradicted the ring; removed for exactly that confusion).
- **Action**: the official `/compact` command channel (`remote.commands.execute` → host `ctx.commands` → `ctx.compaction.compactNow`), so the host owns idle-gating, the compaction lock, and flow-node presentation.
- **Config**: one field, `thresholdRatio` (default 0.8). No `enabled` switch: disabling the plugin is the standard cordis way (remove the row). The output cap is deliberately NOT exposed — the rejection wall (`window − maxTokens`) is a model property, and a second knob confused non-expert users; the README carries the wall math and the "lower the ratio for an earlier reminder" guidance instead. The host half registers the settings namespace (schemastery schema, composition entry as base layer); the browser half binds its `settingsScope` to the same section and shares it between the button (read, reactive) and the card (read + write). Card edits land without a restart; the button re-renders on the new snapshot. Without the settings surface the button falls back to the composition-time value.
- **Locales**: zh/en under the `context-guard` namespace; an invariant companion reserves package ownership.

## Alternatives considered

- **Host-half projection folding its own surface state plus `request/header` maxTokens.** Rejected: the loop deletes `maxTokens` from the logged header when the adapter owns the default (`adapterDefaults.maxTokens`), and the effective cap is resolved asynchronously (`ctx.llm.resolveModelInfo().defaultMaxTokens`) — a session projection cannot await, so the host half adds plumbing without closing the accuracy gap.
- **Async `resolveModelInfo` pushed through a new RPC.** Rejected: adds API surface for one number; the configured `maxTokens` is precise enough and degrades safely (a conservative value only makes the button appear earlier, and an early compaction always fits).
- **DOM-anchored floating banner.** Rejected: the composer tool row is the sanctioned clickable seat; a DOM anchor would need a fallback and can break on official DOM changes.

## Consequences

- The danger is surfaced while the numbers are still inside the window, so the user compacts early — before context + maxTokens exceeds the window. The red `overdue` state at `>= 100%` communicates that the main request is already rejected — a manual `/compact` still fits and is the required next step.
- The plugin touches only official public surface (slots, the `contextPressure` projection, the commands Remote, the settings surface, locale), so it installs and uninstalls alone and composes out of cordis.yml with zero residue.
- The two tunables are GUI-editable and live: the settings card writes the shared section, and the button reacts to the new snapshot without a restart — an improvement over YAML-only configuration. The composition entry remains the section's base layer, so existing YAML keeps working as the fallback the card overrides.
- The trigger is occupancy-only, so the button's appearance matches the composer ring's figure — the earlier budget-inclusive formula showed a second, higher percentage (e.g. 82% next to the ring's 57%) that read as a contradiction. Simplicity won over the extra precision: users who need an earlier reminder lower the ratio (the README explains the wall is `window − maxTokens`, below 100% occupancy).
- No auto-compaction: the official 80% pre-step rule keeps running unchanged, and the button disappears on its own once a landed compaction shrinks the projected surface.

## Verification

- 41 tests green across six files: guard decision math (occupancy threshold ladder, overdue floor, unknown-input degradation, a lower-ratio-reminds-earlier pin, and the "mirrors the composer ring" pin), config defaults and clamping (single `thresholdRatio`), zh/en key parity, slot registration with fiber-teardown removal (HMR safety), the inject face's three `/compact` result paths against a stubbed command Remote, the shared settings-scope hooks source, the host half's namespace registration against a real in-memory `SettingsProvider` (schema validation + dispose), the settings card (disclosure, staged save through the scope, unset, overridden badge, out-of-range blocking), and the button component (presence conditions, amber-at-every-level, live settings override, click → injected verb, rejected-compact error status).
- `pnpm --filter @khorsheed/dsh-context-guard build` (tsc + tsdown) and `typecheck` green; the emitted `lib/client.js` carries the `window.__ModuleLoader__.load` registration header required by the client module loader.
