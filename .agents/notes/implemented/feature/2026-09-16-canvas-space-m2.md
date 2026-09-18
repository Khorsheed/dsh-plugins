# Agent Note: canvas M2 — chat integration through the side-chat seam

Status: implemented

English | [中文](2026-09-16-canvas-space-m2.zh.md)

## Problem

M1/M1.5 delivered the card board with ghost proposals and comments, but no way to *reach* an agent: the proposal's「板主聊辅」needs a chat where the agent comments, proposes cards, and pushes thinking deeper. The naïve path — a canvas-owned chat UI and agent session (the proposal's original §6) — was superseded before M2 began: `@khorsheed/dsh-sidechat` 0.1.0 landed with exactly the seam the canvas needs (`ctx.sideChat.openWith` for priming a per-context agent, a right-Sidebar tab for the conversation, per-turn prompt freshness, caller-supplied tools). M2's problem is therefore three-fold, and each part is about NOT rebuilding what now exists.

**How does the canvas ask through side-chat without depending on it?** The board must keep working when side-chat is absent, and the edge must stay one-way (side-chat never mentions canvas).

**How do the canvas's tools reach ONLY the canvas's agent?** A global `ctx.tools.register` would put canvas tools into every ordinary session; the right scope is the canvas's own side-chat context — which exists lazily, only after the first send.

**How does the board SEE what the agent did?** Tool calls land host-side during a turn the client did not run; the board must refresh as ghost cards appear, without standing polling.

And a fourth, orthogonal one from the proposal's M2 line: **the space should hide itself in presets that do not include it** (writing-mode visibility), without ever disappearing from a preset-less profile like 3080's web.

## Decision

**The seam is one verb, probed, and the client gates on a status probe.** `askAgent` (agent-first, so the calling session primes the context) probes `ctx.get('sideChat')` — a structural mirror interface, zero sidechat imports, the service name declared in the manifest's `dsh.references` (the repo's data-reference mechanism; `pnpm check:plugins` needed no sanction entry and stays green). On a hit it calls `openWith({ contextKey: 'canvas:<id>', label: <topic>, systemPrompt, tools, refs })`; on a miss it answers `unavailable`, and a separate `chatStatus` read verb lets the client hide every chat entry (lens bar, comment 追问, detail 问 Agent) from the first paint — the board is fully usable without chat.

**The system prompt is a pure renderer, fresh per ask.** `prompt.ts` renders the segment from the board: topic and goal / the board summary (per-kind counts, kept-card one-liners, the open-question list) / the grounding guardrail (kept grounding cards are user-confirmed positions the agent must not contradict) / the tool contract (propose via tool, comment via tool, never paste cards into prose; agent comments move open questions to exploring; answered is user-only) / lens semantics (the active lens named) / the stats feedback section (§4: ≥5 verdicts and <30% acceptance → tighten proposals). side-chat's per-turn contract re-reads the latest `openWith` segment at every assembly, so each ask refreshes it. Selected cards cross as **opaque refs** (`{ label, text }`) — the chat context knows nothing about cards (the proposal's 选区即上下文 protocol).

**Two tools ride `openWith`, tagged the no-import way.** `canvas_propose_card(kind, text, source?, comment?)` and `canvas_comment(cardId, text)` are `defineTool` definitions built per ask and attached by side-chat to the canvas context's agent — never globally registered, so ordinary sessions never see a canvas placeholder. Origin tagging uses the `Symbol.for('dsh.tool.origin')` property directly: capability-catalog's own tool-origin module documents that a plugin "may tag without importing anything", which keeps the cross-plugin edge count at exactly one (sidechat). Both delegate to the board service's own paths — a new `proposeCard` (proposed, createdBy agent, rationale hung as an agent comment; a proposed question card starts OPEN — the §4 exploring rule targets comments on cards already on the board, not the proposal's arrival) and M1's `addComment` with `author: 'agent'`. Execution fences with `exec.agent.session` (the canvas agent's own) when the run context carries it, else the asking session — the same re-rooted fence as every other write.

