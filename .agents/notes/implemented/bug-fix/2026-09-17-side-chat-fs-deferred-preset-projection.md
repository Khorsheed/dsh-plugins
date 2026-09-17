# Agent Note: side-chat 0.2.3 — the apply-time fs probe that never persisted, preset inheritance, and context-injection projection

Status: implemented

English | [中文](2026-09-17-side-chat-fs-deferred-preset-projection.zh.md)

## Problem

Three ground-verified 3080 bugs, all in the side-chat's foundations:

**Persistence never happened (the worst).** `~/.dsh-official/state/sidechat/contexts.json` did not exist anywhere on disk while the side agents' session journals wrote normally. Root cause: `SideChatStore`'s constructor ran `this.fs = ctx.get('fs')` ONCE at apply time — sidechat declares no `fs` inject, so by mount order the fs service was not yet provided, the probe permanently returned `undefined`, and the store silently memory-only-degraded forever. Every restart orphaned every context mapping (the journals stayed, unfindable). Canvas persists because it declares `export const inject = ['fs']`; its index carries the exact lesson in a comment ("Deferred injection, NOT an apply-time probe — the registry's own mount order would race a `ctx.get` and silently lose").

**Preset mismatch by luck, not design.** The deployment default preset happened to be `dsh-writing`, so side chats matched writing-mode conversations by coincidence — a standard-mode conversation still got a `dsh-writing` side chat.

**AGENTS.md blocks rendered as user bubbles.** The side session's journal carries the same context injections as any conversation (`agent-instructions`, system-prompt snapshots, skill catalogs), and the projection rendered every `user/message` — including a whole `<system-reminder>` AGENTS.md document — as user speech, while the official UI classifies those as context-provenance rows.

## Decision

**fs is captured through deferred injection, never an apply-time probe, and never a package-level inject.** `ctx.inject(['fs'], fsCtx => { … })` fires immediately when fs is already mounted and never fires when none exists — the store stays memory-only BY CONSTRUCTION rather than pending the whole plugin away (which `inject = ['fs']` would do). `sandboxPolicy` rides a nested deferred door, only when the arrived fs actually confines. Two connective tissues make the late arrival useful: the store exposes `onFsReady`, on which the service resets its once-`loaded` flag (the next `ensureLoaded` merges the disk document into memory — memory stays authoritative for keys it holds — and flushes records created in the gap back to disk), and `warnMemoryOnly` moved from construction/read paths to writes only, resetting per fs-absence window.

**CREATE inherits the calling session's own preset.** The create path resolves `calling.session.header.agentPreset` (a durable header field every web session carries, undefined-guarded) → `record.agentPreset` → `config.agentPreset` → deployment default. RESUME keeps `record.agentPreset` — history was composed under that preset, the header comment's own replay semantics. The route options fix from 0.2.2 is untouched and composes with both paths.

**The projection filters context injections exactly like the official UI.** `user/message` events with `source.kind === 'agent-instructions'` or `source.form` in the KnownContextForm set (`instructions|catalog|snapshot|notice|relay|recall`) are skipped; our own sends (`kind: 'plugin'`, no form) and ordinary human messages stay visible. The filter is source-shape-based, not content-based — no heuristics on message text.

**No data repair** (recorded, deliberate): the two orphan side-session journals already on 3080 (uuid directories with no mapping) are unrecoverable by construction and harmless where they sit.

## Alternatives considered

### Why not `export const inject = ['fs']` (canvas's own spelling)?

Canvas can hard-inject because a canvas without a filesystem is pointless; side-chat without one is still a working chat (memory-only contexts are a degrade, not a failure). A package-level inject would keep the WHOLE plugin pending on an fs-less composition — a worse failure than the one being fixed. Deferred injection gives both: fs when it exists, survival when it doesn't.

### Why not re-read the disk document on every mutation instead of a once-flag?

The once-`loaded` flag exists because the doc is the single-writer's own mirror — re-reading per gesture buys nothing but IO. The bug was the flag never invalidating on fs arrival, not its existence. The fs-ready reset keeps the cheap path and fixes exactly the stale window.

### Why not filter injections by content sniffing (e.g. `<system-reminder>` tags)?

Content heuristics misfire on user text that legitimately contains those strings, and they miss every future injection form. The source metadata is what the session log already records for exactly this distinction — the official projection classifies by the same `kind`/`form` fields, so filtering there can never disagree with the main UI.

## Consequences

- `src/store.ts`: the constructor's one-shot `ctx.get('fs')` is now deferred `ctx.inject(['fs'])` with a nested `sandboxPolicy` door and an `onFsReady` hook; module and class docs carry the deferred-injection rationale.
- `src/service.ts`: `onFsReady` resets `loaded`/`warnedMemoryOnly`; `ensureLoaded` merges disk-into-memory (memory authoritative) and flushes the union back; `warnMemoryOnly` fires on writes only. `spawnAgent` splits composition per path: resume keeps `record.agentPreset ?? config`, create inherits `calling.session.header.agentPreset ?? record.agentPreset ?? config.agentPreset`.
- `src/journal.ts`: `isContextInjection` + the `CONTEXT_FORMS` set; `projectTranscript` skips those user messages.
- `package.json` 0.2.2 → 0.2.3; `docs/packages.md` regenerated. No dependency or API changes.
- The Agent Note for M1's store decision ([side-chat M1](../feature/2026-09-16-side-chat-m1.md)) is factually superseded on ONE point: the constructor-time `ctx.get('fs')` probe it recorded was wrong under real mount order; this note owns the corrected mechanism.

## Testing

- `packages/sidechat`: **80 tests green** (was 74): `tests/service.spec.ts` (+4 — fs arriving LATE: gesture works memory-only first, the next gesture after fs mounts merges and flushes the record to a real `contexts.json`, and a "restart" over that disk finds the context; preset inheritance three states: calling header first, recorded fallback, deployment default, plus resume preferring the recorded preset over a new calling header), `tests/journal.spec.ts` (+2 — all six context forms skipped, our own form-less plugin send kept).
- `pnpm --filter @khorsheed/dsh-sidechat build` (gen-typert → tsc → tsdown), `pnpm check:hygiene -- packages/sidechat`, `pnpm check:plugins`, `pnpm check:packages` are green.
- NOT done: a live 3080 re-walk (contexts.json surviving a restart, standard-mode preset match, the AGENTS.md bubble gone — all mechanism-covered here, feel unverified).

## Deferred

- The orphan journals note (no data repair, by construction — see Decision).
- Previously recorded upstream candidates remain open (plugin-authored forwarded Remote events, the user-message action seat, the transcript-selection quote seam, hidden/folded session presentation).

## Related

- [side-chat 0.2.2 — agentOptions route fix](2026-09-17-side-chat-agent-options.md) (the sibling 3080 fix; the two share the spawnAgent chain).
- [side-chat M1](../feature/2026-09-16-side-chat-m1.md) (the store/fence decision this corrects one mechanism of).
- [side-chat M2](../feature/2026-09-16-side-chat-m2.md) (the panel the projection feeds).
