# Agent Note: Room——多 agent 群聊会话

Status: proposed

English | [中文](2026-08-18-room-multi-agent-conversation.zh.md)

## Problem

Working with several agents on one task today has no good shape. The main agent is a mandatory relay: every word to a local-agent CLI member (kimi / claude-code / codex) passes through the main agent's subagent tool, and every answer passes back the same way. The alternative is the human shuttling between separate sessions, carrying context by hand. In both shapes the coordination — who knows what, who waits on whom — lives in the human's head, not in the product.

The host already exposes every primitive needed (`ctx.sessions` with native `parentSession`, `ctx.subagents.start`, the local-agent family's resume registry, `agent.followup`/`inject`, merge-extensible custom session events, and the `conversation.composer` / `conversationEvents` / `conversation.chat.node` client slots). Nothing composes them into a group-conversation shape. The constraint is firm: no upstream (`deepseek-harness`) changes — the room must be buildable from official capabilities plus changes to our own packages only.

## Proposal

A new package (working name `@khorsheed/dsh-room`). **A room is a normal dsh session marked as a room, whose standard chat UI hosts several peer agents addressed by @-mention.** The human is the central hub in phase 1; agent-to-agent conversation without the human relay is a later phase once the hub model runs smoothly.

### Session and member model

- Creating a room (a `+ New room` entry next to `+ New session`) creates a normal session and appends a `room/created` custom event. The event is the room's identity marker and the root of its journal — roster, dispatch records, and the blackboard are all custom session events on this session, so persistence and reload-replay come free.
- Members are peers; **@ is the only trigger**. The session's own main agent is a member with no privilege — not @-addressed, it perceives nothing and says nothing.
- An external member (e.g. `@ada`) is a local-agent family CLI provider delegation: one dsh child session (`parentSession = room session`) continued across turns through the family resume registry (`kimi -S` / `claude --resume` / `codex exec resume`). Each member keeps its own private CLI context; the child session's mirrored transcript is the full trajectory, viewable in the official UI.

### Dispatch and routing

- A `conversation.composer` chain contribution parses the input: `@name ...` dispatches to that member (multiple @ fan out to each), a bare message is recorded to the blackboard and triggers nobody (with a light UI hint), and the main agent is reached only by @-ing it like any other member. The composer @-menu lists **only existing members** — pure addressing, never invitation.
- Dispatch to a CLI member goes through the local-agent delegation facade (`ctx.localAgent.start` / `.resume` / `.cancel`, delivered by `proposals/active/2026-08-18-local-agent-delegation-api.md`); the room's CLI-member path sits behind one adapter interface and is absent until that facade lands on main — `ctx.get('localAgent')` probe plus method-existence check, so any intermediate room commit stays green on main without it. The main agent is not in the loop. Runs are async: the human may @ another member while one is running; per-member dispatch is FIFO (the family resume lock allows one in-flight resume per child session), different members run in parallel.

### Blackboard — the shared layer

- The room keeps a shared transcript (the blackboard) as custom events on the room session: human messages, dispatch records, and members' final replies.
- Every member dispatch carries the blackboard (initially: entries since that member's last dispatch; later a window/summary policy) inside the prompt text. This is what makes `@bill 基于 ada 的 API 出方案` work without the human relaying context — the room, not the human, owns the shared view.
- The blackboard is visible to humans and carried to members on dispatch, but **model-invisible to the main agent by default** (custom events are not part of `deriveMessages()`). The main agent can infer the roster from @-mentions in user messages it does see; it cannot see member replies. If this proves too amnesiac in practice, an opt-in `agent.inject` side-listen (silent, non-waking) is the sanctioned escalation — never write member output as model-visible `user/message` events.

### UI: member speech, running state, boundary events

The official chat design language (verified against `ui-conversation` in the harness): assistant speech has **no bubble and no card** — plain full-column markdown; metadata lives in 14px tertiary hover rows (`MessageIconActions`); non-conversational nodes (tool calls, commands, reasoning, compaction markers) converge on the 24px `DisclosureRow`; and there are no hard hairlines. The room stays inside this language — **multi-role identity is carried by an identity line, not a card**.

- **Member speech node** = identity row + unframed body + action row:
  - *Identity row*: a 16px member-color dot + the member name as a capsule (reusing the official `.refChip` shape that `@subagent` mentions render as inside user bubbles) + provider name in tertiary grey. The color dot is the only new visual vocabulary; each member gets a fixed color.
  - *Body*: full-column markdown via the official `MarkdownText`, typographically identical to main-agent speech.
  - *Action row*: the `MessageIconActions` chrome replicated in CSS Modules with the same 16px icons from `dsh-client-ui-primitives` — **copy**, **session jump** (into the member's child session), honest **duration** (dispatch→settle ms), hover-revealed **timestamp**. Deliberately absent: **branch/fork** (`forkAt` would fork the *room* session — undefined semantics over roster, blackboard, and resume locks) and **TPS/TTFT** (a CLI process run has no token stream; faking the number is worse than omitting it). The audited harness version's official set is copy/branch/runMs/TTFT/TPS/hover-time — no like/dislike exists there.
- **Running state** = a ToolRow-isomorphic 24px disclosure row (StateDot + `ada 正在工作… · 12s` + sweep animation with a `prefers-reduced-motion` fallback; M3 transcript deltas append a truncated trailing summary). **The whole row is a jump link into the child session**, with a trailing stop button wired to `localAgent.cancel`. Before M3 the child session shows only descriptor/turn-start (harmless); once incremental mirroring lands, the jump shows live work — the affordance ships in phase 1 and improves automatically.
- **Boundary events** (member joined/left, invite records) = compaction-marker-style dim single lines. message-tools' `WithdrawnDividerView` is the proven community template.
- **Engineering conventions**: CSS Modules + `--dsw-alias-*` semantic tokens only (every var with a fallback chain; dark mode comes free, zero JS theme logic), primitives from `dsh-client-ui-primitives`, node layout left to the official `.flowItem` 16px column rhythm, no custom backgrounds, borders, or dividers. The "quote reply" affordance from an earlier draft is cut — the blackboard already carries member output to whoever is @-ed next, and copy-paste covers the human's own referencing needs.

### Member management: the members tab and invitation

- A **members tab** in the room session's view navigation (the 对话/轨迹 row), registered via the `conversation.view` slot and titled `成员 (N)`. It owns everything member-related: roster rows (color dot, name, provider, status + elapsed, per-row `[编辑]` `[轨迹→]`, `[中断]` while running) and the invite entry. This replaces two earlier drafts — the header avatar strip and composer-@ invitation are both dropped; one place owns the roster.
- **Invitation dialog** (from the tab's `＋ 邀请成员`): provider picker (candidates from `ctx.localAgent.roster()`, logged-out providers greyed with login guidance), display name, role instructions, and an optional first task. Confirming writes the roster event and — when a first task is given — starts a fresh delegation with the instructions prepended; an empty first task means the member joins idle.
- **Role-instruction mechanism, honestly**: family CLI providers are one-shot `cli -p` processes with no system-prompt channel. Room prepends the instructions to the first dispatch — they persist in the member's own CLI session via the resume chain, equivalent in effect — and carries later edits as a context update inside the next dispatch (`你的角色指令更新为：…`). The main-agent member takes no instructions; it keeps the session's own setup.
- **Main-agent invitation**: the room registers a model-facing tool in room sessions, `room_invite({ provider, name, instructions, firstTask? })`. The human asks in prose ("请个后端工程师进来负责 API"); the main agent picks the provider, writes the instructions, and invents a name (ada/bill/cathy style); the call lands in the same room-service invite function as the dialog, producing an identical member record. Naming rules: unique within the room, no whitespace or `@` (composer @-addressing must stay parseable), display name decoupled from provider (`ada (kimi-cli)`) so two instances of one provider can coexist. Member rows may mark origin (invited by you / by the main agent); the members tab's edit affordance treats human-written and agent-written instructions alike.

### Member-to-member @ (phase 1: human-confirmed)

- A member's reply containing `@other` is detected on the projection path and surfaced as a pending dispatch card on the blackboard (`[confirm] [dismiss]`); only a human confirm triggers the relayed dispatch. Automatic cascading with a turn budget is deferred until usage proves the pattern. This is the seam that later becomes true agent-to-agent conversation (e.g. the room owner directly filing a requirement to a local-agent-admin member) once the human hub is no longer needed.

### Requirement for local-agent (filed; accepted as `proposals/active/2026-08-18-local-agent-delegation-api.md`)

> **Scenario**: a room plugin lets the human talk *directly* to local-agent CLI members, without the main agent relaying. Today a plugin acting on the user's behalf cannot continue a member's CLI conversation without reimplementing the family's internal intent-staging protocol.
>
> **Requests**: (1) a public continue API on `ctx.localAgent` encapsulating the ownership check, resume-intent staging, and the per-child-session resume lock — the family proposal names it `resume` per room-side review (avoiding the `continue` reserved word); (2) run-progress visibility (heartbeat first, transcript deltas later); (3) a cancel entry point for non-tool callers.
>
> **Constraints to preserve**: parent-session ownership check, resume handles never inside prompt text, one in-flight resume per child session.
>
> **Future**: agent-to-agent conversation builds on the same API once the human-as-hub model proves out.

Milestone coupling (room side): the facade's **M1** unblocks CLI-member dispatch (room works in its own worktree until then — scaffolding, blackboard, UI, and the main-agent member path have no dependency); **M2** heartbeat upgrades "dispatched" to "working… elapsed"; **M3** makes the running-row jump show live output; **M4** (delegation-mapping persistence) unblocks cross-restart continuation.

## Alternatives considered

### Why not route member chat through the main agent (status quo)?

That is the shape being escaped: every message pays a relay through a model that rephrases, forgets, and charges tokens, and the human can never address a member directly. The ownership model (`parentSession`-anchored delegation records) already permits direct dispatch, so the relay buys nothing.

### Why not the official continuable subagent API (`startContinuable` / `followup` / `reportFrom`)?

Semantically it is almost exactly the room's member model, but no production provider implements `prepareContinuable` — every shipped provider is `backgroundMode: one-shot`, and the family CLI providers run their own resume mechanism. Depending on it would be building on an unexercised seam; the family resume registry is the battle-tested path.

### Why not a dedicated room view (`conversation.view` tab) for the merged timeline?

An earlier draft rendered the merged timeline in a custom view tab. Rejected for the timeline: the room *is* the session, and the standard chat UI already supplies composer, markdown rendering, and scrollback; projection events + `conversation.chat.node` renderers achieve the merged multi-agent display inside it with far less surface and no UI fork. A custom composer was rejected for the same reason in favor of the official `conversation.composer` chain slot. (The slot is still used — for the members tab, which is management surface, not a second timeline.)

### Why not bordered member cards for member speech?

Cards with borders/backgrounds fight the official language: assistant speech is unframed full-column markdown, metadata lives in tertiary hover rows, and the codebase bans hard hairlines. The identity row (color dot + `.refChip` name capsule) delivers multi-role distinction using only official visual vocabulary.

### Why not invitation through the composer @-menu?

Invitation needs a name and role instructions — a form, not a keystroke. The composer @-menu stays pure addressing over existing members; invitation lives in the members tab dialog and the main agent's `room_invite` tool.

### Why not write member output as model-visible events in the room session?

It would let the main agent perceive member activity "for free", but it forces permanent awareness: context bloat, and a main agent that may spontaneously respond to member output. The default must be zero-awareness; `agent.inject` is the measured escalation if needed.

### Why not a new session type at the session-store level?

Session header schema is official and fixed; a `room/created` custom event delivers the same identity and replay semantics without host changes.

## Acceptance criteria

- A `+ New room` creation flow yields a session that opens as a room (identity recovered from the `room/created` event on reload); the view navigation gains a `成员 (N)` tab.
- Invitation dialog: provider list reflects `localAgent.roster()` login state; confirming with a first task starts a run, without one the member joins idle; role instructions are verifiably prepended in the child session's first turn.
- The main agent's `room_invite` tool produces an identical member record (agent-chosen name and instructions); duplicate or `@`/whitespace-containing names are rejected with a tool error.
- `@ada <task>` continues the same CLI conversation across turns (resume verified in the child session transcript); a bare message records to the blackboard and triggers no agent; two members run in parallel while two dispatches to the same member serialize.
- Member speech renders as identity row (color dot + name capsule + provider) + unframed markdown + action row (copy, session jump, duration, hover timestamp); no branch, no TPS; running rows jump to the child session and their stop button cancels; join/leave render as dim single lines. Dark mode correct via alias tokens only.
- Dispatch to a member carries the blackboard entries since that member's last dispatch; the main agent's `deriveMessages()` history contains no member output.
- Reloading the room session restores identity, roster, and blackboard from event replay.
- The package installs, runs, and uninstalls alone; without local-agent providers mounted, the room still works with the main agent as its only member; every intermediate commit is green on main without the local-agent facade (adapter probe).

## Risks

- **Turn latency, no streaming**: each member turn is a full CLI process lifetime; progress rendering rides the local-agent milestones (M2 heartbeat, M3 deltas) and degrades to a plain running row meanwhile.
- **Quadratic context cost**: the blackboard is copied into every member's private CLI context each dispatch; long rooms with many members multiply token cost. Needs a window/summary policy later.
- **Unverified seams**: the exact `parent` shape `ctx.subagents.start` accepts from a non-agent caller (absorbed into the local-agent facade, which resolves it via `ctx.agents.get`); `conversation.composer` chain semantics; `conversation.chat.node` coverage for our node kinds; `conversation.view` tab registration. Day-one spikes before building on them.
- **Replicated internal chrome**: `.refChip`, `MessageIconActions`, and `DisclosureRow` are not exported plugin API; we replicate their styles. Upstream visual drift is a maintenance tax — cosmetic, acceptable, but pinned by screenshot docs.
- **Member-@-member ambiguity**: a mention in prose vs an actual dispatch request is undecidable mechanically; phase 1 human confirmation contains this, but the parsing rule will need refinement.
- **Cross-package dependency**: room's CLI-member path depends on the local-agent facade (M1); the adapter keeps room green without it, but the headline feature ships only after M1 merges.
