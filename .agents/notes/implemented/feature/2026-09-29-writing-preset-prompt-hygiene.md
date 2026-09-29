# Agent Note: writing-preset prompt hygiene — writer persona, no goal rows, slimmed canvas guidance

Status: implemented

English | [中文](2026-09-29-writing-preset-prompt-hygiene.zh.md)

## Problem

The `dsh-writing` preset was a row-level migration of a 0.1.5 coding composition, and its prompt showed it: the persona opened with "You are a coding agent powered by the {{model}} model", the goal command/tool (an autonomous-pursuit coding workflow) was mounted, and the canvas guidance section repeated per-tool mechanics the tool descriptions already carry. User-observed symptoms in writing sessions: half-width commas inside Chinese sentences, and coined/odd words. A further directive: a preset's own prompt sections should be single-language, because mixed-language prose hurts the model's output voice — and the identity must not be "Chinese writer", because English pieces are in scope too.

## Decision

Retune the writing preset's prompt (2026-09-29), in `packages/presets/cordis.patch.yml`, as single-language **English** — the host prompt's own voice, the only language the whole system prompt can actually be uniform in (official sections and tool catalogs are English regardless):

- **Persona** — "You are a writer, powered by the {{model}} model." carrying the plain-language style rules (general reader, clear-over-clever, the common vocabulary **of the output language**, never coin words) and the punctuation rule (punctuation follows the output language: full-width marks in Chinese text — never a half-width comma or period there — half-width in English). "Writer", not "Chinese writer": English pieces are in scope.
- **Goal rows removed** (`command-goal` + `tool-goal`) — goal mode is a coding workflow the writing scene never drives. Dev and dsh-eval presets keep theirs.
- **Plan-mode section stays the official English text** — verbatim tracking keeps upstream improvements flowing. Plan mode itself stays: outlining before drafting is a writing workflow.
- **Canvas guidance slimmed to one English pointer sentence** (`packages/canvas/src/agent.ts`) — every behavioral rule (ghost-card flow, never paste card text as a substitute, comment style, manuscript `baseVersion`, no-canvas fallback) already lives in the tool descriptions; the system-prompt section now only says the `canvas_*` tools act on the canvas currently open in the right-sidebar tab. The canvas's tool descriptions stay Chinese (the package's writing-domain voice) — sections and catalogs are separate layers.
- **Preset description fixed** — it previously read as the coding agent's ("功能完整的编码 Agent…").

## Alternatives considered

**Single-language Chinese sections.** Implemented first, then revised the same day: the host's official sections and the tool catalogs are English no matter what, so Chinese sections only move the seam — English is the one language the prompt can be uniform in. Chinese also tempted the identity into "Chinese writer", which wrongly narrows the scene.

**Keep the sections bilingual.** Rejected — mixed-language prose was named as a performance concern by the maintainer.

**Drop plan mode from the writing preset.** Rejected — outlining is a writing workflow; only the text was coding-flavored, and the official English text is scene-neutral.

**Delete the canvas guidance section outright.** Rejected — a one-line pointer (tools exist, they act on the open tab) costs almost nothing and orients the model before it reads the catalog; everything beyond the pointer was duplication.

## Consequences

Writing-mode sessions get a writer identity, style constraints, and a punctuation rule that covers Chinese and English output; goal UI/tools disappear from the preset; the canvas section costs one sentence instead of six. The `presets.spec.ts` composition pins and canvas's `agent.spec.ts` guidance pins were updated to the new contract (no goal rows, English writer-persona markers, pointer-only section). The canvas package's own profile-root `./agent` row inherits the same slimmer section — acceptable because its tool descriptions carry the rules.

## Testing

`pnpm --filter @khorsheed/dsh-presets --filter @khorsheed/dsh-canvas build` and `test` green against the pinned 0.2.0-rc.2 checkout. Live confirmation of the model-facing effect (punctuation, vocabulary) is the maintainer's 3080 review.

## Related

- [host 0.2.0-rc.2 adaptation](../process/2026-09-29-host-020-rc2-adaptation.md) — the wave this tuning rides on.
