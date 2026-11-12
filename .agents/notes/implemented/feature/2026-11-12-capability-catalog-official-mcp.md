# Agent Note: migrate unfiltered MCP servers without losing per-tool control

Status: implemented

English | [中文](2026-11-12-capability-catalog-official-mcp.zh.md)

## Problem

The capability catalog used a fresh SDK connection for discovery and every tool call. Host 0.2.2-rc.2 supplies a persistent MCP manager with Settings-owned configuration, probing, reconnection, rich results and credential updates. Replacing the catalog outright would discard its paste/import flow and per-tool toggles, while running both bridges would duplicate model tools.

## Decision

Use `mcpManager` only when it, Settings and tools are available. Migrate each enabled server whose tools are all enabled. Persist a versioned ownership record and the original configuration in the catalog's settings. Convert each legacy `secretRef:` into a deterministic, provider-safe `${credential:...}` reference, retaining distinct env, header and query values. User configuration goes through `settings.update` / `mutate`, never through the manager's plugin-lifetime `register()`.

Write the official entry disabled, probe it, then mark ownership and enable it. A failed migration restores previous credentials and the legacy connector. Existing different same-name entries remain foreign: the catalog does not replace or shadow them. Tools are read from the official registry, using its normalized-name hash rather than the legacy hash for non-simple names. Original catalog state remains for rollback, including its credential values; official configuration contains references, not those plaintext values.

The official manager has no per-tool filter. Disabling one tool disables the official server, waits for its registrations to unmount, and returns that server to the existing connector. Restoring all tools permits another migration. Other hosts, missing capabilities and existing filtered servers retain the legacy path.

Bind the credentials provider when it arrives. If manager startup raced it and failed to load, a successful probe now permits a restart; ordinary outages remain under the official reconnect policy. Editing, removal and external rollback share the migration queue so an older task cannot recreate a deleted entry. Identical official tool metadata does not write Settings again.

## Alternatives considered

**Use `mcpManager.register()` for everything.** Rejected: that is a plugin-lifetime contribution, not the user's Settings document.

**Drop the old connector and per-tool switches.** Rejected: the official manager has no equivalent per-tool policy. The old bridge is now limited to that difference and hosts without the manager, not duplicated for healthy migrated servers.

**Migrate every server at boot, even disabled, filtered or incomplete entries.** Rejected: those states either express another policy or lack enough information to connect. They stay explicit in the legacy catalog rather than being silently changed.

**Delete old secrets immediately after copying them.** Rejected for this migration: per-tool fallback and probe rollback need the original values. Deleting a migrated server removes its official entry and generated credential references.

## Consequences

The catalog remains a separate capability and skill manager. The manager owns the live connection, reconnection, full tool registration and result projection for migrated servers. The legacy bridge retains its text-only limitation only where a per-tool filter requires it or no official manager exists.

Real tests cover migration and rollback, name normalization, foreign entries, credential rotation, late provider startup, a real stdio fixture, real Settings/Loader composition, restart recovery, tool filtering, rediscovery and removal. Production deployment and npm publication are not implied by this source change.

## Testing

The package's 23 test files / 313 tests pass on 0.2.2-rc.2, including two independent real-composition paths. The real fixture executes addition and credential-returning tools through official registrations, restarts the complete profile, switches between official and legacy ownership without duplicate names, and verifies Remote-driven removal and credential cleanup.

## Related

- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Official-capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [Upstream seam registry](../../../../docs/upstream-seam-registry.md)
