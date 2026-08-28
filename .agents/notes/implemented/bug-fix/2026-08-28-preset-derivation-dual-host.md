# Agent Note: preset derivation probes both host surfaces

Status: implemented

English | [中文](2026-08-28-preset-derivation-dual-host.zh.md)

## Problem

The 0.1.2-alpha.1 host reworked agent presets ([assessment](../proposed/architecture/2026-08-28-host-0.1.2-alpha1-assessment.md)): the `resolveSessionPreset` free function and the `PresetBearingSession` type were deleted from `@deepseek-ai/dsh-agent-presets` in favor of the `agentPresetProjectionDefinition` projection unit. ankh-guard statically imported both removed symbols, so loading the plugin on the new host line died with a SyntaxError before `apply` ever ran — the alpha acceptance instance had to run without the guard. Type-checking never saw it: the repo compiles against the published rc types, where the exports still exist. A named-export removal is a compile-time blind spot; only a live boot on the target line catches it.

## Decision

- The preset lookup in the resume path (`deriveSessionPreset`) reads the host package through a **namespace import + structural probe**, never a static named import  of a symbol that any supported host line might not export. The rc surface (`resolveSessionPreset`) and the 0.1.2 surface (`agentPresetProjectionDefinition`) implement the same fold — init from the session header, every `agent-preset/selected` event overwrites — so the code probes the projection first, falls back to the resolver, and yields `undefined` (deployment default preset) when a host carries neither.
- No version-string branching anywhere: detection reads the loaded module. This matches the preflight runner's dual-host fix (same day, same lesson) where the feature marker is the `DEFAULT_PROFILE_PATCH_RELOAD` export.
- `PresetBearingSession` is replaced by a local structural type (`PersistedPresetSource`) covering exactly the two fields the derivation reads.
- Verification habit adopted: a host-surface change is not done at green typecheck/tests — the compiled artifact must BOOT on the alpha acceptance instance before merge. The tarball was installed into the alpha profile, the instance restarted, and the plugin mounted clean (state files written, zero load errors in the boot log).

## Alternatives considered

- **Read the preset from the session-projection registry instead of folding events** — rejected: the registry materializes cells on `session/created`/`session/event`, so a cold resume (the guard's case) has no cell yet; folding the host's own projection definition over the inspected log is the same semantics with no registry timing dependency.
- **Keep the static import and bump the peer range to 0.1.2** — rejected: prod hosts run the rc line until 0.1.2 reaches npm; one artifact must serve both.
- **Reimplement the fold inline (scan events for the last selection)** — rejected: duplicating the host's semantics invites drift; calling the host's own `init`/`apply` keeps the fold host-owned on both lines.

## Consequences

- The plugin loads on both host lines from one artifact; the rc line's runtime behavior is byte-identical (same resolver, same fold).
- The tripwire story for host drift now has two layers: the preflight composition diff (entry ids) and a live-boot install check on the alpha acceptance instance — the latter is the only net that catches removed named exports, because this repo's typecheck consumes the published rc types.
- Cost: the call site casts the namespace through `unknown`, so a genuine future signature change inside `init`/`apply` would go unflagged by tsc — accepted; the live-boot check owns that class of failure.
