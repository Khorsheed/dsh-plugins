# Agent Note: host 0.2.0-rc.2 adaptation — four-category inventory and the single hard break

Status: implemented

English | [中文](2026-09-29-host-020-rc2-adaptation.zh.md)

## Problem

The host moved from 0.1.7-rc.2 (`477b4f42`) to 0.2.0-rc.1 (`dsh-v0.2.0-rc.1`, 261 commits) and, the same day, to 0.2.0-rc.2 (another ~150 commits, now `dist-tags.next`). The migration playbook's reconnaissance phase demands a per-package verdict in four categories — adopt (use a new official capability), unblocked (previously impossible, now possible), switch (own workaround → official API), retire (official covers it natively) — before any code moves.

## Decision

Adopt 0.2.0-rc.2 as the repo baseline: pinned read-only checkout at `~/code/deepseek-harness-0.2.0` (the guarded 3080 checkout stays untouched), devDependencies + `minimumReleaseAgeExclude` + `overrides` + CI workflow pins moved to the 0.2.0-rc.2 line, peer ranges widened with `|| ^0.2.0-rc.1` (caret covers rc.2), minHost floors unchanged pending runtime acceptance. The inventory verdicts: **switch** — one hard break (`runNativeCommand` gained a required `window: 'hidden' | 'visible'` fourth parameter; file-preview's five call sites pass `'visible'` for GUI launchers, `'hidden'` for the wslpath translation utility), plus one type-level ripple: schemastery resolved to 3.18.4, whose `Schema` declares a typed `volatile()`, so the hand-rolled `VolatileCapable` cast probes in context-guard, ui-shortcuts, and capability-catalog stopped compiling (TS2352) and were simplified to call the typed method directly — runtime dual-line behavior (probe → plain field on 0.1.5's 3.18.2) unchanged; **adopt** — nothing urgent, the new `ctx.otel` service and the `Volatile<T>` live-editable config idiom are noted for later; **unblocked** — nothing (every open seam condition still unmet); **retire** — no package (the official whale-tail running status occupies a different surface than whalesong's sidebar-logo overlay, they coexist), with the bookkeeping exception that seam S11 (session-log crash recovery + corrupt-file list resilience) was found to have landed at or before 0.1.7-rc.2 and is marked retired in the registry.

## The inventory (0.1.7-rc.2 → 0.2.0-rc.2)

**Plugin-facing contracts unchanged.** Client slot keys (62 declarations), the module loader, `dsh.client`/`dsh.bundle` handling, typert/Remote patterns, `ctx.tools`, `ToolSchema`, `registerMessageProjection` + fold semantics, `pluginInventory`, `chatFileMentions`, `api-session/*` forwarded events, cordis 4.0.4 vendored: all byte-identical or version-bump only. No `BREAKING` commits in range.

**The one hard break.** `packages/util/native-command`: `NativeCommandRunner` / `runNativeCommand` gained the required fourth parameter `window: 'hidden' | 'visible'` (Windows startup visibility; ignored elsewhere). Anything calling the three-arg form fails type-check. Only `packages/file-preview` (`src/open-external.ts`, `src/reveal.ts`) consumes it here; `SidebarRightBinding` was also unexported in rc.2's sidebar-right internals refactor (contract untouched) — zero references in this repo.

**New official capabilities.** `ctx.otel` (`@deepseek-ai/dsh-otel`): shared `createEventReporter` / `createSessionLogReporter` factories — the official answer to "plugin wants OTLP" (no current need). `ctx.productAnalytics` (desktop-only rows). `deepseekAccount.getDeviceIdentity()`. `ISessions.fork` gained an `onCreated` callback (additive; unused here). The `Volatile<T>` config pattern (`session-log-deepseek`'s `enabled`) makes a plugin config key live-editable from a settings form — a candidate idiom for context-guard / capture / eval / local-agent config, deferred until the maintainer reviews it on 3080. Schedule became an opt-in bundle (`@deepseek-ai/dsh-experimental-schedule-bundle`): `time-context`/`schedule`/`ui-schedule` rows left the default web composition, so patches targeting those ids now miss. rc.2 adds timed user questions with late replies, gateway `hasLiveClient()`, and an official "open the workspace from the sidebar file tree" action.

**Behavioral changes to verify at runtime.** Chat transcript default `'standard'` → `'detailed'` (legacy saved `'normal'` maps to `detailed`); `ToolCallRecovery` appends synthetic error `tool/result` events before `step/end` of failed steps — event-stream consumers (file-preview fold, message-tools, taskpilot) must tolerate them; config-editor: an own config key set to explicit `undefined` now replaces inherited config instead of merging; `ChatSettings.transcriptView` went optional/nullable; `SessionRowOwnerProps.displayTitle` can now be `''` (we consume only `SessionSummary.displayTitle`, unchanged).

**Preset-visibility probes.** The official roster changed (schedule rows out; `product-analytics`, `ui-settings-session-log` in). Our self-hide probes key on our own companion rows, not the removed ids — no code change, re-verify on the live instance.

**Whalesong coexistence.** ui-chat now renders a whale-tail + "Deep diving…" shimmer below the transcript while running (hardcoded in `ChatView`, no slot, no toggle). Whalesong's overlay anchors the sidebar logo, plus favicon and completion sound — disjoint surfaces, no action.

## Seam registry recheck

Full recheck recorded in `docs/upstream-seam-registry.md` (2026-09-29 entry). Verdicts: S11 **retired** (both conditions landed ≤ 0.1.7-rc.2); S5 stays — `@deepseek-ai/dsh-typert-generator` is on npm but the analyzer remains monorepo-coupled (see the `scripts/gen-typert.mts` header), so the overlay workaround stays; S2/S3/S4/S8/S10/S12/S13/S14/S15/S17/S18, meta-pack reconcile, and browser-auth (`Secure` cookie, `--host 0.0.0.0`) all remain unmet. S3/S4 note: the dispatch event was renamed `tool/ptc-dispatch` before the base ref; payload unchanged.

## Alternatives considered

**Stay on the 0.1.7 line until 0.2.0 final.** Rejected: the CI forward lane already follows `dist-tags.next` (0.2.0-rc.2), so the old pin proves yesterday's world; the adaptation cost measured one parameter.

**Extract a new shared renderer-kernel package.** Rejected as unnecessary: `packages/ui-content-preview` already is that kernel — consumed source-plane by file-preview, local-files, and worktrees, inlined into each `lib/client.js` at build time (`build/tsdown.client.ts` `noExternal`), never mounted, never published — so per-package uninstall is already clean. The genuine leftovers (the two `FileTree.tsx` forks, the repeated `preview.ts` adapter label bodies) fold into the existing kernel as a separate cleanup, not this wave.

**Pin peers exactly to 0.2.0-rc.2.** Rejected per the rc.2-era precedent: wide ranges plus workspace `overrides` pin the dev graph while keeping older hosts installable. Note the prerelease tuple rule makes `^0.1.0-rc.6` formally unsatisfied even by 0.1.7-rc.2 under strict semver — the ranges are documentary; pnpm's lenient peer resolution carries the install.

## Consequences

main builds and tests green against 0.2.0-rc.2 with exactly one source change. The rc.1→rc.2 follow-up forced a fresh lockfile resolution (pnpm 11's minimum-release-age check also reads the shadow lockfile at `node_modules/.pnpm/lock.yaml`), which re-resolved ~140 stale third-party entries (rolldown, yaml, hono, MCP SDK — all in-range minor/patch bumps, all older than the 24h gate); that churn rides the same commit, documented there. `@deepseek-ai/dsh-agent-presets@^0.1.0-rc.6` stays as the legacy probe target in three packages (the package was sunset before 0.1.7; nothing to move). Follow-ups: runtime acceptance list (ToolCallRecovery tolerance, probe re-verify, detailed-transcript click-through) on the integration instance, then the 3080 wave; Volatile-config review is the maintainer's call after seeing it live.

## Testing

Full-monorepo `pnpm run build` + `pnpm run test` with `DSH_HARNESS=~/code/deepseek-harness-0.2.0` (tag `dsh-v0.2.0-rc.2`) after a repo-wide tsbuildinfo purge (the cross-host-version cache rule): both green. The intermediate rc.1 run caught the one test the signature change invalidated (`open-external.spec.ts` exact-args assertion now expects `'visible'`).

## Related

- [host 0.1.7-rc.2 adaptation](../architecture/2026-09-27-host-017-rc2-breaking-changes.md) — the previous wave's inventory; same playbook.
- Seam ledger: `docs/upstream-seam-registry.md` (2026-09-29 recheck entry).
