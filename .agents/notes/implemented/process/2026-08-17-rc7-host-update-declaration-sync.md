# Agent Note: rc.7 host update + dependency declaration sync

Status: implemented

English | [中文](2026-08-17-rc7-host-update-declaration-sync.zh.md)

## Problem

`deepseek-harness` released `0.1.0-rc.7` (2026-08-17, release merge `bb4ca698d6`). The deployment checkout and every plugin declaration still sat on the rc.6 line, and two stale ranges installed second copies of host packages outside the rc.7 line: `local-agent-kimi` hard-depended on `@deepseek-ai/dsh-home-paths ^0.0.1-rc.3` (an unused dependency whose range excludes the 0.1.0 line), and `file-preview` dev-depended on `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-loader-smoke ^0.0.1-rc.1` (tests compiled against pre-0.1.0 types).

## Decision

- **Deployment repo** (`~/code/deepseek-harness`): guard checkpoint `962169d37f` (message `pre-rc7-deploy-update`), backup branch `deploy-pre-rc7`, then hard-reset to upstream master `99f6f02fec` (the rc.7 release merge). The 225 local checkpoint commits live only on `deploy-pre-rc7` now. 3080 was restarted via `schedule-exit`; watchdog canary PASS, all 8 client-half plugin bundles present in the served graph.
- **Pure mirror** (`~/code/deepseek-harness-mirror`): fresh clone of upstream master at rc.7 + `pnpm install` + `build:lib:host`, kept clean as the tracking/test checkout (candidate `DSH_HARNESS` seed), distinct from the guarded deploy checkout.
- **Declarations**: peer/dev ranges stay on the wide caret line `^0.1.0-rc.6` (covers rc.7 and later 0.1.0-x; the AGENTS.md convention) and `dsh.compat.minHost` stays at `0.1.0-rc.6` (the verified floor — the plugins ran on rc.6 for a week; minHost is a floor, not the current line). README Compatibility sections (en+zh) re-labeled to the rc.7 line as the verified verdict. An early over-correction that bumped ranges and minHost to `0.1.0-rc.7` — and, via a blanket replace, corrupted four packages' own `version` fields (ankh-guard `0.1.0-rc.6.6`, taskpilot/message-timeline/session-title-edit `0.1.0-rc.6`) — was reverted; version fields are release lines and must not track the host line. The real cleanups that stayed: `local-agent-kimi`'s unused `dsh-home-paths ^0.0.1-rc.3` hard dep removed, `file-preview`'s `dsh-llm`/`dsh-loader-smoke` devDeps moved off `^0.0.1-rc.1` onto `^0.1.0-rc.6`, and the lockfile refreshed (resolves `0.1.0-rc.7`, zero pre-0.1.0 second copies).
- **Verdicts re-checked against the rc.6→rc.7 source diff** (not re-run tarball-by-tarball): our dependency set saw only additive/internal changes — `dsh-llm` tightened `replayState` to `ReplayEnvelope` (nothing we import uses it), `dsh-tools` prompt wording only, `ui-conversation` internal Safari fix, `ui-primitives` additive export, and the only slot-catalog change (`settings.plugin.item` list→keyed) is unused by us. All ✅ verdicts hold on rc.7.

## Alternatives considered

- **Keep `^0.1.0-rc.6`** — it semver-satisfies rc.7, but declares an outdated line and left the second-copy problem invisible; the lockfile already showed `dsh-home-paths@0.0.1-rc.3` and `dsh-llm@0.0.1-rc.1` coexisting with rc.6 instances.
- **Patch the deploy repo in place** — rejected: the guarded checkout is disposable by design (AGENTS.md), so the upstream-pure reset plus a backup branch is the intended update path.

## Consequences

- The guard credential `build+test` is recorded at `99f6f02fec` with a documented exception: 4 full-suite runs each failed 1–2 timing-sensitive tests (`user-patches.spec.ts` HMR watcher 3×, `process-exit.spec.ts` 1×) that pass deterministically in isolation — a macOS full-suite environment flake, not an rc.7 defect (upstream CI green on the same commit).
- **The composition-preflight gate was rebuilt without a fork patch**: `packages/ankh-guard/src/preflight-runner.ts` dry-runs the profile's full composition by dynamically importing the official published `@deepseek-ai/dsh-app-boot` / `dsh-home-paths` / `dsh-launch-environment` / `dsh-cmdline` from the live harness checkout (monorepo layout map `packages/<category>/<name>`; the harness root comes from `--repo` / `DSH_HARNESS` / default `~/code/deepseek-harness`), pins the webserver port to 0, boots the whole plugin tree, checks every registered client bundle artifact, disposes, and exits 0/1/3. The guard CLI's `preflight` command and the `schedule-exit`/`restart` gate prefer the runner (resolution order: `DSH_PREFLIGHT_COMMAND` override → runner → fork `dsh preflight`). This survives upstream releases — no apps/cli modification, so rc.8 cannot wipe it; it only needs the published API surface to stay stable (the compat audit's job). The npm line (standalone install, no checkout) still degrades to a notice.
- Profile tarball installs (`message-tools`, `taskpilot`) still reference pre-cleanup tarballs; refresh belongs to the next publish cycle.

## Follow-up: ui-shortcuts settings card migration (2026-08-17)

The keyboard-shortcuts preferences moved from the General Settings row (`settings.general.item`, id `shortcuts`) to a card in the plugin configuration tab (`settings.plugin.item`, key `ui-shortcuts`), per the official `docs/cookbook/adding-a-settings-card.md` — the namespace (`UI_SHORTCUTS_NAMESPACE`), schema (open `actionId → binding` dict) and `settingsScope` writes were already in place, so this was a browser-half slot move plus the type-only `@deepseek-ai/dsh-client-ui-settings-plugins/client` import for the keyed slot declaration and the `dsh.client.inject` entry. Key-capture interaction is unchanged (the card owns its chrome; the tab only dispatches keys). Verified on the live instance: preflight PASS, canary PASS, card registration present in the served client bundle.

One trap found on the way: **pnpm 11 mis-resolves `^0.1.0-rc.6` → `0.1.0-rc.6` for `@deepseek-ai/dsh-client-ui-settings-plugins` even though rc.7 satisfies the range** (node-semver agrees rc.7 is maxSatisfying; the packument and abbreviated packument both list rc.7; every other dsh-* package resolved rc.7 fine). Since this devDep exists only for the rc.7-only keyed slot type, its range is `^0.1.0-rc.7` (honest about the required API) — the one deliberate exception to the wide-range convention. If pnpm starts honoring the wide range again, the range can go back to `^0.1.0-rc.6`.
