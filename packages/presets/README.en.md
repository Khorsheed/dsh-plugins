# @khorsheed/dsh-presets

English | [中文](README.md)

The three community agent presets — `dev` (开发模式), `dsh-eval` (评测模式), `dsh-writing` (写作模式) — as declarative `@deepseek-ai/dsh-agent-preset` rows of the host 0.1.7-rc.1 preset mechanism (loader row id convention `preset-<id>`). This package migrates the 0.1.5-era directory presets (`$DSH_HOME/.agent-presets/<id>/`), which 0.1.7-rc.1 no longer reads: a preset is now declared by a bundle patch.

## Shape: a declarations-only bundle

- **No runtime code, no client half**: one `- insert:` list in `cordis.patch.yml` carries all three declarations; `src/index.ts` exports only the `PRESET_IDS` constant so the package has a buildable `lib/` (a pack-dist requirement). The manifest declares this shape as `dsh.bundle.kind: 'preset-declarations'` — check:plugins then pins the preset-row convention (rows may only be named `@deepseek-ai/dsh-agent-preset` with `preset-<id>` ids) in place of the self-mounting identity triangle's own-runtime-row rule.
- **Rows are interpreted by the official plugin**: activation, schema validation and session composition belong to the host's `@deepseek-ai/dsh-agent-preset` / `-registry` (shipped with the official web-app bundle since 0.1.7-rc.1; declared here as an optional peer).
- **Community tool rows are named, deployment-resolved**: the `@khorsheed/dsh-local-agent-kimi/tool`, `-local-agent-codex/tool`, `-local-agent-claude-code/tool`, `-worktrees/tool`, `-room/tool`, `-typesafe-tool`, `-datasets/tool`, `-eval/tool`, `-canvas/agent` and `-canvas-novel/agent` rows inside the preset compositions only name their modules — exactly like the legacy directory presets, those packages must be installed into the same profile to resolve. They are data references in the manifest's `dsh.references`, **not** npm dependency edges. A preset naming an unresolvable module stays on the roster with its diagnostic (the official mechanism) instead of breaking the host.

## Provenance of the three presets

| preset | name | order | source and check result |
| --- | --- | --- | --- |
| `dev` | 开发模式 | 10 | Official part rebased onto rc.1's `standard.patch.yml` verbatim (the 0.1.5 copy had drifted: `workflow-worker-thread` renamed to `workflow-ptc`, `tool-ralph` disabled upstream, the disabled `tool-plugin-manager` row added); the live dev file's six community tool rows appended verbatim (3× local-agent delegation + worktrees/room/typesafe). |
| `dsh-eval` | 评测模式 | 0 | `profiles/web-eval/presets/eval` migrated row by row; every official package name checked against the rc.1 roster — **zero renames**; carries the `datasets-tool` and `eval-tool` (`tools: all`) companion rows; the `eval-planning` skill registers from the `eval-tool` row (T100). Since T100 web-eval's `preset-eval` is the canonical composition and `scripts/eval-preset-parity.spec.ts` compares the two parsed `plugins:` blocks, so drift on either side is red. T102 folded dataset organizing in: a shell (organizing runs git and conversion scripts), `tool-web` with fetch, `datasets-tool` at `tools: organize` (reads, `put_item` and the proposal-only `datasets_propose_registration`, and it registers the `dataset-authoring` skill), and one persona carrying both the evaluation rules and the organizing way of working; still no workflow engine and no plan-mode. Frozen decision 12 was rewritten with it: the docker socket still belongs to the orchestrator alone, but the preset no longer guarantees it. |
| `dsh-writing` | 写作模式 | — | `profiles/web/presets/dsh-writing` migrated row by row (the only rename is `workflow-worker-thread` → `workflow-ptc`); carries the `canvas/agent` row. Writing-scene tuning: goal rows removed 2026-09-29; the writer persona grew into the full bilingual style contract 2026-09-30 (every prompt section this file owns is single-language English, the host prompt's own voice), and the same day a `minimal`-inspired tool diet removed plan-mode, the delegation/workflow group, fs-search, jobs, present and agent-instructions — what stays is shell (writing skills shell out to scripts; probation), file read/write, Skills, compaction, ask-user, todo, web and the per-session canvas tools. On 2026-10-06 the `canvas-novel/agent` row folded in (bundle-writing's 写作 preset; that package retired): the `novel_*` tools appear only when the session is bound to a 长篇小说 canvas. |

The display fields (`name`/`description`/`order`) come from each legacy `preset.yml`; descriptions keep their original Chinese text, except that `dsh-eval`'s follows the web-eval copy since T100 (the parity spec pins `name`/`description` too).

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-presets
```

Once mounted, the three presets appear in the session mode selection. Everything evaluation-side (the datasets / eval tools, `/eval` `/datasets`, the two evaluation skills, the lab and dataset session surfaces) hangs off the `datasets-tool` / `eval-tool` companion rows, which only `dsh-eval` names — dev and writing sessions carry none of it (pinned by `tests/presets.spec.ts`). Install the community companion packages a preset names as needed (e.g. dev mode's delegation tools require the three local-agent family provider packages in the same profile — each one's `./tool` composition entry resolves with the package).

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5`)**: ❌ unavailable — the `@deepseek-ai/dsh-agent-preset` row type does not exist on 0.1.5 (whose presets are `$DSH_HOME/.agent-presets/` directories, which this package replaces); the bundle cannot even mount there — this is not a degraded mode.
- **deepseek-harness master / npm 0.1.7-rc.1+**: ✅ full — the row type ships with the official web-app bundle (minHost `0.1.7-rc.1`). The availability of community companion rows inside a preset depends on the corresponding packages being installed alongside; a missing one leaves that preset on the roster with its diagnostic and does not affect the others.

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.
