# Agent Note: the plugin-visibility convention doc — the axis is content, not seat

Status: implemented

English | [中文](2026-09-17-plugin-visibility-convention.zh.md)

## Problem

"Should a dev-mode plugin's sidebar show in other modes?" kept arriving as a per-package question, and the repo had the answer scattered across a proposal (mode-switcher's section C), five inlined copies of the same preset-visibility pattern (eval, mission, datasets, room, plus the worktrees badge variant), and the canvas self-hide revert of 2026-09-16 — which exists precisely because one package picked the wrong layer for the question. Each plugin inventing its own criterion is how the canvas mistake repeats.

## Decision

The convention is now stated once, in [docs/plugin-visibility.md](../../../docs/plugin-visibility.md), and AGENTS.md's Package conventions point at it. The doc fixes three rules:

1. **Three layers, chosen by what the surface's content binds to, not by taste or by seat.** Session-bound content — conversation chrome (`conversation.view` tabs, session-header badges) AND frame-level entries that render the current session's state (the worktrees right tab) — self-hides on the official preset-composition data, fail-open on every unreadable path including the no-session home state. Cross-session content (deployment workspaces like the canvas space) belongs to the install layer — a profile that should not show the entry must not list the package. Instance-level off-switches are row config (reaching the browser through the plugin's own Remote, since the web boot composes client entries without config).
2. **The sidebar answer is "the content decides", not "never".** The host's tab registry and slot APIs carry no visibility predicate (re-verified on 0.1.5), but `register` returns a disposer and the unregistered-kind state is a designed fallback — `tab.unavailable`, with the host comment "a kind with no registrant is a real state, not a defect" — and opened tabs are stored per session, so an ungranted session's layout never held the tab. A right-sidebar tab whose content is session-bound and whose companion row some preset names satisfies both preconditions and MAY self-hide with the same registration toggle (the worktrees right tab is the template case). The canvas revert's root cause is now stated precisely: canvas fails BOTH preconditions — a pure-UI package no preset names, and a cross-session workspace — compounded by presets being choosable only at session creation, so a frame-level surface has no preset input until a session exists. Declarative visibility stays on the upstream-wants list (the mode-switcher proposal's optional `visibleWhen` enhancement).
3. **The pattern stays inlined.** The five preset-visibility copies are deliberately not extracted into a helper — the mode-switcher proposal's M3' defers that decision until a fifth *new* consumer appears, and the doc records that deferral so nobody "tidies" it early.

## Revision (2026-09-17, same day)

The first revision of this note drew the axis by SEAT: "cross-session surfaces (right-sidebar tabs …) get no runtime switch, period". The coordinator pushed back with the canvas case — the canvas vanished not because sessions misbehaved but because a frame-level surface has no preset input until a session exists — and proposed gating frame-level sidebar entries like the conversation tabs. Re-reading the host (`ui-sidebar-right`'s tab registry: disposer semantics, per-session opened-tab storage, the designed unregistered-kind fallback) confirmed the mechanism is sound for surfaces whose content is session-bound. The axis moved from seat to content, recorded in rules 1–2 above and in the doc's "判据轴" section.

## Alternatives considered

- **Extract the helper package now.** Rejected per the existing M3' decision: four same-shape copies plus one variant do not yet earn a shared home, and a helper owned by nobody becomes a fifth divergence point.
- **A registry/config center mapping presets to visibility.** Rejected in the mode-switcher proposal already: the preset composition file is the single source of truth, and `pluginInventory.list()` already serves it.
- **Patch the sidebar APIs with a client-side predicate.** That is an upstream change; the repo's rule is that host changes go through the upstream-change pipeline, and the proposal tracks the ask. Documenting the honest answer beats a local workaround that re-runs the canvas experiment.

## Consequences

- New doc: `docs/plugin-visibility.md` (Chinese, matching docs/development.md's single-language convention); AGENTS.md gains the "Mode visibility (self-hide)" convention bullet; docs/packages.md's `preset-composed-row` entry points at the doc.
- Known gaps are recorded in the doc rather than fixed here: slash commands and the local-agent family's settings cards still register unconditionally (the proposal's M3' rollout backlog).
- No package code, tests, or profile composition change in this change; the behavioral content of the convention was already shipped by the five existing implementations.

## Testing

Docs and policy only. Verified by re-reading the cited sources: the room template (`packages/room/src/client/preset-visibility.ts`), the eval consumer (`packages/eval/src/client/index.ts`), the canvas revert note, and the host registry shapes quoted in the doc.

## Related

- [mode-switcher proposal](../../../proposals/active/2026-08-26-mode-switcher.md) (section C, the convention's origin; M3' owns the rollout backlog).
- [canvas preset self-hide revert](../feature/2026-09-16-canvas-preset-self-hide-reverted.md) (the incident this doc generalizes into a rule).
- [worktrees badge preset gate](../feature/2026-09-10-worktrees-badge-preset-gate.md) (the original template note).
