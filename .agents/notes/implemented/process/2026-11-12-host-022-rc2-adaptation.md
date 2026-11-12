# Agent Note: host 0.2.2-rc.2 adaptation — two waves, not one release

Status: implemented

English | [中文](2026-11-12-host-022-rc2-adaptation.zh.md)

## Problem

Host 0.2.2-rc.2 is 1568 commits beyond the rc.1 tag used by this repository. It changes activation and Session append contracts and adds several capabilities that overlap community plugins. Treating it as a mechanical dependency bump would miss real breakage; treating every similar official surface as a reason to replace a package would mix migration, feature loss, and product changes into one unsafe release.

## Decision

Use two waves. Wave one upgrades the exact rc.2 development and workflow baseline, preserves current behavior, and migrates only interfaces with a working legacy fallback. Wave two handles capability integration, persisted-data migration, and retirement independently, recorded in `proposals/active/2026-11-12-host-022-rc2-official-capabilities.md`.

The development pins, lockfile, and both fixed workflows use `dsh-v0.2.2-rc.2`. CI uses Node 24.9. Existing `^0.2.2-rc.1` peer ranges already include rc.2, so package manifests are not mechanically rewritten and minimum hosts do not move without a required new API. `verifiedHost` advances only for packages with actual verification. All 19 Remote packages declare the rc.2-required `lib/typert.remote-client.d.ts.map` alongside the generated declaration and publish `src/`, matching the official source-navigation payload. `pack-dist` preserves that generated map while pruning ordinary sourcemaps and incremental state, and verifies that every referenced source is inside the tarball.

Local-agent carries the new flat activation `prompt` and `parent` alongside the legacy nested `request`, preserving caller delivery, resume handles, and cancellation. Its child-log guard forwards non-relational batches through the official batch append and applies relationship repair in order to batches containing relational events. TaskPilot and Room preserve the legacy parent id in a structurally typed user authority that rc.2 also accepts. Ankh Guard uses `AgentRegistry.list()` filtered to non-subagent roots and retains a `roots()` fallback for older hosts and legacy fixtures.

Inline HTML cards register the `dsh-card` language into `conversation.chat.markdown.fence`. Streaming renders the official child code block; settling mounts the existing sandboxed iframe. The same iframe lifecycle is shared with the legacy DOM renderer used when the slot is absent. The authoring protocol, CSP, bridge, resizing, and link routing do not change.

The seam audit uses `appendPluginRecord` for versioned, ignorable `plugin:*` records that persist without entering the model surface. A real JSONL round trip verified this channel for future eval notifications and file-preview facts. It does not make restored assistant messages legal model input; the restore projection probe remains false and its current role fallback stays.

No whole package retires in wave one. `client-session-title-edit` is the only near-term whole-package retirement candidate, subject to the wave-two browser comparison. MCP transport migration must preserve per-tool toggles and cannot run two bridges with the same names. Room, Context Lens, Transcribe, Worktrees, Local Files, and Ankh Guard keep their uncovered responsibilities.

## Alternatives considered

**Upgrade everything and integrate every official capability in one release.** Rejected: activation and append are compatibility work, while MCP settings migration, worktree cleanup, native Team, and title UX are separate risk and product decisions.

**Raise every minimum host and delete all compatibility branches.** Rejected: the activation payload, fence slot, registry, and interrupt authority all have small working compatibility paths. Only a genuinely required new API may move a floor.

**Replace packages with whichever official feature has a similar name or panel.** Rejected: Stats, Team, Speech, and Forge do not cover the request detail, external CLI collaboration, long-audio diarization, or general worktree management already shipped here.

**Drop MCP per-tool switches during the manager migration.** Rejected: the official manager lacks per-tool allow/deny and OAuth. Migration must preserve existing toggles or wait for an equivalent capability and must never double-register a server.

**Use plugin records for every old custom event or restored assistant message.** Rejected: plugin records never enter the model surface. They fit log-only notifications and facts, not model-visible input.

## Consequences

The compatibility branch remains uncommitted in its own worktree; no production deployment, npm publication, push, or whole-package removal is implied. Second-wave work has explicit owners, migrations, retained behavior, acceptance, and retirement gates. The MCP per-tool migration and title-edit retirement are not presented as completed decisions.

The rc.2 full gate and real-composition acceptance are the final evidence boundary. Package compatibility metadata advances only after those checks cover the relevant package. A clean rebuild must not reuse rc.1 TypeScript caches.

## Testing

Completed on rc.2: 59 local-agent files / 597 tests; 18 local-agent-dsh files / 246 tests; 62 Room files / 736 tests; 93 TaskPilot tests; 245 Ankh Guard tests; 408 script/package-convention tests; and 41 inline HTML tests covering slot registration, streaming/settling, disposal, and the legacy DOM path. The real Subagent Runtime accepted the compatibility activation on success and cancellation. A real rc.2 Chromium composition rendered the authored card through the official fence slot with `sandbox="allow-scripts"` and zero page or console errors. A real JSONL plugin-record round trip showed `ignorable: true` and zero model-surface nodes. The 42 pack-dist tests cover generated-map retention and source-target validation; the real Room tarball contains both `lib/typert.remote-client.d.ts.map` and `src/index.ts`.

The final clean rc.2 gate passed all 17 steps in 638 seconds: every package suite and all 42 packed bundles passed, including Remote declaration-map source validation. Full-tree hygiene found zero issues, and all 914 bilingual pairs remained in sync.

## Related

- [Host 0.2.2-rc.1 adaptation](2026-11-04-host-022-rc1-adaptation.md)
- [Second-wave capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [Upstream seam registry](../../../../docs/upstream-seam-registry.md)
