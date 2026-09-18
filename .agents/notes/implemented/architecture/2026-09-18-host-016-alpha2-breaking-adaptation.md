# Agent Note: host 0.1.6-alpha.2 breaking adaptation — session generations, inbox queue, slot-kind flips

Status: implemented

English | [中文](2026-09-18-host-016-alpha2-breaking-adaptation.zh.md)

## Problem

The host skipped the expected 0.1.6 rc and published 0.1.6-alpha.2 instead (2026-09-17, 887 commits / 2622 files past alpha.1). The user ruled on 2026-09-18 that the wave retargets alpha.2 directly and ships to 3080 as the pinned version; the shared `~/code/deepseek-harness` checkout and 3080 stay frozen until the user explicitly releases them. alpha.2 rewrote the client session service (generation-based retain/borrow), moved the composer queue onto the `inbox` projection, flipped two slot kinds, and deleted the old settings-plugin slot family. The alpha.1 six hits re-verified clean on alpha.2 (zero rework); this note records the alpha.2 batch. The probe-and-degrade contract is unchanged: every package keeps working on 0.1.5 (minHost unmoved) while compiling against alpha.2 types.

## What broke (eight hits, all fixed in this batch)

1. **`ISessions.open/openSubagent/clear` deleted** → `ctx.uiWorkspace.openSession(target)`, which exists on both host lines (0.1.5 `navigation.ts:134`, alpha.2 `navigation.ts:161`) but throws synchronously on failure under alpha.2 — every call site is wrapped in try/catch and degrades to staying on the current view. Hit: room, eval, ui-shortcuts, mobile (`MobileRooms`), taskpilot (whose `prepare` script failed the whole-workspace `pnpm install`, the first install-level blocker).
2. **`SessionListState.current`/`currentAddress` deleted** → derived from the public list: `Object.values(list.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id`, duck-falling back to the legacy `current` field (`(list as { current?: SessionId }).current`). This is the official single source of truth — the host inlines the same derivation in four places (sidebar tree highlight, document title, session-maybe `publishMain`). Each consumer package inlines its own `mainSessionId` helper (cross-package dependencies are forbidden by convention); duck-typed variants avoid new devDeps. Hit: room, mobile, ui-shortcuts, eval, mission, datasets, message-timeline, message-tools (`dom-hider`, an unlisted hit), quote, local-agent (`ProviderAuthBlock`).
3. **`SessionSnapshot.queue`/`QueuedMessage` deleted** → `useProjection('inbox')` reading `InboxState['next-turn']` (`UserMessage`: `id`/`content`/`source`; rpcId under `source.kind === 'user'`), following the official `QueueDock.tsx` (`previewOf`/`textOf`). Dual line: where the projection is absent (0.1.5) the code falls back to a duck-typed legacy `snapshot.queue`. Hit: room (`RoomComposer`), mobile (`MobileQueue`, `SubmissionFocus`; new `src/client/queue.ts` normalizes both shapes).
4. **`conversation.chat.turnTail` chain → list**: registrations now require `id` and run no `select`; our `priority: -1` + `select` pre-emption is mechanically dead. ui-file-preview registers dual-shape, probing `ctx.slots.spec(key).kind` inside the `slots.inject` callback (spec exists on both lines): chain shape on 0.1.5, list shape on alpha.2. **User ruled coexistence**: `TurnFileRow` renders alongside the official `DeliverablesTail` and PlanCards for a comparison period; the 2026-09-11 "replace the official row" product decision is void.
5. **`settings.plugin.item` slot family deleted** (ui-settings-plugins rework). context-guard moved to `plugins.bundle.config` keyed by package name (per the official slot contract, `plugins.item` is host-only); ui-shortcuts moved to `settings.plugins.tab`. Both register **dual-arm via two `slots.inject` calls** (one per slot name) rather than `spec()`-probing: inject's wait-for-declaration is race-free across apply order, while `spec('plugins.bundle.config')` returns undefined if our package applies before ui-plugin-manager. Exactly one arm fires on either host line.
6. **`SessionPendingInteractionSnapshot` → `SessionStatusSnapshot`/`useSessionStatus`** (whalesong). The internal contract was switched to the new face outright; the 0.1.5 difference is concentrated in one boundary adapter (`sessionStatusFromLegacyPending`, memoized by source snapshot identity to keep the controller's `next === prev` short-circuit).
7. **`ModelDirectory.select()` never rejects**, returning `RemoteResult<void>` (room's `RoomModelPicker`, message-tools' editor ModelChip). The settle handler now reads `result && typeof result === 'object' && 'ok' in result ? result.ok : true` — a settled value carrying `ok` is read as RemoteResult, anything else means legacy success, and the reject branch stays for 0.1.5. Isomorphic with the official consumer (`!result.ok`).
8. **`[data-composer-stats]` DOM anchor deleted** (mobile's compact stats row CSS). Replaced with a union selector adding `[data-composer-card] + div` (the dock row is the card's sole direct sibling on both lines — inert on 0.1.5's `display: contents` wrapper, hits the real flex dock on alpha.2).

Behavior notes: `sessions.scope()/binding()` are borrow-only against retained generations — immediate-resolve-immediate-use with `?.` stays safe on both lines; `sessions.using`/`retain` do not exist on 0.1.5, so rename paths (session-title-edit, mobile `SessionRename`) keep the `binding(id)?.session` dual-read and were not upgraded.

## Decision

- **Retarget the wave to alpha.2 as the fixed version** (user, 2026-09-18): devDeps re-pinned `^0.1.6-alpha.1` → `^0.1.6-alpha.2` (32 packages), pnpm-workspace overrides + exclude flipped (159 entries), mobile's exact-pin style preserved (`0.1.5-rc.1` → `0.1.6-alpha.2` exact, minHost untouched). cordis stays 4.0.2.
- **Dual-compat by duck typing and dual-arm registration**, never version-sniffing: `mainSessionId` helper, inbox/legacy-queue normalization, dual-shape turnTail, dual-arm settings slots, RemoteResult-aware select, boundary adapters. No new runtime dependencies; context-guard adds `@deepseek-ai/dsh-client-ui-plugin-manager` as a **devDep only** (types; runtime integrates softly through `slots.inject`).
- **capability-catalog needs no change**: its settings surface is a self-registered `settings.section` entry (intact on both lines), never the deleted `settings.plugin.item` dispatch; only stale comments elsewhere referenced that mental model.
- **New upstream seam candidate**: a named public main-selection reader (`useMainSession` selector from ui-session or ui-workspace). The data is public; the host inlines the same derivation four times, and we now inline it in ~10 packages — silent-drift bait if mainView semantics ever change. To be registered in the seam registry.
- **inline-html-render rides the official browser**: `openLink` probes `sidebarRightTabs.get('browser')` and opens `openTab('browser', { params: { url } })`, falling back to `window.open` (browser-pane proposal closed the same day — we use the official Sidebar Browser, never build our own).
- **ankh-guard emit-`source` fidelity stays deferred**: `fix/ankh-guard-test-lifecycle` is unmerged and touches `tests/preflight-drift.spec.ts` plus most of the package; the fidelity pass would collide. Revisit after that branch merges.

## Alternatives considered

- **Waiting for the rc before adapting** — the user's call supersedes: alpha.2 is the target, rc becomes a re-verification gate.
- **Retiring `TurnFileRow` immediately** (official changed-files card covers git-repo turns) — user ruled coexistence and compare; ours still uniquely survives restarts (pure log fold), covers non-git directories, and records reads.
- **`spec()`-probing the settings slot** — apply-order race: probing before ui-plugin-manager applies misdetects a 0.1.6 host as 0.1.5. Dual-arm `slots.inject` has no such window.
- **A shared `mainSessionId` helper package** — the no-inter-plugin-dependency convention forbids it; a three-line inline helper per package is the sanctioned shape.
- **Upgrading renames to `sessions.using`** — absent on 0.1.5; binding dual-read is dual-line safe.
- **Bumping `minHost`** — unchanged from the alpha.1 note's reasoning; 0.1.6 is still npm `alpha`, `latest` is 0.1.5.

## Consequences

- All adapted packages build and test green against alpha.2 (room 224, ui-file-preview 96, whalesong 97, context-guard 47, mobile 95, taskpilot 48, ui-shortcuts 48, eval 609, mission 131, datasets 168, message-timeline 110, message-tools 193, quote 33, session-title-edit 45, local-agent 267, inline-html-render 26), each with legacy-fallback cases pinning the 0.1.5 path.
- quote was merged to main (`8f13f73a`) after this branch was cut; it was restored and adapted in-worktree (including a `gen-typert.mts` `TYPERT_PACKAGES` entry) and is formalized by the main-into-wave merge, where add/add conflicts resolve in favor of the adapted copy (main has no newer quote commits).
- ui-shortcuts' settings card is now a standalone `settings.plugins.tab` page on alpha.2 (a folding card on 0.1.5) — a visual acceptance item for 3080.
- local-agent READMEs claim the official subagent sidebar chat as a zero-change member-session benefit (MemberComposer wins the embedded composer election).
- Remaining before 3080: main-into-wave merge (reader/canvas/sidechat/newer eval-datasets arrive and need their own alpha.2 check), ankh-guard suite against alpha.2, `pnpm gate`, local-instance verification, and the user's explicit release for any 3080 or shared-checkout move.
