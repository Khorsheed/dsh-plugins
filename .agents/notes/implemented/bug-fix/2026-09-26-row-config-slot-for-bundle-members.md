# Agent Note: family-bundle members register their settings card on the row-level slot (`plugins.row.config`)

Status: implemented

## Problem

Family bundling moved the member packages out of the profile's direct dependencies: installing `@khorsheed/dsh-bundle-local-agent` or `@khorsheed/dsh-bundle-conversation-toolbox` applies the bundle's patch (which re-mounts the members' rows verbatim) while the members arrive as transitive dependencies. The Plugins page opens a detail view only for a DIRECT dependency, so a member's settings card — each provider's login/auth surface, context-guard's threshold editor — registered on `plugins.bundle.config` under the member's OWN package name had no page to live on: the member detail view was gone and the bundle's page knew nothing about the card. The card became homeless precisely in the install shape the family bundles exist to promote.

## Decision

Each affected member gains a third settings-surface registration track in its client apply, between the standalone track and the 0.1.5 legacy track:

- **standalone install** — `plugins.bundle.config` keyed by the member's own package name (its own detail view), unchanged;
- **family-bundle install** — `plugins.row.config` keyed `<bundle package>#<row id>`, the row id exactly as the bundle's `cordis.patch.yml` declares it (the host's `rowConfigKey` shape; the bundle's detail page then shows a per-row configure entry that opens the card headed by the plugin's title and description);
- **0.1.5** — the legacy `settings.plugin.item` card, unchanged.

All three ride `slots.inject`, so a track fires only where the host declares the slot (a 0.1.5 host skips both alpha.2 slots; a host without the bundle installed never sees the row key rendered — the registration is inert data). Component, `locale`, and `inject` are reused verbatim from the existing tracks — no new UI. The bundle package name each key embeds is a data-only cross-package mention, declared in the member's `dsh.references` (the sanctioned declaration seat; pack-dist's family-edge check honors it).

The five members and their keys: the four local-agent providers (claude-code, codex, kimi, dsh) under `@khorsheed/dsh-bundle-local-agent#<row id>`, and context-guard under `@khorsheed/dsh-bundle-conversation-toolbox#context-guard`.

## Alternatives considered

**Keep the members as profile direct dependencies alongside the bundle.** Rejected: that defeats the family bundle's one-card install and recreates the duplicate-row-id collision the bundle's verbatim re-mount exists to own.

**Ask the host to open detail views for transitive dependencies.** Rejected: an upstream change for something the host already designed a seam for — the row-level slot IS the designed answer (the bundle owns the page; rows own their config), and the upstream-change pipeline is for missing seams, not for declining existing ones.

**Consolidate the members' cards into one bundle-level config page.** Rejected: the cards are per-provider surfaces with different auth flows (claude-code's manual handoff, codex's device code, dsh's host credentials); merging them into one page would lose the per-row identity the host renders (title/description per row) and couple the members' UIs for no behavioral gain.

## Consequences

Bought: each member's settings card is reachable in both install shapes — its own page when standalone, the bundle's page with a per-row configure entry when family-installed — while the 0.1.5 line is untouched. The pattern is now written down for any future bundle member with a settings card: register on `plugins.row.config` keyed by the bundle's declared row id, declare the bundle in `dsh.references`.

Cost: five packages carry one more inert-when-unrendered registration and one references entry; the row key duplicates the row id string from the bundle's patch (a rename there must move the key — no mechanical check ties them today).

## Testing

Each package's existing client-apply spec gains the row-track assertion: the four local-agent providers' `client-apply.spec.ts` fake-registry describe (renamed to the three-track reality) pins `{ name: 'plugins.row.config', key: '<bundle>#<row>' }`; context-guard's real-SlotRegistry spec boots with the `plugins.row.config` slot declared and asserts the registration appears under the conversation-toolbox key and is removed with the fiber.

## Related

- [Family bundles and collections (proposal)](../../../proposals/active/2026-09-24-family-bundles-and-collections.md) — the bundling decision whose row re-mount created the homeless-card shape.
