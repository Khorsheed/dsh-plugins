# Agent Note: quote — the selection menu's actions are a contribution registry (ctx.quoteActions)

Status: implemented

## Problem

The quote plugin's selection menu shipped M1 with a hardcoded action list: a closed `'conversation' | 'sidechat' | 'copy'` union assembled inside the component (`packages/quote/src/client/SelectionMenu.tsx`). Every new delivery target — save-as-canvas-card, quote-into-a-new-session — would mean editing the quote package itself, and the menu could never learn a row from another plugin at runtime. The question surfaced as "is quote too coupled, and should it be split into a bridge package other plugins register through?" The measured facts said otherwise: quote has zero inbound dependency edges, and the actual duplication in the repo is the thin side-chat bridge (`ctx.get('sideChat')` → `openWith`) implemented three times — quote's `quote.addRef` verb, dsh-reader's `reader.quoteToSideChat`, canvas's `SideChatMirror` — per the deliberate-duplication convention, not through any fault of quote's coupling.

## Decision

**One standalone package, built-in defaults, a registry as the growth seam.** Quote keeps its three built-in rows and adds a client-side contribution registry provided as `ctx.quoteActions` (the ui-shortcuts `ctx.shortcuts` precedent: `packages/ui-shortcuts/src/client/contract.ts`), so other plugins contribute menu rows without the quote package learning anything about them.

- **The contract** (`packages/quote/src/client/registry.ts`, exported from `@khorsheed/dsh-quote/client`): `registerAction({ id, label, icon?, available?, run }) → disposer`. Ids follow `<plugin>.<action>` and duplicates throw at registration. `label` and `available` are re-evaluated at every menu open (no caching), so a contributor's locale switch or state change lands on the next open.
- **The target stays opaque**: `{ text, label, sessionId }` — the selected plain text, the best-effort source label, the current session id (possibly `undefined`). The registry never learns where an action delivers to — the same opacity rule the quote payload itself follows.
- **Built-ins do not dogfood.** The three built-ins stay in the component: they bind component-level state (the session store via `useSessions`, the quote locale namespace via `PropsLocale`), which an apply-time closure cannot reach. ui-shortcuts can dogfood because its Settings surface resolves locale seats itself; our menu's locale binding is component-level. Contributed rows render after the built-ins in registration order.
- **Provided first.** The registry is `ctx.provide`d at the very top of the client apply, before the Remote mount, so a consumer applying immediately after probes successfully. Registration is boot-time: a consumer whose apply runs before quote's probes `undefined` and stays silent — the standard degrade, documented in the README.
- **Failures are wrapped at registration**: a throwing `label` degrades to the id, a throwing `available` hides the row, a throwing `run` is swallowed — each reported through the provider's logger, none reaching the menu.
- **The menu subscribes** through `useSyncExternalStore`; the runtime's `list()` keeps its reference between mutations so it serves as getSnapshot directly, and a hot-added row appears in the same frame.
- **Consumer discipline** (README-documented): in-repo consumers `ctx.get`-probe + structurally mirror + declare `@khorsheed/dsh-quote` in `dsh.references`, never import, never inject; external npm consumers may import the contract types. The `QuoteMenuInjected` face carries the feed (`actions: QuoteActionFeed`), so composed-props tests drive contributions through the real runtime.

## Alternatives considered

**Split quote into a bridge package (registry core + a separate defaults package).** The bridge without defaults is an empty shell — nothing user-visible installs from it — and the repo has the cautionary precedent: `ctx.shortcuts` shipped "any plugin can contribute" and has zero consumers to date. The split would also cost a new sanctioned edge in `check-plugin-independence`'s allowlist and a core/companion install story, buying nothing the in-package registry does not.
**Ship the registry empty (community registers everything).** The built-in rows are the product: quote-to-current-chat plus copy need only the official host, and they are what the acceptance flow exercises ("select → menu → quote lands in composer"). An empty registry installs to a menu with nothing in it and repeats the dead-registry pattern.
**Dogfood the built-ins through the registry.** Rejected above — the built-ins' inputs live in the component, and forcing them through apply-time closures would re-plumb `t` and session state for purity, not for a capability.
**Consumers wait for the registry (cordis `internal/service` hook or inject).** Cross-family inject of a community service is exactly what `check-plugin-independence` forbids, and the `internal/*` event is not a seam the repo sanctions; probe-at-apply with absent-means-off keeps every consumer honest.

## Consequences

- Canvas ("save as card"), dsh-reader, or any community plugin can add a selection-menu row with zero changes in quote; the README's "Contributing menu actions" section is the contract's public documentation.
- The cost is ordering sensitivity: registration is boot-time, so a consumer that applies before quote misses the registry for that boot (silent degrade). No in-repo consumer exists yet; the first one (canvas's save-as-card is the named candidate) must validate composition order in practice.
- Two action paths exist inside the menu (built-ins + contributed) — deliberately, per the dogfooding rejection.
- The three duplicated side-chat bridges stay duplicated; the registry does not absorb them (they are host-to-host seams, not menu rows), and the deliberate-duplication convention already owns that trade-off.

## Testing

`packages/quote` — 44 tests green (32 pre-existing + 12 new). The new `tests/registry.spec.ts` pins order, duplicate-id failure, idempotent disposal with notification, list-reference stability, and the three wrapping rules. `tests/client.spec.tsx` gains the contributed-row matrix: render-after-built-ins ordering by `data-action`, run-with-target payload (`{ text, label, sessionId }`) plus menu close, per-open `available` gating with and without a session, and hot add/remove on an open menu through the real runtime.
