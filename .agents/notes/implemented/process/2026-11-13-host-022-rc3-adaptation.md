# Agent Note: Host 0.2.2-rc.3 adaptation in two waves

Status: implemented

[中文](2026-11-13-host-022-rc3-adaptation.zh.md) | English

## Problem

Host 0.2.2-rc.3 arrives immediately after the large rc.2 migration. It adds an official experimental DeepSeek website Session importer, a New-session action HOC slot, and a reusable Workspace picker with a third directory-flow slot. The community needs a precise compatibility baseline and a capability review, but treating every similar official feature as a package replacement would repeat the title-editing workflow regression.

The previous baseline also pinned only a subset of official packages. A fresh install showed that packages left on older prerelease ranges, including `ui-workspace`, did not automatically resolve to the new RC. A partial version bump therefore creates a mixed type surface even when the pinned CI tag is correct.

## Decision

Use two waves. The first updates the development and CI baselines, verifies the whole plugin suite against exact rc.3 sources, and makes only the required incremental adaptation. The second evaluates product integrations independently, with real Session and browser evidence; it is not silently bundled into this compatibility wave.

All 117 official dsh packages used by the repository are pinned to 0.2.2-rc.3 in `pnpm-workspace.yaml`, alongside the existing independent Cordis and Schemastery pins. The lockfile contains no rc.2 resolution. CI and publish workflows use `dsh-v0.2.2-rc.3`; the forward-compatibility lane now uses Node 24.9 like the stable lane, matching the host engine floor. Existing wide peer ranges and each package's `minHost` remain unchanged. `verifiedHost` advances only with corresponding acceptance evidence.

Mobile contributes its existing directory sheet to `workspace.picker.directoryFlow` in addition to the two older directory-flow slots. `injectMobileDirectoryFlow` forwards the version-dependent key through public `slots.inject`, staying inert when rc.2 lacks the declaration and activating when a host declares it; it does not rely on the internal core's dynamic-spec helper. This lets the reusable picker, including the official optional importer, use the mobile flow without raising `minHost`. The `uiWorkspace.pickDirectory` adapter remains: the new Factory selects or creates a Workspace, while Room, datasets, video-studio, capability-catalog and canvas-novel still need an arbitrary directory path without that registration side effect.

The official importer produces ordinary stored Sessions. Message tools, message timeline, Context Lens, file preview, TaskPilot and quote can therefore be evaluated on imported histories without copying the importer's ZIP parser or cold-write implementation. The reusable Workspace picker is a future integration point for canvas and eval. The New-session HOC slot has no existing DOM-based consumer to migrate and does not justify inventing a feature in this wave.

No whole package retires. In-place session-title editing remains in basic. Room, Context Lens, Transcribe, Worktrees, Local Files, Ankh Guard, Quote and SideChat retain responsibilities not covered by the host. S8, S10, S12, S13, S14, S15, S17, S19, S20, S21, S22 and S23 remain unresolved; the bash-write reporting gap in S2 and S5/S7 also remain. The official importer does not make custom model-role restoration, generic plugin event forwarding or arbitrary-path selection available.

## Alternatives considered

**Upgrade everything and adopt every new capability in one release.** Rejected: dependency resolution and the third mobile directory flow are compatibility work, while canvas/eval workflow changes and imported-Session product acceptance have different risks and owners.

**Pin only the packages pinned for rc.2.** Rejected after a real build failure: `ui-workspace` resolved to 0.2.0-rc.2, leaving the new slot absent from the type map. Every official dsh package now shares one RC resolution instead of relying on prerelease-range interpretation.

**Replace all directory selection with `workspace.picker`.** Rejected: selecting a Workspace and selecting an arbitrary path are different operations. Canvas's multi-select Workspace list can gain an add flow later, but datasets, Room and the other raw-path consumers cannot migrate wholesale.

**Retire the title editor again or treat the importer as a general Session API unlock.** Rejected: the user explicitly retained in-place editing, and the importer changes neither the live append/projection restrictions nor the outstanding seam conditions.

## Consequences

The first wave is isolated in a worktree and does not itself switch the production checkout, write a profile, restart an instance, publish npm or push. The official importer remains an optional experimental bundle rather than a default basic member. Second-wave items require their own acceptance: imported tool cards and statistics, Workspace picker product changes, and any removal of a compatibility path.

The mobile note and bilingual reference now describe all three public directory flows. Its `verifiedHost` remains unclaimed until the real-device/network matrix is complete. The seam registry records the rc.3 audit and corrects the stale statement that the title editor stayed retired.

## Testing

The exact rc.3 worktree at `38a6a5c965aa` completed dependency installation, `build:lib`, `build:web` and the native addon build under Node 24.9.0. The mobile package passed its build and all 33 test files / 179 tests with one version-specific skip, including the three-slot registration contract and real SlotRegistry lifecycle cases. The lockfile has no `0.2.2-rc.2` occurrence and `ui-workspace` resolves to `0.2.2-rc.3`. The same source also passes the rc.2 mobile build and 33 files / 179 tests with the importer-specific case skipped; a real rc.2 Chromium boots the mobile layout with no page errors.

The real Loader/Chromium composition mounted mobile and the official importer together. Opening the importer on desktop, switching to a touch-sized mobile viewport, choosing Add workspace through the reusable Factory, and entering a new path displayed the mobile directory sheet and created that Workspace in the Host registry, with no page errors. This is browser-level composition evidence, not a full real-device qualification.

The clean `pnpm gate --all` run passed all 17 steps in 583 seconds: whole-repository build and test, checker suites, composition and documentation gates, and verification of 42 package tarballs. Cold installation remains CI-only; this run does not claim production deployment or full real-device acceptance.

## Related

- [Host 0.2.2-rc.2 adaptation](2026-11-12-host-022-rc2-adaptation.md)
- [Mobile directory selection stays on the phone](../bug-fix/2026-09-13-mobile-directory-browser.md)
- [Upstream seam registry](../../../../docs/upstream-seam-registry.md)
