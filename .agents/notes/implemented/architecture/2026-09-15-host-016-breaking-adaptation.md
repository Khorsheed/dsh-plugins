# Agent Note: host 0.1.6 breaking adaptation — alpha.1 baseline pin and the five hits

Status: implemented

English | [中文](2026-09-15-host-016-breaking-adaptation.zh.md)

## Problem

The host published 0.1.6-alpha.1 (2026-09-15, ~804 commits past our 0.1.5-rc.1 baseline). The wave proposal `proposals/active/2026-09-15-host-016-adaptation.md` audited the delta and scheduled the breaking items; this note records what the adaptation actually hit and the decisions taken. The wave strategy is probe-and-degrade with **minHost unmoved**: 0.1.6 sits on npm's `alpha` dist-tag while `latest` stays at 0.1.5-rc.1, so every package must keep installing and behaving identically on 0.1.5 while compiling and running against 0.1.6.

## What broke (five hits, all fixed in this batch)

1. **`agent/created` went `@mode serial`** with payload `{agent, source, signal}` and a `undefined | Promise<undefined>` listener contract; `agent/session-start` was deleted (zero references here). ankh-guard is the repo's only `agent/created` listener (`packages/ankh-guard/src/index.ts`): a `void`-returning listener no longer type-checks, and because the creation transaction now awaits whatever a listener returns, the listener must stay fire-and-forget. Fixed with an explicit `: undefined` annotation plus the serial-discipline comment; the restart-continuity `deliver()` path was audited and performs no await at listener scope (never `agent.whenIdle`).
2. **`SubprocessTerminalSpawnSpec.terminalType` became required.** gen-typert's whole-workspace analysis surfaced it in `packages/local-agent/src/index.ts` (the login PTY spawn). Fixed with `terminalType: 'xterm-256color'`, the same value the official terminal-controller passes.
3. **`code-runtime` packages were deleted** (`dsh-code-runtime(-worker-thread)` → `dsh-ptc-runtime(-node)`, row id `code-runtime` → `ptc-runtime`; `workflow-worker-thread` → `workflow-ptc`). local-agent-dsh-headless carried the dependency, the patch row, the pin spec, and docs; the eval capability-probe fixture mirrored the row. All renamed; the collision-pin spec keeps its P0 rationale with a rename note.
4. **`SidebarRightGuideEntry.id` became required.** Four client definitions (canvas, local-files, ui-file-preview, worktrees) register right-sidebar guide entries; each now passes its KIND constant as the stable entry id, matching the official `ui-sidebar-files` shape.
5. **Profiles**: `tool-ralph` is now `disabled: true` in the base bundle (the documented restore form is an overlay row with `disabled: false` — added to web-dev's row); web-dev's `workflow-worker-thread` row became `workflow-ptc` / `@deepseek-ai/dsh-workflow-ptc`; web-eval prose followed the rename.

**Checked with zero hits**: e2b removal (no references), provenance→source type renames (not imported), `ComposerBarInjected.command` / `WorkspaceBrowserInjected.insertSessionBefore` / `MessageFeedbackInjected` removals (no consumers), mobile's permission-control DOM anchor (verified statically against 0.1.6's `PermissionSelect.tsx`: trigger button still renders the text span plus aria-hidden chevron the anchor probes).

## Decision

- **Baseline moves in one mechanical commit**: every package's `@deepseek-ai` devDependency `^0.1.5-rc.1` → `^0.1.6-alpha.1` (347 lines, 32 packages), the pnpm-workspace `overrides` + `minimumReleaseAgeExclude` pins flip with it (the exclude entries are version-pinned, and alpha.1 was published the same day), and the cordis override stays `4.0.2` (0.1.6 still vendors cordis 4.0.2). `dsh.compat` minHost/verifiedHost lines were deliberately NOT touched — they move only when the wave's compatibility-labeling pass says so.
- **A second harness checkout carries the alpha line.** `~/code/deepseek-harness-alpha` is a detached worktree of the harness at `dsh-v0.1.6-alpha.1`; wave builds/tests run with `DSH_HARNESS` pointed there, while the shared `~/code/deepseek-harness` stays on 0.1.5 until merge (other agents resolve against it). The alpha checkout must be **fully built** (`pnpm install && pnpm run build`): ankh-guard's preflight drift tripwire imports harness packages through their `lib/` entries, and a source-only checkout fails that lane with an opaque `[object Object]` import error.
- **Fix forward, no compatibility shims.** Every hit was an official rename or a newly required field with an obvious correct value; the 0.1.5 line's type-checkers accept the new shapes because the fields are additive in our usage (and 0.1.5 runtime never sees them). No probe was needed for any of the five.
- **rc re-verification is scheduled, not assumed.** Thursday's 0.1.6 rc gets a fresh audit before merge; message-editing was reverted between alpha.2 and rc.1 in the 0.1.5 line, so alpha.1 is evidence, not proof.

## Alternatives considered

- **Bumping `minHost` to 0.1.6-alpha.1 with the adaptation** — locks community users on npm `latest` (0.1.5-rc.1) out of every package for no behavioral gain; the wave strategy forbids it.
- **Keeping the shared harness checkout and switching it back and forth** — multi-agent hazard: other worktrees resolve types and run gen-typert against `DSH_HARNESS`; flipping it mid-wave breaks their builds. The dual-checkout pattern already has precedent from the 0.1.2-alpha reviews.
- **Deferring the whole adaptation to the rc** — the headless `dsh-code-runtime-worker-thread` dependency and the web-dev `workflow-worker-thread` row are install-time failures on 0.1.6, not graceful degradations; waiting would leave the repo unbuildable against the line the rc will finalize in days.

## Consequences

- The repo builds (`pnpm run build`) and tests (`pnpm run test`) green against 0.1.6-alpha.1 with zero behavior change on 0.1.5.
- `peerDependencies` ranges (`^0.1.0-rc.6`) still do not cover 0.1.5/0.1.6 prereleases under strict node-semver tuple rules (pnpm only warns today); the wave's npm-publish checklist carries the review item (`docs/publishing.md`).
- The S12 restore-projection shipped in the same wave behind a fold-semantics gate — see the [restore-projection note](../feature/2026-09-15-message-tools-restore-projection.md).
- ankh-guard's in-flight test-lifecycle branch (`fix/ankh-guard-test-lifecycle`) touches the same spec file this batch's future test-fidelity work (adding `source` to `agent/created` emits) will edit; coordinate at merge.
- When the rc tag lands: re-run the seam registry audit, re-pin (alpha.1 → rc), re-run the full build/test sweep, then merge and take the shared checkout forward.
