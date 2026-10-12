# Agent Note: capability-catalog refactor batch 1 — dead surface, one containment helper, reconcile gate, mode-scoped bundle reads

Status: implemented

## Problem

An internal audit of `@khorsheed/dsh-capability-catalog` found five issues:

1. Dead surface. The handwritten `CapabilityCatalogRemote` interface in `types.ts` was stale against the generated typert remote map and referenced nowhere (the client binds `TypertRemoteNamespaceMap['capabilityCatalog']`); `hasUnconfiguredCredentials`, `finalizeTools`, and the `_SECRET_REF_PREFIX` re-export in `mcps.ts` had no callers; `McpStore.reconnectAll`/`errorOf` had no callers, and the `StoredServer.error` field was written on every discover but read by nothing; the `mcpList` Remote was registered while the card reads only `mcpSnapshot`.
2. Two bundle-file readers with divergent containment. `readSkillFileContent` (skills.ts) checked `full.startsWith(bundleDir)` — no symlink resolution, no separator boundary — while `readBundleFile` (scoped-delivery.ts) carried the stronger sanitize + realpath double-containment inline.
3. The `resolveConfigSecrets` callback was verbatim-duplicated between `McpStore.discover` and `McpStore.callTool`.
4. `ScopedSkillDelivery.reconcile()` fires concurrently from the filesystem watcher, the `agent-preset/selected` event, and the management Remotes; two overlapping passes could both decide one preset has no registration and each register a provider for it.
5. The client lost the open-detail mode when reading a bundle file: the card typed the modal's `readSkillFile` prop as `(name, path)` and never said which mode the detail was read at, so in the preset compare view a bundle file of a skill only a non-default mode loads read as missing (managed skills survived on the fallback definition; plugin/runtime ones did not).

## Decision

Five commits, items 1–3 zero-behavior-change, items 4–5 the bug fixes:

1. Dead surface removed after a whole-repo grep confirmed each symbol unreferenced. For `StoredServer.error` the choice was deletion over threading: the client MCP model (`McpGroup`, manage modal) has no error surface, and carrying the field to the browser would have touched the wire type, `mcpSnapshot`, the group model, the modal, and the locale tables for a state nothing asks for.
2. `resolveBundleTarget(bundleDir, safe)` in skills.ts is the single containment implementation both readers share: the already-sanitized bundle-relative path resolves against the bundle's realpath and must equal it or sit under a separator-terminated prefix of it. Symlink escapes and sibling-prefix lookalikes (`bundle-evil` vs `bundle`) read as absent on both paths now.
3. `McpStore.secretResolver(serverName, server)` is the single callback; both connect paths bind it.
4. `reconcile()` is gated on the `shellEnv.ts` shape — one in-flight promise plus one queued flag — so at most one pass runs and every trigger arriving during it coalesces into at most one rerun. A caller that finds a pass in flight waits for the chain its flag provoked, so an awaited reconcile still reflects the write that triggered it (the pass re-reads policy and files from scratch, so a rerun loses no update). The old body lives on as `reconcileNow()`.
5. The card records `readModeFor(name)` when it opens a detail and the modal forwards it to `readSkillFile(name, path, presetId)`; the host Remote already accepted the parameter.

Specs: the containment refusals (symlink escape, `..`, sibling prefix) are pinned at the helper level and through both readers; the gate is pinned by holding a pass open behind a gated roster — three concurrent triggers produce exactly two passes, never overlapping; the client fix is pinned in both views (a preset view, and the compare view reading at the mode that actually loads the skill). Tests went 254 → 262.

## Alternatives considered

**Thread the MCP connect error into the manage modal instead of deleting it.** Rejected: a wire-type + snapshot + model + modal + locale change for a state with no consumer; the Discover button already re-reports a failure by refreshing. If a real need appears, `discover`'s catch is the one place to re-add it.

**Joiners return when the in-flight pass completes rather than awaiting the queued rerun.** Rejected: `presetScopeSet`/`Adopt`/`Release` re-read `presetScopeStatus` immediately after awaiting `reconcile()`; returning after the older pass could answer with pre-write state, a staleness the pre-gate code never had.

**A new module for the containment helper.** Rejected: skills.ts already owns `sanitizeBundlePath`/`collectSkillFiles`, and scoped-delivery.ts already imports both from there — one more export fits the local idiom.

**Dedupe providers at registration instead of gating reconcile.** Rejected: a make-idempotent registration would hide other overlapping-pass interleavings (drop vs register ordering); the gate removes the whole class and matches the proven shellEnv shape.

## Consequences

The Remote namespace loses `mcpList` (the regenerated typert map is now the only Remote description); the deleted helpers narrow the public surface of `./src/*` exports — a repo-wide grep showed no consumer, but a hypothetical external reader of `./src/mcps.ts` internals would break. Bundle reads on both paths now refuse symlink escapes they previously served. The reconcile gate serializes what was concurrent, so a burst of triggers costs at most two passes; the trade-off is that a Remote-triggered reconcile can now wait behind a watcher-triggered one. `pnpm check:hygiene` and the package build+test gate pass on every commit.
