# Agent Note: message-tools restore projection — shipped behind a fold-semantics probe (S12)

Status: implemented

English | [中文](2026-09-15-message-tools-restore-projection.zh.md)

## Problem

Withdraw-then-restore replays a withdrawn assistant reply as a plugin-sourced `user/message` with the `RESTORED_ASSISTANT_NOTICE` frame (op `restore-assistant`): the model reads someone else's assistant text in user role and can mistake it for a fresh instruction (seam registry S12). The 0.1.6 host added `ctx.sessions.registerMessageProjection()` — one pure interpreter per event type, rewriting derived messages with no role validation — and the proposal `proposals/active/2026-09-15-message-tools-projection-restore.md` settled the shape: register on the shared `user/message` type, rewrite only restore-marked events to assistant role, pass everything else through with an empty map.

## The probe finding (contradicts the proposal's M0)

**0.1.6-alpha.1's surface fold cannot carry a projection on a surface-producing event type.** `planSurfaceEvent` (`packages/core/session/src/surface.ts`) routes every event whose type has a registered projection through the `project` plan, and `applySurfacePlan` for that plan never pushes the event's seq onto `surface.nodes` — the design assumed the projection path *adds* rewrites while the normal append/replace path still runs, but it *replaces* it. Verified twice against the pinned alpha checkout (`DSH_HARNESS=$HOME/code/deepseek-harness-alpha`, detached at the 0.1.6-alpha.1 merge plus two commits): with a `user/message` projection registered, both a plain user message and a restore-marked one fold to `surface.nodes: []` and `deriveMessages(): []`. Registering as designed would have silently dropped **every user message** from the model context on 0.1.6 — worse than the seam it fixes. The mechanism as implemented serves only log-only *decision* events (its one first-party instance, `image/offload`, rewrites existing nodes from a log-only record).

## Decision

- **Ship the projection exactly as designed, gate the registration behaviorally.** `src/restore-projection.ts` carries `restoreAssistantProjection` (pure, `type: 'user/message'`): restore-marked events derive to an immutable assistant-role copy with the frame stripped per text block (non-text blocks kept by reference, `id` preserved); everything else — plain user messages, other plugin ops, malformed payloads — returns an empty map. It never throws: the fold calls `project` synchronously inside append validation, where a throw atomically rejects the candidate, so a throwing projection would break ordinary user messages instance-wide.
- **Three degrade gates, in order** (`registerRestoreProjection`, called from the `MessageToolsService` constructor): `typeof ctx.sessions.registerMessageProjection === 'function'` (pre-0.1.6 hosts); `restoreProjectionFoldSupported()` — a behavioral probe that folds two synthetic events (one plain, one restore-marked) through the real `foldSurface` and accepts only the composing semantics the design needs (plain keeps its node; restore keeps its node AND derives assistant-role, frame stripped); and a try/catch around registration (the slot is one-per-type — a future official `user/message` projection conflicts, and the plugin must not take the instance down). Every gate falls back to the framed user-role channel, which the durable events already carry — degrade means status quo, never a behavior change.
- **The channel is dormant everywhere today and self-activating.** No shipped host passes the fold probe (0.1.5 lacks the API; 0.1.6-alpha.1 fails the fold), so runtime behavior is byte-identical on both lines. A host whose fold composes projection with surface membership passes the probe and the feature lights up with zero code change — the probe tests semantics, not a version string.
- **Storage and append path untouched.** The restore append keeps its `restore-assistant` source mark and frame prefix; both channels share the one durable shape, sessions stay readable without the plugin, and `user/message` is official vocabulary so persistence is never at risk.
- **Dispose is doubly wired, safely.** The host's returned disposer is fiber-owned (upstream test: disposing the registering fiber unregisters) and cordis effect disposal is idempotent, so `ctx.effect(() => () => dispose())` adds an exact unregister-on-unload without a double-splice hazard.

## Alternatives considered

- **Register unconditionally when the API exists** — on 0.1.6-alpha.1 that silently removes every user message from the model context. Certain catastrophe, not a risk.
- **A custom log-only decision event** carrying the rewrite (the shape the fold actually supports) — third-party event types cannot persist: `Session.append` cannot set `ignorable: true`, and the persistence read path refuses unknown required types. The proposal's M0 already killed this; the fold probe re-confirmed the registration side.
- **Hijacking an official log-only vocabulary** (`session/title`, `hook/result`, …) for the decision event — persistable and fold-compatible, but it fights the vocabulary owner for the event stream, marks our projection "used" on every session that sees that event (hot-unload would then refuse derivation on *every* session), and the proposal explicitly forswears it.
- **Version sniffing instead of the behavioral probe** — the composing fold exists in no released host, so there is no version to key on; the probe keys on the exact semantics required and flips itself.

## Consequences

- **Runtime behavior is unchanged on every shipped host.** Both degrade gates that can fire today (missing API on 0.1.5, non-composing fold on 0.1.6-alpha.1) leave the framed user-role channel byte-identical; the projection module and its tests are the whole of the change's observable surface, plus one log line per boot on hosts that degrade.
- **The channel activates without a code change** on the first host whose fold composes projection with surface membership — which is also the activation's danger point: the probe is the only thing standing between that host and a role rewrite the provider adapters have never seen (the proposal's M2 acceptance risk).
- **Upstream**: the fold must compose the `project` plan with surface membership for surface-eligible types (append the node, then apply returned rewrites) before the channel can activate. Until then S12 stays "待实施" in spirit — the seam registry entry and the proposal's M0 section overstate the mechanism's readiness and should be corrected by whoever owns the wave docs.
- **When the probe flips green**, `tests/restore-projection.host.spec.ts`'s host-reality pin (`reports false on the 0.1.6-alpha.1 fold`) turns red on purpose — re-verify end to end (withdraw → restore → derive assistant-role; withdraw → restore → withdraw round-trip; session reopen re-derivation; provider adapter tolerance of adjacent assistant roles) before flipping it.
- **README / `dsh.compat` notes** for the new degraded item are deliberately left to the wave's compatibility-labeling pass.
