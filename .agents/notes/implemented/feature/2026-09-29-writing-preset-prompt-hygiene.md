# Agent Note: writing-preset prompt hygiene — Chinese writer persona, no goal rows, slimmed canvas guidance

Status: implemented

English | [中文](2026-09-29-writing-preset-prompt-hygiene.zh.md)

## Problem

The `dsh-writing` preset was a row-level migration of a 0.1.5 coding composition, and its prompt showed it: the persona opened with "You are a coding agent powered by the {{model}} model", the goal command/tool (an autonomous-pursuit coding workflow) was mounted, the plan-mode section was the official English text, and the canvas guidance section repeated per-tool mechanics the tool descriptions already carry. User-observed symptoms in writing sessions: half-width commas inside Chinese sentences, and coined/odd words. A further directive: a preset's own prompt sections should be single-language (all Chinese or all English), because mixed-language prose hurts the model's output voice.

## Decision

Retune the writing preset's prompt as one single-language-Chinese surface (2026-09-29), in `packages/presets/cordis.patch.yml`:

- **Persona** — new Chinese identity: 「你是一名中文写作者，由 {{model}} 模型驱动。」 carrying the plain-language style rules (general reader, clear-over-clever, modern common vocabulary, no coined words) and the punctuation rule (punctuation follows the output language: full-width in Chinese sentences, never a half-width comma or period there). Suffix is Chinese too.
- **Goal rows removed** (`command-goal` + `tool-goal`) — goal mode is a coding workflow the writing scene never drives. Dev and dsh-eval presets keep theirs.
- **Plan-mode section translated** — a faithful Chinese rendering of the official rules, tool identifiers (`exit_plan_mode`, `ask_user_question`, `todo_write`) verbatim. Plan mode itself stays: outlining before drafting is a writing workflow.
- **Canvas guidance slimmed to one pointer sentence** (`packages/canvas/src/agent.ts`) — every behavioral rule (ghost-card flow, never paste card text as a substitute, comment style, manuscript `baseVersion`, no-canvas fallback) already lives in the Chinese tool descriptions; the system-prompt section now only says the `canvas_*` tools act on the canvas currently open in the right-sidebar tab. The section switched from English to Chinese, matching the tool descriptions' voice.
- **Preset description fixed** — it previously read as the coding agent's ("功能完整的编码 Agent…").

Residual mixing is acknowledged and out of reach here: official first-party sections and tool catalogs stay English; everything this preset files owns is Chinese.

## Alternatives considered

**Keep the sections bilingual.** Rejected — mixed-language prose was named as a performance concern by the maintainer, and the style rules about Chinese are more precise in Chinese.

**Drop plan mode from the writing preset.** Rejected — outlining is a writing workflow; only the text was coding-flavored, so the text was translated instead.

**Delete the canvas guidance section outright.** Rejected — a one-line pointer (tools exist, they act on the open tab) costs almost nothing and orients the model before it reads the catalog; everything beyond the pointer was duplication.

**English sections for consistency with the host prompt.** Rejected — the host's official sections are not ours to translate, and the writing scene's rules (full-width punctuation, no coined words) are inherently Chinese-language content.

## Consequences

Writing-mode sessions get a Chinese writer identity, style constraints, and punctuation rules; goal UI/tools disappear from the preset; the canvas section costs one sentence instead of six. The `presets.spec.ts` composition pins and canvas's `agent.spec.ts` guidance pins were updated to the new contract (no goal rows, Chinese persona markers, pointer-only section). The canvas package's own profile-root `./agent` row inherits the same slimmer section — acceptable because its tool descriptions carry the rules and the canvas is a writing-domain surface.

## Testing

`pnpm --filter @khorsheed/dsh-presets --filter @khorsheed/dsh-canvas build` and `test` green against the pinned 0.2.0-rc.2 checkout. Live confirmation of the model-facing effect (punctuation, vocabulary) is the maintainer's 3080 review.

## Related

- [host 0.2.0-rc.2 adaptation](../process/2026-09-29-host-020-rc2-adaptation.md) — the wave this tuning rides on.
