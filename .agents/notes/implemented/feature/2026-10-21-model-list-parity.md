# Agent Note: One shared「Available models」section and models.json for codex and kimi

Status: implemented

English | [中文](2026-10-21-model-list-parity.zh.md)

## Problem

The claude-code harness shipped the curated「可用模型」interaction (an ordered shortlist persisted as `<scopedHome>/models.json`, first entry = the default model, an add dialog fed by the endpoint's served catalog), but codex and kimi still had the older card UX: a free-text `model` field with recent-model suggestions and a chevron menu. Three harness cards with two different model-editing interactions reads as inconsistency, and the free-text field lets a user pin a model the endpoint does not actually serve.

## Decision

One implementation serves all three cards; nothing per-harness remains to drift:

- **Core** (`packages/local-agent`): `src/model-list.ts` holds the harness-neutral `models.json` read/write helpers (moved from claude-code, keyed by scoped home alone), exported from the package root. `src/client/ModelListSection.tsx` is the whole「可用模型」section — block chrome, ordered rows with drag-to-reorder and per-row delete, the add dialog over the endpoint catalog, and its own state (list read on activate, immediate writes, catalog re-read when a `directoryRefresh` token moves, e.g. after a credential save). Copy lives in the core dictionary (`models.*`), passed as the core-namespace `t` like `ProviderAuthBlock`'s `authT`.
- **Companions** (claude-code, codex, kimi): each card renders `<ModelListSection>` over two faces (`modelList` read/write, `modelDirectory`) backed by the existing gateway Remotes; the free-text field, suggestion menu, and the `harnessModel`/`renderModelPicker` card faces are gone. The volatile `model`/`recentModels` config keys stay — they remain the fallback chain and the member picker's vocabulary.
- **Resolution chain** (codex + kimi, mirroring claude-code): the settings layer becomes `firstModelOf(models.json) ?? model config key`, folded at the wiring so every consumer rides it unchanged — per-round spawn argv (the providers' model resolver now receives the round's scope), the live driver's spawn binding, the broker's settings layer (the broker passes the member's scoped home, so a named scope reads its own list), and the eval snapshot's `effectiveSettings.model` (read from the snapshot's own scoped home). The broker's choice vocabulary treats a non-empty list as COMPLETE (nothing outside the endpoint's catalog sneaks into the member picker); an empty list falls back to the pre-list chain untouched.

## Alternatives considered

- Duplicating the claude-code editor component into codex and kimi. Rejected: three copies of the same drag/dialog logic would drift the moment one is patched — the user's ask was consistency, and one core component is the only answer that stays consistent.
- Moving only the stateless editor and keeping per-card state. Rejected: the state slice (read-on-activate, write-through, catalog refresh on credential save) is exactly where subtle behavioral differences would hide; the section owns it.
- Migrating existing `model`-key values into a seeded models.json on upgrade. Rejected: the empty-list fallback chain already answers with the same model, so a migration would only write a file that then shadows a later config edit — the user's explicit first pick is what belongs in the list.
- Seeding the add dialog from recent models or config discoveries. Rejected (as claude-code already decided): the list's value is that it can only hold what the endpoint serves.

## Consequences

- codex and kimi cards lose the free-text `model` field and the effective-model line; the `model` key keeps working silently as the fallback (YAML, API writes), and `/<name> status` still reports the effective settings.
- `CodexModelBrokerDeps.settingsModel` and the kimi broker's equivalent now take the scoped home; both providers' model resolvers take the round's scope. Named scopes (evaluation containers) read their own `models.json`, exactly like their own endpoint credential.
- The eval condition hash changes when a list exists (the `model` factor reports the list's first entry) — intended: the model IS the fairness factor, and a frozen run's read-back still catches a mid-run edit as misattributed.
- claude-code deletes its local `model-list.ts`, `ModelListEditor.tsx`, the `models.*` locale keys, and the editor CSS — its card and behavior are byte-identical, now rendered from the same core component the other two use.
- The dsh harness still has the old free-text field: its models spell `provider/model` against the HOST's own model selection, so the endpoint-catalog dialog does not map; parity there needs a host-model directory first.

## Verification

- Core: `tests/model-list.spec.ts` (moved store tests) and `tests/model-list-section.client.spec.tsx` (rows, default chip, delete, drag-reorder, the add dialog, inactive gating, refresh-token re-read) — 391 tests green.
- claude-code: unchanged behavior over the shared component — 255 green; its card spec keeps one wiring test over the injected faces.
- codex/kimi: card specs rewritten to the section wiring; broker specs pin the curated vocabulary (complete when non-empty, untouched when empty) and the scoped-home settingsModel — 233 + 244 green.
- `pnpm check:plugins` clean; the full build is green in dependency order (core → companions).
