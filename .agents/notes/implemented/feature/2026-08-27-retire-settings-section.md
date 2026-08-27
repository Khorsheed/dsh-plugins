# Agent Note: retire the standalone settings section (M3) + member composer re-probe on running flip

Status: implemented

English | [中文](2026-08-27-retire-settings-section.zh.md)

## Problem

Two tail items from the live-settings-card proposal's review round:

1. **M3**: with auth and live controls carried by each provider's `settings.plugin.item` card, the family core's standalone「本地 Agent」settings section became a second home for the same state — two surfaces that can disagree, one extra tab.
2. **UX**: a delegated member session opened mid-round showed the one-shot read-only panel and never flipped to the writable member box on its own — the membership probe ran once at mount, while the delegation record only lands at the first round's settle (exec) or handshake (live). Re-entering the session was the only way to see the member UI.

## Decision

- **Section retired**: the core client drops the `settings.section` registration, the `LocalAgentSettingsSection` component, and the `local-agent.settings.row` / `row-action` contribution seats (no remaining consumers — dsh migrated to its own card in M2). The stylesheet moves to `ProviderAuthBlock.module.css` (the block already owned its rows). Root + family READMEs (both languages) now describe the cards; the family screenshot was retaken (four cards with header dots); CHANGELOG carries the family entry. The accepted loss stays as decided in the proposal: uninstalled-provider placeholder rows are gone, discovery is the README's job.
- **Re-probe on the running flip**: MemberComposer keeps the one-effect probe but re-runs it when the session's `running` flag changes, skipping only when membership is already resolved for the current child. The record lands exactly when running flips (settle/handshake), so an open panel now swaps the read-only fallback for the writable box in place. A ref mirrors membership so the effect's deps stay `[memberOf, childSessionId, running]` — a null answer must not re-trigger itself.

## Alternatives considered

- **Host-side early registration** (write a placeholder delegation record at run start so membership resolves immediately) — rejected for now: `promptMember`/`resolveDelegation` would need a "starting" error branch for the empty-handle window, and the input is disabled while running anyway; the client re-probe gets the visible win with zero contract change. If the header should say "member" from second zero, this is the follow-up.
- **Keep the section as a read-only summary** — rejected: a second surface for the same state is precisely what drifts; the cards are the single home.

## Consequences

- Settings has one home for the family: Plugins → 可配置插件. The「本地 Agent」nav entry disappears on the next profile refresh.
- Member sessions flip from「一次性」read-only to the member box the moment the first round lands — no re-enter.
- The `memberOf` Remote is called at most a couple of times per round per open panel (probe on mount + on each running flip while unresolved).

## Testing

- core 160/160: the browser-plugin HMR test now pins the composer chain registration (was the section); member-composer spec +1 (null probe → running flip → member box appears without re-enter); section spec deleted with the component, parity tests folded into the block spec in M1.
- Full-repo build/test green; `check:plugins` 0 findings.

## Cross-references

- [Live settings card proposal](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md) — M3/M4.
- [Auth status dot](2026-08-27-settings-card-auth-status-dot.md) — the card header work this retires the section in favor of.