**The send rule is deliberately small.** A gesture's free text wins (comment 追问）, else a non-`ask` lens's prompt template (the seven working lenses), else prime-only (`ask`, and the detail's text-selection 问 Agent， whose selection rides as a ref while the user types the question). When the host's `sideChat.send` exists, askAgent calls it after priming — the closed loop 选卡 → 提问 → 幽灵卡落板 → 收下 actually runs, not just primes.

**The board learns through the existing rev channel, fed by a probed turn watch.** After a sent ask, the client polls `remote.sidechat.getState` (another structural mirror, `ctx.get`-probed) every 2s while the context reports `running` (cap 60 polls), `touch()`-ing the shared selection store each time — the M1.5 rev channel then re-reads both seats, so ghost cards appear as the agent's tool calls land. No watch, no standing poll: external edits still surface through the version guard on the next gesture.

**Preset self-hide is the room criterion, fail-open everywhere.** `client/preset-visibility.ts` reads the official `pluginInventory` Remote (probed, never injected): the space's four registrations (rail row, main panel, tab type, tab body) live under `RegistrationToggle`s and exist only while the CURRENT session's preset group names `@khorsheed/dsh-canvas`. Every unreadable path — no namespace, pending/failed RPC, missing or `broken` group, a session with no preset — fails OPEN (visible), so 3080's web profile never loses the space. Hiding the ACTIVE main panel first `selectPanel(null)`s through a probed layout face so the frame is never stranded on an unregistered key.

## Alternatives considered

### Why not auto-send every gesture (including 就此提问 and 问 Agent)?

Priming without sending hands the user a ready context — the selected cards as chips, the prompt fresh — and lets them type the actual question. Auto-sending a canned "the user wants to ask something" text would burn a turn on a non-question and train the agent to answer noise. The working lenses auto-send because their template IS the question; `ask` exists precisely for the user's own words.

### Why not import sidechat's types (or its package) instead of mirroring structurally?

The cross-plugin rule: one edge, declared, degraded — never an import. A type import is still an edge (check:plugins' `cross-plugin import` fires on it, and there is no sanctioned canvas↔sidechat pair; the task forbids touching the shared checker). Structural mirrors carry the call shapes canvas actually uses (`openWith` input, `send`, `getState` status) and degrade by construction — a seam that cannot send still primes.

### Why not register the canvas tools globally and let the model find them in any session?

The proposal's M2 contract is explicit: the tools attach to the canvas context's agent via `openWith`, so ordinary sessions never carry canvas placeholders, and the tool's own lifecycle (create lazily, live-replace by name) is side-chat's tested machinery. A global registration would also need its own preset-gating to stay honest — duplication for a worse outcome.

### Why not have the canvas agent's cwd set to the first attached workspace (proposal §6)?

side-chat's `inheritCwd` owns that decision (the calling session's cwd when the contextKey is not a live session) and canvas does not reach across to change another package's contract. The current rule is benign — the canvas state dir is fenced by the plugin's own boundary, and the agent's file gestures stay inside the calling session's workspace. Recorded as a deviation, not patched.

### Why not push board updates through a host event instead of the client's turn watch?

There is no canvas→client event channel in the Remote protocol for this (the wire is request/response; side-chat's events are its own). The watch reuses the M1.5 rev channel and the probed `getState` status, is exactly scoped to the turn the user just sent, and stops on its own. A standing subscription is more machinery for the same visible result.

## Consequences

- `packages/canvas/src/types.ts`: the lens vocabulary (`CANVAS_LENS_IDS`), `BoardRef`, `BoardAskAgentRequest/Outcome`, `BoardChatStatusResult`, `BoardProposeCardRequest`.
- `packages/canvas/src/prompt.ts` (new): `renderCanvasPrompt`, `cardToRef`, `lensSendText`, `CANVAS_LENS_LABELS` — all pure, all tested.
- `packages/canvas/src/tools.ts` (new): `canvasToolDefinitions` (the two tagged tools); peerDep `@deepseek-ai/dsh-tools` (wide, optional) + devDep.
- `packages/canvas/src/store.ts`: `proposeCard`, `askAgent`, `chatAvailable`, and the `SideChatMirror` structural seam.
- `packages/canvas/src/remote.ts`: `askAgent` (agent-first) + `chatStatus` (agentless). **The M1 verbs are untouched.**
- `packages/canvas/src/client/preset-visibility.ts` (new): `CanvasPresetVisibility` + `RegistrationToggle` (+8 spec cases).
- `packages/canvas/src/client/index.ts`: the chat face (`askAgent` with the turn watch, `chatStatus`, `openSideChat` via structural-mirror `openTab('sidechat', { params: { contextKey } })`), the four visibility toggles, `inject` gains `sessions`.
- `BoardView`: the lens bar inside the selection bar + 追问 on agent comments. `CanvasDetailView`: the floating 问 Agent over a text selection + 追问 + the chat gate. `CanvasSpacePage`: the probe + ask flow.
- `package.json` 0.2.0 → 0.3.0; `dsh.references: ['@khorsheed/dsh-sidechat']`; compat notes record the seam. devDep `@deepseek-ai/dsh-api-session-controller` (the `ctx.sessions` type merge).
- The canvas agent's cwd follows side-chat's `inheritCwd` (the calling session's), a recorded deviation from proposal §6.
- `canvas.json` still stores nothing about chat: the contextKey derives from the canvas id, and side-chat owns the context→session mapping (the `chat.sessionId` field stays null).

## Testing

- `packages/canvas`: **166 tests green** (134 at M1.5's merge): `ask.spec.ts` 13 (the priming contract — key/label/segment contents/tagged tools/refs; the three send rules; unavailable/io/invalid/missing; stats feedback; `proposeCard`), `tools.spec.ts` 5 (names, descriptions, origin tag, propose/comment delegation incl. the exploring rule, failure-as-text, fence-session preference), `remote.spec.ts` +2 verbs, `space.client.spec.tsx` 15 (lens bar → askAgent → openSideChat; 追问； full-hide degrade), `detail.client.spec.tsx` 13 （问 Agent selection ref; 追问； full-hide), `preset-visibility.spec.ts` 8 (the fail-open matrix + toggle lifecycle).
- `pnpm --filter @khorsheed/dsh-canvas build` (gen-typert → tsc → tsdown), `pnpm check:hygiene -- packages/canvas`, `pnpm check:plugins`, `pnpm test:scripts` all green.
- NOT done: a live model turn on 3080 (deploys stay coordinated; the tool-execution path is covered against the real service, and the seam contract against a recording fake).

## Deferred

- `canvas_propose_draft` + the candidate-diff flow, the stats-driven rules beyond the prompt feedback section, web search wiring (M3); draft view, html asset rendering + the assets read verb, session-side `canvas_search`/`canvas_clip` (M4).
- The turn watch is a client poll, not a push channel; replacing it with a host event is upstream's seam to offer, not canvas's to build.
- Paste-to-create, canvas renaming, attach-list editing after creation.

## Related

- [M1 note](2026-09-16-canvas-space-m1.md), [M1.5 note](2026-09-16-canvas-space-m1-5.md).
- [side-chat M1 note](2026-09-16-side-chat-m1.md) (the seam this consumes).
- [canvas-space proposal](../../../proposals/active/2026-09-16-canvas-space.md) (§3/§6/§7, milestone M2).
