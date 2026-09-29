# @khorsheed/dsh-presets

English | [中文](README.md)

The three community agent presets — `dev` (开发模式), `dsh-eval` (评测模式), `dsh-writing` (写作模式) — as declarative `@deepseek-ai/dsh-agent-preset` rows of the host 0.1.7-rc.1 preset mechanism (loader row id convention `preset-<id>`). This package migrates the 0.1.5-era directory presets (`$DSH_HOME/.agent-presets/<id>/`), which 0.1.7-rc.1 no longer reads: a preset is now declared by a bundle patch.

## Shape: a declarations-only bundle

- **No runtime code, no client half**: one `- insert:` list in `cordis.patch.yml` carries all three declarations; `src/index.ts` exports only the `PRESET_IDS` constant so the package has a buildable `lib/` (a pack-dist requirement). The manifest declares this shape as `dsh.bundle.kind: 'preset-declarations'` — check:plugins then pins the preset-row convention (rows may only be named `@deepseek-ai/dsh-agent-preset` with `preset-<id>` ids) in place of the self-mounting identity triangle's own-runtime-row rule.
- **Rows are interpreted by the official plugin**: activation, schema validation and session composition belong to the host's `@deepseek-ai/dsh-agent-preset` / `-registry` (shipped with the official web-app bundle since 0.1.7-rc.1; declared here as an optional peer).
- **Community tool rows are named, deployment-resolved**: the `@khorsheed/dsh-local-agent-tool-subagent`, `-worktrees/tool`, `-room/tool`, `-typesafe-tool`, `-datasets-tool`, `-eval-tool` and `-canvas/agent` rows inside the preset compositions only name their modules — exactly like the legacy directory presets, those packages must be installed into the same profile to resolve. They are data references in the manifest's `dsh.references`, **not** npm dependency edges. A preset naming an unresolvable module stays on the roster with its diagnostic (the official mechanism) instead of breaking the host.

## Migration provenance of the three presets

| preset | name | order | source and check result |
| --- | --- | --- | --- |
| `dev` | 开发模式 | 10 | Official part rebased onto rc.1's `standard.patch.yml` verbatim (the 0.1.5 copy had drifted: `workflow-worker-thread` renamed to `workflow-ptc`, `tool-ralph` disabled upstream, the disabled `tool-plugin-manager` row added); the live dev file's six community tool rows appended verbatim (3× local-agent delegation + worktrees/room/typesafe). |
| `dsh-eval` | 评测模式 | 0 | `profiles/web-eval/presets/eval` migrated row by row: the shell-less, workflow-less read-and-delegate composition (frozen decision 12); every official package name checked against the rc.1 roster — **zero renames**; carries the `datasets-tool` (`tools: authoring`) and `eval-tool` (`tools: all`) companion rows. |
| `dsh-writing` | 写作模式 | — | `profiles/web/presets/dsh-writing` migrated row by row (`tool-ralph` staying enabled is this preset's own decision); the only rename is `workflow-worker-thread` → `workflow-ptc`; carries the `canvas/agent` row. Tuned for the writing scene 2026-09-29: Chinese-writer persona (plain style + full-width punctuation rule), goal rows removed, plan-mode section translated — every prompt section this file owns is single-language Chinese. |

The display fields (`name`/`description`/`order`) come from each legacy `preset.yml`; descriptions keep their original Chinese text.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-presets
```

Once mounted, the three presets appear in the session mode selection. Install the community companion packages a preset names as needed (e.g. dev mode's delegation tools require the local-agent family providers and `@khorsheed/dsh-local-agent-tool-subagent` in the same profile).

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5`)**: ❌ unavailable — the `@deepseek-ai/dsh-agent-preset` row type does not exist on 0.1.5 (whose presets are `$DSH_HOME/.agent-presets/` directories, which this package replaces); the bundle cannot even mount there — this is not a degraded mode.
- **deepseek-harness master / npm 0.1.7-rc.1+**: ✅ full — the row type ships with the official web-app bundle (minHost `0.1.7-rc.1`). The availability of community companion rows inside a preset depends on the corresponding packages being installed alongside; a missing one leaves that preset on the roster with its diagnostic and does not affect the others.

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.
