# Agent Note: host 0.2.2-rc.1 adaptation — executor split and compatible file effects

Status: implemented

English | [中文](2026-11-04-host-022-rc1-adaptation.zh.md)

## Problem

Host 0.2.2-rc.1 replaces the tool registry's native/PTC mode with independently mounted executors, changes tool dispatch to batches, removes the manual model-selection ref, and tightens Session publication and history projection lifecycles. It also adds `apply_patch`, whose presentation metadata omits Add operations and newly created Move destinations. The community needed an exact-source compatibility wave rather than a peer-range-only upgrade or an assumption that rc5 evidence covered these changes.

## Decision

Track `dsh-v0.2.2-rc.1` at `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` in development dependencies and both fixed workflows. Pin cordis 4.1.0, its matching loader/include 1.1.0 pair, and schemastery 3.19.0. Use one schemastery 3.19.0 across rc1 and the legacy 0.1 preset fallback, whose `^3.18.1` dependency already permits it. Extend official peer ranges without advancing every package's minimum host.

The DSH sub-profile removes `tools.config.mode`: native is the default, `DSH_TOOLS_MODE=ptc` selects PTC, and an unknown mode mounts neither executor. `local-agent-dsh` and its headless bundle floor at rc1 because the same patch cannot preserve the older `tools.mode` PTC path. The parent local-agent core instead probes the public `executable` method: rc1 dispatches a batch while older hosts retain the single-call path.

Model selection moves provider, model, and reasoning effort into `agentOptions`. Test compositions mount the official Session projection registry and await asynchronous service initialization; manually entered Sessions are announced before appends. `context-lens` passes the presentation value through generically, so its observer works with both the old complete assembly and the new pre-tool presentation.

File-preview uses the official `dsh-fs-patch` parser and pure hunk updater, loaded optionally so older hosts do not fail module evaluation. Add operations recover their content after successful outcomes. Update/Delete retain real result diffs. A Move destination missing from metadata is reconstructed from the source text when the official updater proves the result; a newly created destination has no old text and zero removed lines. Absolute metadata paths map back only to a unique patch path suffix. Stopped or failed commits never invent creations. Remote and direct read surfaces share the same fold and optional parser.

Mobile's existing public Session and presentation contracts pass the initial rc1 build and suite without source changes. Real-device and full browser checks remain separate from that mechanical result. After comparing an official-only rc1 instance with the combined composition in Chat, the user chose the community quote interaction everywhere. A keyed `quote` slot registration at priority -1 shadows only the official basic Chat button, independently of plugin order; the community selection menu, chip, source preview, side chat, copy, and extension actions stay unchanged. The official input machine remains in use. A dedicated delete action for quote blocks is a separate later project, not part of this wave. Host 0.2.2 also folds `list_agents` into `tool-subagent-control`. The four mode presets and the eval canonical enable the legacy standalone row only when its export exists, preserving old-host behavior without duplicate registration or a higher floor. Forge, Stats, Team, Speech, and other official-capability integration waits until after rc1 acceptance on 3080.

## Alternatives considered

**Raise every package's minimum host.** Rejected: local-agent's public capability probe preserves the older parent-side call path, and file-preview's optional parser preserves old behavior where the host cannot parse patches. Only the DSH sub-profile packages need the new floor.

**Write a local patch parser or count all metadata-null texts as creates.** Rejected: the official parser and updater avoid a second grammar and distinguish known creations from unknown prior content. Partial execution cannot establish that an Add completed.

**Replace quote or other community packages wholesale with new official capabilities.** Rejected for this compatibility wave: quote's side chat, source preview, and extension actions remain, while larger integrations have a separate later wave. No whole package retires here.

**Accept the alpha diff or rc5's green gate as final rc1 evidence.** Rejected: all acceptance uses the exact published rc1 tag with cleared TypeScript caches, real executor calls, and browser checks; alpha artifacts are not a substitute.

## Consequences

The development graph and workflow pins move to rc1, while package publication versions do not change. The DSH sub-profile floor is higher than the rest of the local-agent family. File-preview keeps its previous minimum host and has a metadata-only fallback when the optional parser is unavailable. Session lifecycle and history-controller changes are explicit in the affected tests rather than hidden behind type assertions.

The clean full-repo gate has passed, and controlled deployment to 3080 has completed with passing preflight and canary checks. Production interaction acceptance remains open. The combined quote browser check and the mobile browser/Quick Tunnel check have passed; real-device cellular, network-transition, camera-permission, and full touch checks remain open. No npm publish or push is implied by this record. `verifiedHost` advances only for packages whose actual acceptance covers rc1. `gen-typert` removes an interrupted clone's partial entry inside its own overlay before the plain-copy fallback, so no package is skipped on Node 24. Provisioning uses `unlinkSync` for symlinks because Node 24 rejects `rmSync(..., { force: true })` on links to directories; no recursive deletion is involved. Room's crash fixture suppresses settlement during simulated process loss so disposal cannot manufacture a cancelled outcome. Final acceptance uses an official, checksum-verified Node 24.9.0 runtime rather than the default unsupported Node 22.

## Testing

The focused suites pass: 56 headless tests, 519 local-agent tests, 246 local-agent-dsh tests, 228 file-preview tests, 311 context-lens tests, 168 mobile tests, 272 canvas-novel tests, 95 quote tests, 81 content-preview tests, 500 room tests, and 389 script tests. These include real native and PTC calls, `apply_patch` Add/Update/Delete/Move, direct-surface/Remote parity, the revised history controller, the cold-resume publication lifecycle, the interrupted-clone fallback, and symlink replacement without touching its target. The final file-preview, mobile, quote, room, canvas-novel, local-agent-dsh, and headless builds also pass. The final full-repo gate passes; production interaction acceptance is still pending.

## Related

- [Host 0.2.1-rc.5 adaptation](2026-10-31-host-021-rc5-adaptation.md)
- [File-preview PTC dispatch diffs](../bug-fix/2026-10-27-file-preview-ptc-dispatch-diffs.md)
