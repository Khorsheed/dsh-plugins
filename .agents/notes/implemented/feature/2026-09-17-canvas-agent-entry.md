# Agent Note: canvas 0.4.2 — the session tools move to the `./agent` composition entry, in English

Status: implemented

English | [中文](2026-09-17-canvas-agent-entry.zh.md)

## Problem

M3 registered the two main-session canvas tools and their guidance section at the **profile root**: `ctx.inject(['tools'])` and `ctx.inject(['systemPrompt'])` in the root `apply`, so every session of every preset carried a Chinese canvas prompt section and saw `canvas_*` in its tool catalog. On 3080 the user asked for two changes: scope the tools by preset (writing mode only there), and write the guidance in English, the host prompt's own voice. The section text had also gone stale (it still named the tab「画布详情」, renamed in the topbar redesign).

The mechanism the split needed was already proven three times over: official subpath composition entries (`@deepseek-ai/dsh-tool-subagent-control/list-agents`, mounted by name in preset `agent.cordis.yml` files); preset agent-plane mounting, where the preset file's ctx resolves `ctx.get` up the scope parent chain to profile-root services while `ctx.inject(['tools'])`/`ctx.inject(['systemPrompt'])` land in the preset's own layers (the plan-mode precedent); and the local-agent family's documented rule for exactly this arrangement — **root row disabled + preset row granted, never both live, or same-named tools register twice**.

## Decision

**The tools and the guidance now live in `src/agent.ts`, a `./agent` composition entry.** Its `apply(ctx)` probes `ctx.get('canvasBoard')` (resolving up the scope chain to the root service — which is what makes preset-plane mounting work), registers `canvasMainSessionToolDefinitions(board)` through the deferred `ctx.inject(['tools'])` door with the same no-import origin tagging, and registers the guidance section through `ctx.inject(['systemPrompt'])` (name still `canvas:tools`, order 151). A missing `canvasBoard` warns and registers nothing — degrade, never explode. The root `apply` in `src/index.ts` registers neither anymore and says so in its docstring.

**The guidance is rewritten in English** in the host prompt's imperative voice, with the three rules the model must not relearn per session: proposals land as ghost cards through `canvas_propose_card` (never paste card text into the reply as a substitute), comments through `canvas_comment` name one hidden assumption or tension and end with one sharp question, and with no canvas open the tool says so — ask the user, never guess. The tab is named by its current label: the right-Sidebar **Canvas** tab.

**The shipped patch mounts the entry at root, with the scoping recipe in comments.** `cordis.patch.yml` gains a second row, `- id: canvas-agent, name: "@khorsheed/dsh-canvas/agent"` — the community default is every session (the pre-0.4.2 status quo, so plugin-add changes nothing for existing users). A preset-scoped deployment disables that row in its profile patch (`- id: canvas-agent, disabled: true`) and names the same entry in the target preset's `agent.cordis.yml` — **never both at once** (the double-registration rule, written into the patch comments). The identity triangle is untouched: the patch still mounts the package's own `canvas` row, and the checker confirms the extra subpath export is free (0 findings).

## Alternatives considered

### Why not gate the root registration with a plugin config (`tools: all|none`)?

Config answers "off for this instance", not "only this preset". A per-instance switch still forces the Chinese prompt and the catalog presence on every session of a multi-mode deployment, and the config would need a Remote round-trip to reach the preset boundary the user actually drew. The composition-entry split is the official shape for preset grants, and it costs one small file.

### Why not register the tools inside each canvas session's setup (like side-chat's openWith)?

openWith covers the side-chat canvas context — a different, separate entrance that stays untouched. The main session has no canvas-owned agent setup to hang tools on, so a composition-level row is the only mount point; making the row a named entry is what lets a deployment move it between root and preset.

### Why not translate the guidance and keep the Chinese section alongside?

Two sections of the same guidance is double the prompt budget for zero information. The host prompt is English; the section should read like the rest of it. The zh tab label stays in the UI (locale-owned), the prompt speaks the model's language.

## Consequences

- `packages/canvas/src/agent.ts` (new): the `./agent` composition entry (probe, tools, English guidance).
- `packages/canvas/src/index.ts`: the root `apply` drops both registrations (and the now-unused tools import); docstring records the split.
- `packages/canvas/cordis.patch.yml`: second row `canvas-agent` with the disable-and-grant recipe in comments.
- `packages/canvas/package.json`: `exports` gains `"./agent"` (`types: ./lib/types/agent.d.ts`, `default: ./lib/agent.js`, the official `list-agents` shape); version 0.4.1 → 0.4.2. `tsconfig.host.json` lists `src/agent.ts`.
- `tests/agent.spec.ts` (new, 3 cases): registration into the scope (two tools, origin tags, the English section's name/order/content and no CJK), degrade on absent `canvasBoard` (warn, nothing registered), and the root apply registering neither tools nor section.
- Both READMEs: a "按 preset 收敛会话工具 / Scoping the session tools to a preset" section with the 3080-style config sample; the Compatibility bullet and the internals section now point at `./agent`.
- On 3080 the operator's side (profile patch disable + the dsh-writing preset row) is a config change, not a code change — exactly what the entry exists to enable.
- The side-chat `openWith` tool injection is a separate entrance and is untouched.

## Testing

- `packages/canvas`: **167 tests green** (164 before, +3 agent-entry cases). `rm -rf lib` then `pnpm --filter @khorsheed/dsh-canvas build` (`lib/agent.js` + `lib/types/agent.d.ts` emitted), `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` all green.
- NOT verified inside a live preset on 3080 (the operator applies the preset row at deploy time); the entry's registration and degrade are covered against a real cordis Context.

## Deferred

- `canvas_propose_draft` + the candidate-diff banner, the remaining stats rules, web search wiring (later M3); document-card html rendering, session-side `canvas_search`/`canvas_clip` (M4).
- The 3080 operator configuration itself (profile patch `disabled: true` + the dsh-writing `agent.cordis.yml` row) — deploy-time, main agent's side.

## Related

- [M3 note](2026-09-16-canvas-rightbar-rework.md) (the tools' origin (root registration this supersedes); the focus model they still use).
- [Topbar note](2026-09-17-canvas-topbar-redesign.md) (the tab rename the guidance text now matches).
- [plugin-visibility convention](../../../docs/plugin-visibility.md) (the layer table this follows: tools ride the preset grant; the tab stays install-layer).
