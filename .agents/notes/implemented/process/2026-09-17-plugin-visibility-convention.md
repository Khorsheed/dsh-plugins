# Agent Note: the plugin-visibility convention doc — three layers, and the sidebar has no preset switch

Status: implemented

English | [中文](2026-09-17-plugin-visibility-convention.zh.md)

## Problem

"Should a dev-mode plugin's sidebar show in other modes?" kept arriving as a per-package question, and the repo had the answer scattered across a proposal (mode-switcher's section C), five inlined copies of the same preset-visibility pattern (eval, mission, datasets, room, plus the worktrees badge variant), and the canvas self-hide revert of 2026-09-16 — which exists precisely because one package picked the wrong layer for the question. Each plugin inventing its own criterion is how the canvas mistake repeats.

## Decision

The convention is now stated once, in [docs/plugin-visibility.md](../../../docs/plugin-visibility.md), and AGENTS.md's Package conventions point at it. The doc fixes three rules:

1. **Three layers, chosen by the surface, not by taste.** Cross-session surfaces (right-sidebar tabs, panellist rows, global spaces) belong to the install layer — a profile that should not show the entry must not list the package; there is no runtime switch and none may be improvised. Session-bound chrome (`conversation.view` tabs, session-header badges) self-hides on the official preset-composition data, fail-open on every unreadable path. Instance-level off-switches are row config (reaching the browser through the plugin's own Remote, since the web boot composes client entries without config).
2. **The sidebar question is answered "no, by design".** The host's tab registry and slot APIs carry no visibility predicate (re-verified on 0.1.5), and a session-preset criterion on a cross-session surface hides it forever because presets bind at session creation — the canvas revert's root cause, now promoted from incident note to standing rule. Declarative visibility stays on the upstream-wants list (the mode-switcher proposal's optional `visibleWhen` enhancement).
3. **The pattern stays inlined.** The five preset-visibility copies are deliberately not extracted into a helper — the mode-switcher proposal's M3' defers that decision until a fifth *new* consumer appears, and the doc records that deferral so nobody "tidies" it early.

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
