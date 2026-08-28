# Agent Note: settings card header credential dot (at-a-glance auth status)

Status: implemented

English | [中文](2026-08-27-settings-card-auth-status-dot.zh.md)

## Problem

The per-provider settings cards (live settings card proposal, M1/M2) only show the credential state INSIDE the expanded card's auth block. With four providers, checking "which one is not logged in" meant expanding every card. The user asked for the collapsed header to carry the status dot — the same green/red/grey the family settings section's rows have.

## Decision

A tiny auth-status bus in the family core's client face, instead of per-card polling:

- `packages/local-agent/src/client/auth-status.ts`: a module-level publish/subscribe map keyed by harness id. `ProviderAuthBlock` publishes every probe result (mount refresh, login poll hits, logout re-probe, failure paths) — it already owns the probe lifecycle, so no second poller exists. Card headers read through `useHarnessAuthStatus(harnessId, probe)`: a `useSyncExternalStore` subscription plus a one-shot probe ONLY when nothing was published yet (a header mounted before its block). `resetAuthStatuses` / `readAuthStatus` are the test hooks (the bus is a module singleton).
- `AuthStatusDot` (core client export): the section's 8px credential dot verbatim (green = authenticated, red = anonymous, grey = checking/unavailable) with a localized aria label from the card's existing `authT` binding — no new locale keys.
- All four provider cards (kimi/codex/claude-code/dsh) render the dot next to the collapsed title (new `.nameRow` flex row in each card's css).

## Alternatives considered

- **Each card polls status on an interval** — rejected: four cards × an interval duplicates the Remote traffic the block already drives, and a login completing in the block would still lag the dot by one interval. The bus makes the block's existing probe the single source and flips every mounted card instantly.
- **Lifting the whole view state out of ProviderAuthBlock** — rejected: the block's internal state (prompts, code drafts, toasts) is interaction-local; only the status kind is worth sharing, and a string-per-harness bus is the smallest possible coupling.

## Consequences

- The collapsed plugin-config tab now shows at a glance which providers are authenticated; the dot flips live on login/logout without an expand.
- The section (still present until the proposal's M3) also publishes, so its rows and the cards can never disagree.
- Adding a fifth provider card later is: render `<AuthStatusDot>` + one hook call — the block publishes for free.

## Testing

- core `provider-auth-block.client.spec.tsx` +1: a mount probe lands on the bus (`readAuthStatus`).
- kimi `settings-card.client.spec.tsx` +2: the collapsed header dot reflects an authenticated and an anonymous probe (aria label + `data-auth-status`), with `resetAuthStatuses()` in afterEach so the module singleton never leaks between specs.
- Suites: local-agent 175/175, kimi 115/115; full-repo build/test green.

## Cross-references

- [Live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md) — the cards this extends (M1/M2).
