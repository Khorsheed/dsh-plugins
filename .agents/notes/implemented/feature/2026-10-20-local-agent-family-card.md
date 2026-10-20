# Agent Note: One「Local Agent Delegation」family card replaces the four per-harness Plugins-page cards

Status: implemented

## Problem

Each delegation companion (kimi, codex, claude-code, dsh) registered its own `plugins.item` settings card on the Plugins page (orders 110-140): four adjacent cards for what is one feature, each card repeating the same collapsible chrome. The family reads as a single capability — local CLI delegation — and its settings should read as one card with one section per harness.

## Decision

The core package's client owns ONE `plugins.item` entry, id `local-agent`, order 100 (ahead of the retired standalone orders), gated on `configForms.whileServed(['local-agent'])` — the core row's own served namespace, the same convention the companions followed for theirs. The entry renders `LocalAgentFamilyCard`: the `summary` view is the family one-liner; the `page` view stacks one collapsible section per registered harness, in their retired standalone-card order. Each section header carries the harness label, the shared `AuthStatusDot`, and a grey「CLI not detected」tag when the section's own status probe answered without `effectiveSettings.cliVersion`; the body mounts only while the section is expanded, exactly as the standalone cards behaved.

- **The registry lives on the `localAgentUi` service** (`registerHarnessCard(entry)` returning an unregister, plus `harnessCards()`/`subscribeHarnessCards()` for the card's `useSyncExternalStore`), backed by an in-memory `HarnessCardRegistry` (a version counter as the uSES snapshot, a cached sorted list for readers). Service-held, never module-held: every client bundle inlines its own copy of the core's sources, so a module export would give each bundle a private registry.
- **Sections come from the registry, never the gateway roster**: a registered card whose harness is absent host-side still renders, its body degrading to the auth block's 'unavailable' state exactly like the standalone card did.
- **Section render props are `{ active, useSessions }`**: `useSessions` is the root-scope global seat (ui-session's `GlobalStandardProps` merge) that the family card receives in its own plugins.item runtime props and forwards verbatim — the same seat the standalone cards consumed.
- **Companions branch at serve time**: inside the existing `whileServed` callback, `typeof ctx.get('localAgentUi')?.registerHarnessCard === 'function'` registers a section (the companion's new `<Harness>CardSection` — the `BundleConfig` page body minus the slot-owner share); otherwise the previous standalone `plugins.item` registration runs untouched. The probe sits inside the serve callback because that fires on the host's describe-mirror answer, a round-trip past client plugin boot, so a composed core has already provided the service.
- **The section render bypasses the slot renderer's `inject.hooks` materialization**, so each companion binds its scope's `useSettings` selector hook itself — a `useSyncExternalStore` over the scope's own subscribe/getSnapshot pair, the renderer's `bindSnapshotSelector` semantics.

## Alternatives considered

- **Roster join** (sections from the gateway's harness roster): rejected — the roster cannot name a card whose harness is absent host-side, and that degraded rendering is a requirement (the endpoint form is exactly how an absent-CLI harness gets configured).
- **A module-level registry export** shared by the bundles: impossible under the bundle-per-package client architecture — each bundle inlines the core's client sources, so only the cordis service is a shared instance.
- **Keep-alive sections** (bodies stay mounted with `active: false` after first expand): rejected for parity with the retired standalone cards, whose collapse unmounted the body; the draft-loss semantics stay identical.
- **The dsh enable toggle as a special case**: none needed — the switch writes the settings scope and the host mounts/unmounts the harness on the served value, which never interacted with the card chrome; as a section it behaves identically.

## Consequences

- The version matrix degrades to today's UI on every mixed path: an old companion on a new core keeps its standalone card; a new companion on an old or absent core registers its standalone card untouched; both new yield one family card with sections.
- The auth-status bus remains per-bundle (each client bundle inlines the core's sources): the family card's section dots read the card's own mount probes over the gateway `status(name, undefined)` Remote, one probe per section header mount — the same freshness semantics the standalone card headers had.
- The companions' locale meta titles and package cards are untouched — they feed the plugin-manager's package inventory, not this settings surface.
- Testing: the core gains `tests/family-card.client.spec.tsx` (registry ordering/replacement/subscription, section rendering, expand/collapse, the CLI-missing tag, the empty state) and family-card registration cases in `tests/browser-plugin.client.spec.ts`; each companion's `tests/client-apply.spec.ts` now covers the family registration, the old-core fallback, and the absent-core fallback, while the companion card specs pass unchanged.
