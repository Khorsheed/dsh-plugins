# Agent Note: writing-preset minimal tool diet — plan/delegation/search/jobs/present/agent-instructions out

Status: implemented

English | [中文](2026-09-30-writing-preset-minimal-tool-diet.zh.md)

## Problem

After the prompt retune ([writing-preset prompt hygiene](../feature/2026-09-29-writing-preset-prompt-hygiene.md)), `dsh-writing` still mounted nearly the full standard composition. In the maintainer's A/B use the official `minimal` preset (one persistent shell, one persona line, no skills/plan/compaction) produced *better* writing than the full composition — every extra tool and section is prompt surface the writing scene never drives, and some actively mislead (plan mode's section speaks of implementation and `exit_plan_mode`; delegation and workflows are coding apparatus).

## Decision

Slim the `dsh-writing` composition on 2026-09-30 (`packages/presets/cordis.patch.yml`); the writer persona contract is unchanged:

- **Removed**: `agent-instructions`; `tool-fs-search` (glob/grep); `tool-jobs`; the plan-mode group; the whole delegation/workflow group (`tool-subagent-control`, its `list-agents`, `subagent` spawn/fork, the two disabled optional-provider rows, `workflow-ptc`, `tool-workflow`, `tool-ralph`); `tool-present`.
- **Kept**: persona; the shell (`bash`/`pwsh`) **on probation** — the md-to-wechat skill shells out to converter scripts, so the shell stays until that proves dispensable; `tool-fs` read/write; `skill-filesystem` + `tool-skill` (the writing skills are the mode's core value); the compaction group; `tool-ask-user`; `tool-todo`; `tool-web` (fetch+search); `canvas-agent`.
- The preset description no longer advertises 计划模式/子代理.

This supersedes the earlier note's "keep plan mode — outlining is a writing workflow" call: that reasoning lost to the observed minimal-preset results and to the section's implementation-shaped vocabulary.

## Alternatives considered

**Go all the way to minimal (bash only).** Rejected: writing skills, web research and the canvas are the mode's core value; minimal carries none of them.

**Drop the shell too.** Deferred, not rejected — probation while md-to-wechat still shells out to scripts.

**Keep `agent-instructions`.** Rejected for now — re-add the row if a writing workspace needs repo-level rules injected every turn.

## Consequences

- A writing session's tool surface is ≈ shell + fs + web + skill + ask_user + todo + canvas. Boundary worth remembering: a preset composition can only ADD rows; profile-root tool rows (the official schedule bundle, the local-agent delegation tools) stay visible to writing sessions until those move per-preset (the local-agent `./tool` fold-in) or a `ctx.tools.restrict` deny row lands.
- `presets.spec.ts` pins the diet both ways (kept rows present, removed row ids absent — matched on row-id patterns so the NOT-here comments can still narrate them).
- Ships as the next presets release (0.3.0 line; unreleased at commit time).

## Related

- [writing-preset prompt hygiene](../feature/2026-09-29-writing-preset-prompt-hygiene.md) — the prompt-side retune this follows; its plan-mode alternative is superseded here.
