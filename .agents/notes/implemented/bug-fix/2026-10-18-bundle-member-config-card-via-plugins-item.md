# Agent Note: bundle-member settings cards ride plugins.item, gated on the served namespace

Status: implemented

## Problem

After the family/mode-bundle fold, member packages (the four local-agent providers, context-guard) kept loading as active Loader rows, but their settings cards vanished from the Plugins page. Both causes sit in the registration track, not the cards: `plugins.row.config` keys hardcoded one carrier bundle (`@khorsheed/dsh-bundle-local-agent#…`, `@khorsheed/dsh-bundle-conversation-toolbox#…`) while the rows are now carried by the mode packs, so the key never matches; and the 0.1.5 seat `settings.plugin.item` was deleted by the host (renamed `plugins.item`), so the duck-typed legacy `slots.inject` silently never fired. `plugins.bundle.config` keyed by the member's own package name never fired either — a bundle member has no per-package detail page.

## Decision

Each affected package registers exactly one card: a `plugins.item` list entry (the official companion convention — ui-settings-web-search and siblings), wrapped in `ctx.configForms.whileServed([<row id>], …)`. The Host serves a row's volatile Config under its row id on every install shape, so the card follows the served namespace: standalone install, family bundle, or mode pack all show the same card, and a composition without the row shows no trace of it. The gate rides a deferred `ctx.inject(['configForms'], …)` probe — the service is never statically injected because its name differs per host line — plus a `typeof forms.whileServed === 'function'` guard, so hosts without the service (0.1.5) or without the gate (0.1.6-alpha.2) render no card and nothing breaks.

The whileServed namespaces are the patch row ids (`local-agent-kimi`, `local-agent-codex`, `local-agent-claude-code`, `local-agent-dsh`, `context-guard`); the mode packs re-declare member rows under the same ids, so one string gates every carrier.

The card components are unchanged: the existing `*BundleConfig` components already switch on the `view` owner prop (`summary`/`page`) that `plugins.item` shares with the retired keyed seats, and their props types now read `PropsRuntime<'plugins.item'>`. context-guard's 0.1.5-only `ContextGuardSettingsCard` and its `ContextGuardSettingsCardProps` type are removed (dead with the seat); the providers' `*SettingsCard` components stay exported but are no longer registered anywhere — they remain for the component specs and direct composers.

minHost is unchanged: nothing throws on old lines, the card simply does not render before 0.1.7-alpha.1 (where `whileServed` landed). The degradation is recorded in each package's README Compatibility section and `dsh.compat.notes`.

## Alternatives considered

- **Fix the `plugins.row.config` keys**: rejected — the key is `<carrier package>#<row id>` and the carrier is now every mode pack at once; a member cannot enumerate its carriers, and re-hardcoding the mode packs recreates the same coupling.
- **Keep `plugins.bundle.config` for standalone installs alongside `plugins.item`**: rejected — a standalone install would render the card twice (the Official-group card and the bundle detail page), and the official convention is one `plugins.item` entry per namespace.
- **Keep the duck-typed `settings.plugin.item` arm for 0.1.5**: rejected — the seat exists only on 0.1.5, which prod no longer runs; carrying a string-typed registration for one retired line is exactly the drift that hid this bug.

## Consequences

- Bundle members' cards render on the Plugins page again on 0.2.1 (and any host ≥ 0.1.7-alpha.1), under every carrier composition, and disappear cleanly when the row is composed out.
- 0.1.5 and 0.1.6-alpha.2 lose the settings cards (every other surface unchanged); recorded as a compat note per package.
- Community `plugins.item` entries use orders 100–140, after the official settings pages (10–40).
- Tests pin the gate: a served namespace yields exactly one `plugins.item` entry; an unserved namespace or a configForms-less host (0.1.5) yields none.

## Testing

Per-package `build` + `test` against the 0.2.1 host tree (`DSH_HARNESS=deepseek-harness-021`): the rewritten client-apply specs (providers) and browser-plugin spec (context-guard) cover the gate's three states plus fiber teardown; the component specs are unchanged except for dropping the removed context-guard 0.1.5 card. Repo gates `check:plugins` and `test:scripts` green.
