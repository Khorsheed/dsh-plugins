# Agent Note: rc.7 host update + dependency declaration sync

Status: implemented

English | [中文](2026-08-17-rc7-host-update-declaration-sync.zh.md)

## Problem

`deepseek-harness` released `0.1.0-rc.7` (2026-08-17, release merge `bb4ca698d6`). The deployment checkout and every plugin declaration still sat on the rc.6 line, and two stale ranges installed second copies of host packages outside the rc.7 line: `local-agent-kimi` hard-depended on `@deepseek-ai/dsh-home-paths ^0.0.1-rc.3` (an unused dependency whose range excludes the 0.1.0 line), and `file-preview` dev-depended on `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-loader-smoke ^0.0.1-rc.1` (tests compiled against pre-0.1.0 types).

## Decision

- **Deployment repo** (`~/code/deepseek-harness`): guard checkpoint `962169d37f` (message `pre-rc7-deploy-update`), backup branch `deploy-pre-rc7`, then hard-reset to upstream master `99f6f02fec` (the rc.7 release merge). The 225 local checkpoint commits live only on `deploy-pre-rc7` now. 3080 was restarted via `schedule-exit`; watchdog canary PASS, all 8 client-half plugin bundles present in the served graph.
- **Pure mirror** (`~/code/deepseek-harness-mirror`): fresh clone of upstream master at rc.7 + `pnpm install` + `build:lib:host`, kept clean as the tracking/test checkout (candidate `DSH_HARNESS` seed), distinct from the guarded deploy checkout.
- **Declarations**: every `@deepseek-ai/dsh-* ^0.1.0-rc.6` peer/dev range and `dsh.compat.minHost` bumped to `0.1.0-rc.7` across all 14 packages; `local-agent-kimi`'s unused `dsh-home-paths` hard dep removed; `file-preview`'s devDeps moved to `^0.1.0-rc.7`. README Compatibility sections (en+zh) re-labeled to the rc.7 line.
- **Verdicts re-checked against the rc.6→rc.7 source diff** (not re-run tarball-by-tarball): our dependency set saw only additive/internal changes — `dsh-llm` tightened `replayState` to `ReplayEnvelope` (nothing we import uses it), `dsh-tools` prompt wording only, `ui-conversation` internal Safari fix, `ui-primitives` additive export, and the only slot-catalog change (`settings.plugin.item` list→keyed) is unused by us. All ✅ verdicts hold on rc.7.

## Alternatives considered

- **Keep `^0.1.0-rc.6`** — it semver-satisfies rc.7, but declares an outdated line and left the second-copy problem invisible; the lockfile already showed `dsh-home-paths@0.0.1-rc.3` and `dsh-llm@0.0.1-rc.1` coexisting with rc.6 instances.
- **Patch the deploy repo in place** — rejected: the guarded checkout is disposable by design (AGENTS.md), so the upstream-pure reset plus a backup branch is the intended update path.

## Consequences

- The guard credential `build+test` is recorded at `99f6f02fec` with a documented exception: 4 full-suite runs each failed 1–2 timing-sensitive tests (`user-patches.spec.ts` HMR watcher 3×, `process-exit.spec.ts` 1×) that pass deterministically in isolation — a macOS full-suite environment flake, not an rc.7 defect (upstream CI green on the same commit).
- The fork's `dsh preflight` composition gate was **not** carried onto rc.7 (it is a local patch, wiped by the upstream reset; still present on `deploy-pre-rc7`); the restart gate is currently degraded to "unavailable" (guard CLI in dsh-plugins cannot resolve a sibling app). Re-application is a separate tracked decision — see the 2026-08-17 preflight patch evaluation.
- Profile tarball installs (`message-tools`, `taskpilot`) still reference pre-cleanup tarballs; refresh belongs to the next publish cycle.
