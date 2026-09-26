# Agent Note: host 0.1.7-rc.1 adaptation wave — V4 producer sources, settings rewrite, schemastery 3.18.4, icon renames

Status: implemented

[English](2026-09-24-host-017-rc1-adaptation.md) | [中文](2026-09-24-host-017-rc1-adaptation.zh.md)

## Problem

The host skipped the 0.1.6 rc and shipped 0.1.7-rc.1 (2026-09-23; 1617 commits / 5142 files from the wave's 0.1.6-alpha.2 baseline). The user green-lit the planned rc adaptation the same day. A three-way contract audit (presets·bundles·compat / Remote·agent·session / UI·slots·previews, all evidence file:line on the rc.1 tag) found every alpha.1/alpha.2 adaptation still valid, but added a new breaking set: a settings rewrite on both host and client, Session log V4 producer-owned message sources, a forced peerDependency compatibility gate, the dsh-agent-presets package split, a jobs contract rewrite, conversation.chat.node contract reshaping, schemastery 3.18.4 variance tightening, and a repo-wide icon suffix rename that tsc cannot see.

## Decision

All adaptations keep the probe+degrade dual-line contract (0.1.5 keeps working; no version sniffing; `slots.inject` for every cross-package slot registration). The named patterns:

- **V4 producer-owned sources.** Native V4 admission rejects the retired `kind: 'plugin'` wrapper at flush-to-disk (`encodeEventBatch` → V4 codec `assertV4SourceRowAdmission`) — in-memory `Session.append` never rejects, which is why tsc was blind and every package needed a runtime persistence probe. Each package declares its own kind in `@deepseek-ai/dsh-llm`'s `MessageSourceMap` via module augmentation (the official `model-selection` pattern) and writes `source: { kind: '<package-short-name>', ... }`; readers accept three forms — the new kind, the V3→V4 migrated `plugin:<name>`, and the in-place V3 wrapper. 0.1.5's `assertMessageEventShape` only requires a non-empty `source.kind` on `user/message`, so the single new write form is safe on both lines. Tool results also became first-class tool-role messages (flat `toolCallId`/`isError` on the message), so ledger-style readers (`kimi session-mirror`, `sidechat journal`) read both the message level and the V3 block wrapper.
- **Settings rewrite** — see the dedicated note `2026-09-24-settings-config-forms-dual-line`: host-side `ctx.settings.register` → plugin-Config `.volatile()` fields + `SettingsForms.update/replace` + `settings/document-updated`; client-side `ctx.settingsScope` → `ctx.configForms`; `.volatile()` itself is feature-probed because 0.1.5's schemastery lacks the method; wholesale `replace` for the catalog's machine-state block because `update`'s recursive merge resurrects deleted keys.
- **schemastery 3.18.4 annotations.** `Config: z<T>` fails TS2375 under the tightened variance, while dropping the annotation fails TS2742/TS2883 in the .pnpm layout. The settled repo pattern is the bare `z` annotation (`export const Config: z = z.object({...})`); the config interface stays as `apply`'s parameter type. Eight packages hit this.
- **Icon suffix rename.** rc.1 deleted the pixel-suffixed icon exports (`IconXOutline14/16/20`); every family now ships `Medium`/`Regular`. A named import of a removed export is undefined at runtime and crashes the component tree without a tsc error, so the authoritative scan was a repo-wide grep sweep to `Medium` (~200 usages), verified zero remaining.
- **cordis single instance.** rc.1's official line peers `~4.0.4`; the override moved 4.0.2 → 4.0.4, and a new `@deepseek-ai/cordis-plugin-loader@1.0.5` override kills the 1.0.3/1.0.5 split that forked cordis into two peer-suffixed instances (module augmentations like `ctx.agents` attached to the instance the consumer did not import — the taskpilot prepare failure's root cause).
- **Peer compatibility gate.** Install-time refusal and boot-time row-disabling now read every `@deepseek-ai/dsh*` peer range as a constraint on the host runtime (`includePrerelease`). The repo's prevailing `^0.1.0-rc.6` passes 0.1.7-rc.1; exact pins and non-string specs fail.
- **dsh-agent-presets split.** Import-level rename to `@deepseek-ai/dsh-agent-preset-registry`; the `resolve`/`mount`/`livePresetMounts`/`agentPresetProjectionDefinition` surface carried over unchanged.
- **preflight-runner fourth generation.** rc.1 deleted all three older app-boot markers (`healProfilesModuleFallback`, `createProfileResolutionGeneration`, `DEFAULT_PROFILE_PATCH_RELOAD`); the runner probes `createRuntimeResolution` newest-first and mirrors `apps/cli composeProfile`'s two-argument call.

## Alternatives considered

- **Keep writing `kind: 'plugin'` and let V3 history carry it.** Native V4 admission rejects the wrapper at flush, so every such event would be lost on the rc.1 line — not a degrade, a data-loss path.
- **Version-sniffed write forms (`plugin` on 0.1.5, producer kind on 0.1.7).** Rejected by the wave's own rule; 0.1.5's admission only requires a non-empty `source.kind` on `user/message`, so one producer-kind write serves both lines.
- **Keep the typed `z<T>` Config annotation.** Both directions fail on 3.18.4 (TS2375 with it, TS2742/TS2883 without any annotation in the .pnpm layout); the bare `z` annotation is the only form that compiles in our packaging.
- **Sweep icons per package as discovered.** A named import of a removed export crashes at runtime with no tsc error, so discovery-order fixing would have left runtime bombs in compile-clean packages (canvas proved it); the repo-wide grep sweep was the only complete scan.

## Consequences

- Wave state on `feat/host-016-adaptation`: merge with main (28 conflicts resolved — dual-arm × renderModelPicker union, eval openSession address logic × dual-line union, datasets chip retired with T73, room inbox × coordinator union), re-pin to rc.1 (38 files), then per-package fixes across ~30 packages. ankh-guard 212, capability-catalog 226 (+β's wholesale-replace fix), δ batch 689, α batch 1375, β batch 1718 tests green; full-repo icon sweep and the all-packages tsc census (twice) found no package left behind — including compile-clean but runtime-broken ones (canvas).
- The 2026-09-18 leftover "ankh-guard preflight PluginPackages on 0.1.x" is **closed by measurement**: the rc.1 trial boot classifies bare-specifier failures as optional (22 official rows "failed to import" only because the prod profile still carries rc.3-era modules) and reports PASS — the gate direction is safe. The same measurement hardened a new precondition: **presets must migrate to a bundle before 3080 upgrades to rc.1**, because directory presets (`.agent-presets`) have no code path left and prod's four presets would be lost on upgrade.
- `npm latest`/`next` remain 0.1.5-rc.3, so minHost stays put; the npm wave (0.1.5 backlog + this wave) waits for the 3080 acceptance and account unblocking.
- Runtime-only surfaces that compile-clean packages still had to prove with probes: the V4 write path (flush-time rejection), kimi's mirror ledger double-form read, session-title-edit's locale bench (rc.1 moved the locale inject face to configForms), and the icon crash class. The wave's rule of thumb now reads: tsc green never proves runtime green on a host-line jump; grep the removed names.
