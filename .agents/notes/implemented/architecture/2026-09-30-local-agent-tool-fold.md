# Agent Note: the local-agent delegation tools fold into each provider's `./tool` composition entry

Status: implemented

## Problem

The family shipped its delegation tool as a shared companion package, `@khorsheed/dsh-local-agent-tool-subagent`: one module mounted three times at the profile root (once per CLI provider, with `provider`/`toolName` config), plus a dynamic fourth mount by local-agent-dsh's settings toggle. Two costs kept accruing:

1. **One provider was two cards' worth of rows.** Each provider's bundle patch inserted its provider row AND a tool row naming the shared package, and bundle-local-agent re-mounted the union verbatim — the plugin inventory showed the tooling as separate rows from the provider they belong to, and every composition layer (provider patch, family bundle, dev preset, web-eval overrides) repeated the same three row stanzas.
2. **The profile-root mount defeated per-session granting.** A root row grants every session; the eval deployment could only seal the tools with `tools: none` override rows (a config switch that existed solely for that seal), and the dev preset's copy of the rows was redundant duplication of what the provider patches already mounted.

The worktrees 0.3.0 and room 0.2.0 folds had already proven the target shape: the tool row ships inside a package as a `./tool` subpath composition entry, and an agent preset names it to grant the tool per session.

## Decision

The 2026-09-30 family fold, in four moves:

1. **The factory moves into the family core** as `@khorsheed/dsh-local-agent`'s `./tool-factory` export (`packages/local-agent/src/tool-factory.ts`): `mountSubagentDelegationTool(ctx, config, owner)`, the `subagentToolConfigSchema(provider, toolName)` schema helper, `SubagentToolConfig`, and `RESUME_HINT_PREFIX`. The tool-origin tag's `owner` is now an explicit PARAMETER supplied by the calling entry (its own `PACKAGE_NAME`) — the shared module hardcodes nothing (AGENTS.md § Tool origin tagging). The `tools: all | none` config knob is **gone**: its only consumer was the web-eval profile-root seal, which the fold makes unnecessary (unnamed-by-any-preset IS the seal).
2. **Each CLI provider gains its own `./tool` composition entry** (`packages/local-agent-{kimi,codex,claude-code}/src/tool.ts`): `name` / `inject = ['tools', 'subagents', 'localAgent']` / `Config` with all-optional fields defaulting to that provider's own `provider`/`toolName` / `apply` delegating to the factory. The declared `localAgent` inject keeps the row pending until the profile's core row provides it (the 2026-09-27 boot-order lesson). Provider patches now mount exactly ONE row — the provider itself; the codex/claude-code patches keep their bare disables of the official `tool-subagent-codex` / `tool-subagent-claude-code` rows (the family keeps those model-facing names).
3. **Compositions repoint, row ids unchanged.** The dev preset (both `packages/presets/cordis.patch.yml` and `profiles/dev/presets/dev/agent.cordis.yml`) names `@khorsheed/dsh-local-agent-{kimi,codex,claude-code}/tool` with NO config under the same row ids (`tool-subagent-kimi`, `tool-subagent-codex-local`, `tool-subagent-claude-code-local`), so composition state is unaffected. bundle-local-agent drops the three tool rows (staying the exact union of member rows) and the retired package leaves its dependencies. web-eval deletes its three `tools: none` overrides outright — the eval preset simply names no `./tool` row.
4. **`@khorsheed/dsh-local-agent-tool-subagent` is retired entirely** — not kept as a deps-only library: the package directory is deleted (the room-tool/worktrees-tool convention), the name joins `scripts/retired-packages.ts` (check-profile-bundles now fails any in-repo composition naming it), and local-agent-dsh's toggle-owned dynamic `subagent_dsh` mount rewires to the same factory via an inline plugin object with owner `@khorsheed/dsh-local-agent-dsh`.

Versions: the family moves in lockstep to `0.2.0-rc.1` (the release-group line; also absorbs local-agent-dsh's rc.9 skew), bundle-local-agent to `0.2.0`, presets to `0.3.0`.

## Alternatives considered

**Fold the tool into the CORE's own `./tool` entry (one shared row, `provider` still required config).** This was the shape the 2026-09-12 decomposition review (docs/acceptance/plugin-decomposition-review-A-round2-2026-09-12.md) upheld when it was proposed then — boundary consistency won over one fewer publish unit. It loses now for the reason the maintainer settled: a core-owned row can never self-default its `provider` (the core serves all four providers), so every preset row would still carry config, and the "one provider = one card" goal would still leak a separate tool row at the profile root or a shared card in the inventory. Per-provider entries make each preset row config-free and keep the tool's ownership where the provider lives.

**Keep the shared package as a deps-only library (no row of its own, providers import it).** Rejected: the package would remain a publish unit with an invariant companion, README pair, and release-group seat whose entire content is one module the core can host — the fold's whole point is that the factory is family-internal code, and the core package is where family-internal shared code already lives (member bridge, settings face, live stream).

**Keep `tools: all | none` for symmetry with datasets/mission's tool groups.** Rejected: those groups exist because one row there registers a dozen tools; this entry registers exactly one, and a preset that wants none simply does not name the row. A dormant-row config at the preset layer would be a switch with no consumer.

## Consequences

- One provider = one row = one card at every layer; the family bundle patch shrinks to the member union and the plugin inventory stops showing tool rows as separate entries.
- The eval deployment's seal is structural now: no `tools: none` override rows, no config to keep in sync — the tool is absent because the eval preset does not name it. `subagent_dsh` stays the documented exception (toggle-driven dynamic mount, default OFF).
- The tool-origin owner attribute moves from the retired shared package to each provider package (and to local-agent-dsh for `subagent_dsh`), so the capability catalog attributes the tools to the package whose card the user manages.
- Six family packages move to `0.2.0-rc.1` together; npm-side deprecation of the retired name is left to the publish wave, as with the earlier folds.
- check-plugin-independence's `NO_OWN_PATCH`/`ALLOWED_EDGES` and check-release-groups' family roster drop the retired package; its spec fixtures were re-pointed at the post-fold shape so the row-id and family-union rules stay pinned.

## Testing

The retired package's suite moved with the factory to `packages/local-agent/tests/tool-factory.spec.ts` (mount/unmount lifecycle, resume-handle resolution and rejection, registry stop lever, the caller-supplied origin tag), with the three `tools: none` cases dropped alongside the knob. Each provider's `patch.spec.ts` pins the single-row patch and the absence of the retired name; the presets spec pins the new config-free `./tool` rows under the unchanged ids; the bundle spec re-derives the member union. Gates: full `pnpm run build` and the touched packages' tests, `pnpm check:plugins`, `pnpm check:profiles`, `pnpm test:scripts`, `pnpm check:hygiene`.

## Related

- The fold pattern this follows: worktrees 0.3.0 / room 0.2.0 (commit `7a0e1541`), themselves the canvas `./agent` precedent.
- The boot-order lesson the `inject` declarations encode: [preset-composed tool rows declare their core service as an inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.md).
- The seal this replaces: the web-eval `tools: none` switch (T27), recorded in profiles/web-eval/docs/iterations.md and the [eval-preset note](../process/2026-09-08-web-eval-agent-preset.md).
