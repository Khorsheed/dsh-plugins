# Agent Note: reverting the canvas preset self-hide — presets bind sessions, the canvas is cross-session

Status: implemented

English | [中文](2026-09-16-canvas-preset-self-hide-reverted.zh.md)

## Problem

M2 shipped a preset-composition self-hide for the canvas space ([M2 note](2026-09-16-canvas-space-m2.md)): the rail icon, main panel, tab type, and detail tab body registered only while the CURRENT session's preset group named `@khorsheed/dsh-canvas` — the room preset-visibility precedent, with every unreadable path failing open. On 3080 the user reported the canvas entry had **vanished entirely**.

The root cause is structural, not a bug in the criterion. A preset binds **at session creation** — every session on 3080 was created with the old `dsh-writing` composition, which predates this package and therefore names no canvas row. The canvas space is a **cross-session** surface: there is no session for which the criterion ever passes, so "self-hide" is "hide forever". The fail-open design worked exactly as specified; the criterion itself was wrong for this surface. Room's criterion does not generalize: room's chrome is session chrome (a preset granting room to THAT session is meaningful), while the canvas panel is a deployment-level workspace that predates and outlives any session's composition.

## Decision

**The self-hide is removed wholesale, not repaired.** Deleted `packages/canvas/src/client/preset-visibility.ts` (`CanvasPresetVisibility` + `RegistrationToggle` + `CANVAS_ROW_MODULE`) and `tests/preset-visibility.spec.ts`; the four registrations (panellist row, main panel, tab type, detail tab body) are unconditional again, exactly the M1.5 shape — each still riding `ctx.slots.inject` so a host without the seat degrades silently, and the detail tab's `openTab` activation is unchanged. The client `inject` list drops `sessions` (only the visibility controller used it), and the devDependency `@deepseek-ai/dsh-api-session-controller` goes with it. Package version 0.3.0 → 0.3.1 (the behavior line moves, the API does not).

**Mode visibility belongs to the install layer, stated plainly in both READMEs.** The canvas does NOT hide by the session's preset; whether a deployment sees the space is decided by which packages the profile / bundle installs — the one layer that actually knows the deployment's intent.

**What is deliberately kept**: every other M2 mechanism (the side-chat seam, the two tools, the lens bar / 追问 / 问 Agent entries with the `chatStatus` gate, the turn watch, and room's own self-hide — whose surface IS session-bound and whose criterion is sound for it).

## Alternatives considered

### Why not fix the criterion instead of deleting it?

Every repair names the same flaw. "Show if ANY session's preset has canvas" is a constant true/false per deployment — it is the install layer wearing a query. "Show if the current preset group exists and is not broken" hides nothing at all. "Match room exactly but grandfather old sessions" re-implements "visible" with extra steps. The criterion has no correct per-session form for a cross-session surface, so the honest change is to stop asking the question per session.

### Why not keep the toggle machinery but default it to always-on?

Dead machinery with a config flag is the worst of both: the code path keeps its cost (four toggles, a session subscription, an inventory fetch) and its failure modes, to implement a constant. If a future surface of this package IS session-bound (a per-session canvas affordance, say), room's two hunred-line pattern is one checkout away in git history and in `packages/room/src/client/preset-visibility.ts`.

### Why not hide only when the profile is headless / has no web consumer?

That gate already exists and is unrelated: the canvas is a web surface, and a headless profile simply never loads the client half (`dsh.client.platform: web`). The reverted code answered "which sessions see the entries"; the honest layers are "which deployments install the plugin" (profile composition) and "which platforms can render it" (the platform field).

## Consequences

- Deleted: `packages/canvas/src/client/preset-visibility.ts`, `packages/canvas/tests/preset-visibility.spec.ts` (8 cases). Test count 166 → 158.
- `packages/canvas/src/client/index.ts`: the four registrations are unconditional (M1.5 shape: tab type via `ctx.sidebarRightTabs.register`, the three slot seats via `ctx.effect(() => ctx.slots.inject(...))`); the M2 turn watch and chat face are untouched; `inject` back to `['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs']`.
- `packages/canvas/package.json`: 0.3.0 → 0.3.1; devDependency `@deepseek-ai/dsh-api-session-controller` removed.
- Both READMEs: the self-hide paragraph now reads "画布不做会话 preset 自隐" / "No per-session preset self-hide", with the one-line reason and the install-layer rule.
- The [M2 note](2026-09-16-canvas-space-m2.md) keeps its record of the decision as made; this note is the superseding one, and the two are cross-linked (the notes README's supersession rule).
- No Remote, service, or wire change; no other package touched.

## Testing

- `packages/canvas`: **158 tests green** (166 − the 8 removed visibility cases). `pnpm --filter @khorsheed/dsh-canvas build` after `rm -rf lib` (pack-dist's stale-types check starts from a clean artifact), `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` (191) all green.
- On 3080 the entries are unconditional registrations again, so the rail icon / main panel / detail tab show for every session — the acceptance complaint this reverts.

## Related

- [M2 note](2026-09-16-canvas-space-m2.md) (the self-hide as shipped and its rationale at the time).
- [M1 note](2026-09-16-canvas-space-m1.md) (the space's mounting and its cross-session nature).
