# Agent Note: Room——多 agent 群聊会话

Status: proposed

English | [中文](2026-08-18-room-multi-agent-conversation.zh.md)

## Problem

Working with several agents on one task today has no good shape. The main agent is a mandatory relay: every word to a local-agent CLI member (kimi / claude-code / codex) passes through the main agent's subagent tool, and every answer passes back the same way. The alternative is the human shuttling between separate sessions, carrying context by hand. In both shapes the coordination — who knows what, who waits on whom — lives in the human's head, not in the product.

The host already exposes every primitive needed (`ctx.sessions` with native `parentSession`, `ctx.subagents.start`, the local-agent family's resume registry, `agent.followup`/`inject`, merge-extensible custom session events, and the `conversation.composer` / `conversationEvents` / `conversation.chat.node` / `conversation.input.dock` client slots). Nothing composes them into a group-conversation shape. The constraint is firm: no upstream (`deepseek-harness`) changes — the room must be buildable from official capabilities plus changes to our own packages only.

## Proposal

A new package (working name `@khorsheed/dsh-room`). **A room is a normal dsh session marked as a room, whose standard chat UI hosts several peer agents addressed by @-mention.** The human is the central hub in phase 1; agent-to-agent conversation without the human relay is a later phase once the hub model runs smoothly.

### Session and member model

- Creating a room (a `+ New room` entry in `sidebar.footer.action`) creates a normal session and appends a `room/created` custom event — the room's identity marker and the root of its journal. Roster, dispatch records, speech projections, and the task board are all custom session events on this session, so persistence and reload-replay come free (the event types are registered into the persistence catalog at apply time — see the implemented bug-fix note for the catalog finding).
- The session's own main agent is a member with no privilege. **A message without @ is a normal conversation with the main agent** (the composer passes it through to the official submit path); **@ is the dispatch trigger**. The main agent therefore perceives the human's non-dispatch messages natively (they are ordinary `user/message` events) and sees nothing of member speech.
- An external member (e.g. `@ada`) is a local-agent family CLI provider delegation: one dsh child session (`parentSession = room session`) continued across turns through the family resume registry. Each member keeps its own private CLI context; the child session's mirrored transcript is the full trajectory.
- **Per-member `cwd`**: members may legitimately work in a different working directory than the room session (the main agent in repo A, a CLI member in repo B). The invite dialog carries a cwd field (default: inherit the room session's cwd); delivery needs a facade-level override (Requirement R2 below).

### Dispatch and routing

- A `conversation.composer` chain contribution parses the input: text opening with `@name` tokens dispatches to those members (multiple @ fan out); **anything else passes through untouched to the official composer behavior** (a normal main-agent turn). The composer @-menu lists only existing members — pure addressing, never invitation.
- Dispatch to a CLI member goes through the local-agent delegation facade (`ctx.localAgent.start` / `.resume` / `.cancel`); the room's CLI-member path sits behind one adapter interface and is absent when the facade is missing — `ctx.get('localAgent')` probe plus method-existence check, so room installs and runs with the main agent as its only member. The main agent is not in the dispatch loop. Runs are async: per-member dispatch is FIFO (the family resume lock allows one in-flight resume per child session), different members run in parallel.

### Member context: roster + notifications (no ambient transcript, no global view)

There is no blackboard, and no member perceives the room's full picture. An earlier draft carried a rolling transcript digest into every dispatch; it was cut — quadratic context cost, and a dumb relay of everything is worse than a smart note from the sender. Each dispatch's prompt carries only three things:

1. **The roster**: member names, providers, and one-line roles — knowing who exists is the whole prerequisite for being able to @ anyone; knowing what others are doing is not.
2. **Notifications**: pending notifications addressed to this member (below).
3. The dispatch text itself.

Coordination knowledge travels inside messages, not injections: in "@ada 设计 API，做完告诉 bill", "tell bill when done" is part of the task text; ada records it in its *own* todo list (its own session, mirrored per R3) and emits the notification when done — the room's mechanism only delivers it. The member's own private CLI context (resume chain) holds its working memory; the room never re-sends history the member already saw.

### Task board — the coordination artifact

- The room keeps a **persistent task board**: assignments per member with status (`pending` / `in_progress` / `done` / `cancelled`). It is journal-driven (`room/task-*` custom events), so it survives reload and replay like everything else.
- **Human management surface**: rendered in the room session via the `conversation.input.dock` slot (the official seam for "a line of its own above the composer" — the same posture as the official todo strip), grouped by member. The human can add, reprioritize, reassign, and close tasks there. **The board is the human's management view only — it is never injected into a member's prompt**: coordination rides the messages and the notification protocol, not a panoramic injection.
- **Not `todo/write`**: the official todo panel is the agent's per-turn working plan and is cleared on the next `turn/start` — a persistent multi-member board must not parasitize that semantics. Member tasks enter the board from dispatches (a @-dispatch opens a task; the member's finished speech closes it) and from explicit human edits.
- **Members' own todos stay in their own sessions**: a CLI member's internal todo list is mirrored into its child session by the family (Requirement R3) and rendered there by the official todo strip, untouched.

### Notifications: member-to-member relay (phase 1: human-confirmed)

- **Primary channel (bridge)**: the local-agent family's member-channel proposal (`proposals/active/2026-08-19-local-agent-member-channel.md`) injects a bridge MCP tool `member_message(to, text)` into member CLIs (per-run one-time token auth, host-side same-parent check) — a structured tool call, deliverable mid-run, with unforgeable identity.
- **Gate handoff**: before delivering, the family bridge probes `ctx.get('room')`; when the parent session is a room it does NOT deliver directly but calls the room's receiver `room.receiveMemberMessage({ from, to, content, parentSessionId, provenance })`, and the room decides per its gate config — **pending-confirm card** or **auto-dispatch**. With no room (or a non-room parent), the family delivers directly. The gate has exactly one owner: the room.
- **Receipt pass-through**: the gate outcome (`sent` / `pending-confirm` / `busy`) travels back through the bridge to the sending member, keeping its conclusion honest ("notified, awaiting the room owner's confirm" ≠ "delivered").
- **Fallback channel (text parsing)**: without the bridge (older family builds, non-family members), the room detects an own-line `@name <content>` at the end of a member's reply as a pending relay (the format is stated in the roster injection, so "mentioning" in prose is mechanically distinguishable from "notifying").
- A pending relay is journaled (`from`, `to`, `content`, provenance) and rendered as a confirmation row (`[确认派发] [忽略]`); confirming dispatches it as the addressee's next-round prompt (`ada 给你的通知: …`).
- Phase 2 turns the gate to `auto` with a cascade budget (max N relayed rounds per human message, no empty-content ping-pong, exhaustion degrades back to confirm).

### UI: member speech, running state, boundary events

The official chat design language (verified against `ui-conversation` in the harness): assistant speech has **no bubble and no card** — plain full-column markdown; metadata lives in 14px tertiary hover rows (`MessageIconActions`); non-conversational nodes converge on the 24px `DisclosureRow`; and there are no hard hairlines. The room stays inside this language — **multi-role identity is carried by an identity line, not a card**.

- **Member speech node** = identity row + unframed body + action row:
  - *Identity row*: a 16px member-color dot + the member name as a capsule (reusing the official `.refChip` shape that `@subagent` mentions render as inside user bubbles) + provider name in tertiary grey. The color dot is the only new visual vocabulary; each member gets a fixed color.
  - *Body*: full-column markdown via the official `MarkdownText`, typographically identical to main-agent speech.
  - *Action row*: the `MessageIconActions` chrome replicated in CSS Modules with the same 16px icons from `dsh-client-ui-primitives` — **copy**, **session jump** (into the member's child session), honest **duration** (dispatch→settle ms), hover-revealed **timestamp**. Deliberately absent: **branch/fork** (`forkAt` would fork the *room* session — undefined semantics over roster and resume locks) and **TPS/TTFT** (a CLI process run has no token stream; faking the number is worse than omitting it). The audited harness version's official set is copy/branch/runMs/TTFT/TPS/hover-time — no like/dislike exists there.
- **Running state** = a ToolRow-isomorphic 24px disclosure row (StateDot + `ada 正在工作… · 12s` + sweep animation with a `prefers-reduced-motion` fallback; the family's live transcript mirroring appends a truncated trailing summary). **The whole row is a jump link into the child session**, with a trailing stop button wired to `localAgent.cancel`.
- **Boundary events** (member joined/left, relay records) = compaction-marker-style dim single lines. message-tools' `WithdrawnDividerView` is the proven community template.
- **Engineering conventions**: CSS Modules + `--dsw-alias-*` semantic tokens only (every var with a fallback chain; dark mode comes free), primitives from `dsh-client-ui-primitives`, node layout left to the official `.flowItem` 16px column rhythm, no custom backgrounds, borders, or dividers.

### Member management: the members tab and invitation

- A **members tab** in the room session's view navigation (the 对话/轨迹 row), registered via the `conversation.view` slot. It is pure member management: roster rows (color dot, name, provider/harness, model when knowable — a CLI member's model lives in its scoped-home config and may not be reported, then simply omitted — role instructions, status + elapsed, per-row `[编辑]` `[轨迹→]`, `[中断]` while running, `[移除]`) and the invite entry. Tasks do not live here — they live in the dock task board.
- **Invitation dialog**: provider picker (candidates from `ctx.localAgent.roster()`, logged-out providers greyed with login guidance), display name, role instructions, **cwd** (default: inherit the room session's), and an optional first task. Confirming writes the roster event and — when a first task is given — starts a fresh delegation with the instructions prepended; an empty first task means the member joins idle.
- **Role-instruction mechanism, honestly**: family CLI providers are one-shot `cli -p` processes with no system-prompt channel. Room prepends the instructions to the first dispatch — they persist in the member's own CLI session via the resume chain, equivalent in effect — and carries later edits as a context update inside the next dispatch (`你的角色指令更新为：…`). The main-agent member takes no instructions; it keeps the session's own setup.
- **Main-agent invitation**: the room registers a model-facing tool in room sessions, `room_invite({ provider, name, instructions, firstTask?, cwd? })`. The human asks in prose ("请个后端工程师进来负责 API"); the main agent picks the provider, writes the instructions, and invents a name (ada/bill/cathy style); the call lands in the same room-service invite function as the dialog. Naming rules: unique within the room, no whitespace or `@` (composer @-addressing must stay parseable), display name decoupled from provider (`ada (kimi-cli)`) so two instances of one provider can coexist.

### Requirement for local-agent

The delegation facade (`start` / `resume` / `cancel`, reattach recipe, progress events, `delegations.jsonl` persistence — proposal `proposals/active/2026-08-18-local-agent-delegation-api.md`, M1–M4) is **delivered and verified**. Three further asks, filed with the family:

> **R1 — Two-way member channel**: ~~implement the official continuable interface~~ — rejected by the family's review (`prepareContinuable` only returns seed data; the continuation manager creates and drives an in-process dsh Agent unrelated to the CLI; the official README leaves host-user continuation open), **superseded by the member-channel proposal**: a writable composer (chain-priority shadow of the read-only takeover) + `promptMember`/`stopMember` remotes + bridge-MCP member messaging. Room's cooperation point: expose the `receiveMemberMessage` gate entry (see Notifications). R1 no longer asks for continuable.
>
> **R2 — Per-call cwd override**: add `cwd?: string` to `DelegationCallOptions`; providers prefer it over `parent.session.header.cwd`. Room members legitimately work in different directories than the room session.
>
> **R3 — Todo state mirroring**: when a CLI member uses its own todo/plan feature, mirror the state into the child session as `todo/write` events so the member's own session shows its plan in the official todo strip.

## Alternatives considered

### Why not route member chat through the main agent (status quo)?

That is the shape being escaped: every message pays a relay through a model that rephrases, forgets, and charges tokens, and the human can never address a member directly. The ownership model (`parentSession`-anchored delegation records) already permits direct dispatch, so the relay buys nothing.

### Why not the official continuable subagent API (`startContinuable` / `followup` / `reportFrom`)?

Semantically it is almost exactly the room's member model, but no production provider implements `prepareContinuable` — every shipped provider is `backgroundMode: one-shot`, and the family CLI providers run their own resume mechanism. The resume registry is the battle-tested path; the family adopting the continuable interface (Requirement R1) is tracked as an upgrade, not a dependency.

### Why not a blackboard (rolling transcript digest injected into every dispatch)?

The first-cut design. Cut after review: it multiplies context cost by member count, delays everything to the recipient's next wake-up, and — decisively — a notification written by the sender who knows what the recipient needs beats a mechanical digest of everything. The roster-only injection preserves the one prerequisite for addressing (knowing who exists); directed notifications carry the content. Journal events remain as UI projection and replay; nothing is deleted, one consumption path is.

### Why not build the task board on the official `todo/write` mechanism?

The official todo panel is the agent's per-turn working plan, cleared on the next `turn/start` — a persistent multi-member board would vanish under the main agent's next turn and fights the flat per-session semantics. The board uses the same *posture* (the `conversation.input.dock` strip above the composer) with its own journal-driven data. Members' own todos still mirror into their child sessions as genuine `todo/write` (Requirement R3), where the official strip renders them natively.

### Why not a dedicated room view (`conversation.view` tab) for the merged timeline?

The room *is* the session; the standard chat UI already supplies composer, markdown, and scrollback; projection events + `conversation.chat.node` renderers achieve the merged multi-agent display inside it with far less surface and no UI fork. (The view slot is still used — for the members tab, which is management surface, not a second timeline.)

### Why not bordered member cards for member speech?

Cards with borders/backgrounds fight the official language: assistant speech is unframed full-column markdown, metadata lives in tertiary hover rows, and the codebase bans hard hairlines. The identity row (color dot + `.refChip` name capsule) delivers multi-role distinction using only official visual vocabulary.

### Why not invitation through the composer @-menu?

Invitation needs a name, role instructions, and a cwd — a form, not a keystroke. The composer @-menu stays pure addressing over existing members; invitation lives in the members tab dialog and the main agent's `room_invite` tool.

### Why not write member output as model-visible events in the room session?

It would let the main agent perceive member activity "for free", but forces permanent awareness: context bloat, and a main agent that may spontaneously respond to member output. Member speech stays model-invisible; the main agent natively sees the human's non-dispatch messages (bare messages pass through as ordinary turns), which is the right awareness floor.

### Why not a new session type at the session-store level?

Session header schema is official and fixed; a `room/created` custom event delivers the same identity and replay semantics without host changes.

## Acceptance criteria

- A `+ New room` creation flow yields a session that opens as a room (identity recovered from the `room/created` event on reload); the view navigation gains a members tab; the dock shows the task board once tasks exist.
- A message without @ produces a normal main-agent turn; `@ada <task>` dispatches (fresh first, resume after — verified in the child session transcript); unknown members are rejected with a structured error; two members run in parallel while two dispatches to the same member serialize.
- Every dispatch prompt contains the roster, pending notifications for that member, and the dispatch text — and **no rolling transcript, no task-board digest** (a member is never re-sent what it already saw, and never sees the room's global view).
- Invitation dialog: provider list reflects `localAgent.roster()` login state; cwd defaults to the room session's and is honored per member (facade R2); role instructions are verifiably prepended in the child session's first turn. The main agent's `room_invite` tool produces an identical member record; duplicate or `@`/whitespace-containing names are rejected with a tool error.
- A member's directed own-line `@name <content>` produces a pending-relay row; human confirmation dispatches the notification to the addressee; dismissal drops it. Unconfirmed relays never reach anyone.
- Task board: a dispatch opens a task under the member, a finished speech closes it; the human can add/reassign/close tasks in the dock strip; the board survives reload via journal replay.
- Member speech renders as identity row + unframed markdown + action row (copy, session jump, duration, hover timestamp); no branch, no TPS; running rows jump to the child session and their stop button cancels; boundary events render as dim single lines. Dark mode correct via alias tokens only.
- Reloading the room session restores identity, roster, task board, and speech history from event replay (room event types registered in the persistence catalog).
- The package installs, runs, and uninstalls alone; without local-agent providers mounted, the room still works with the main agent as its only member.

## Risks

- **Turn latency, no streaming**: each member turn is a full CLI process lifetime; live mirroring (family M3) and the running row carry the progress story.
- **Notification-format drift**: members must emit the own-line `@name` convention for relays to be detected; role instructions and the roster injection state it, but models will occasionally mention-without-notifying (correctly ignored) or notify in prose (missed). Phase 1's human-confirm gate contains the false positives; false negatives are recovered by the human @-ing directly.
- **Task-board coherence**: the board is derived state written by both the room (dispatch open/close) and the human (edits); a member reporting progress cannot update it directly in phase 1 (it can only notify). Acceptable: the board is the human's management view, not the members' scratchpad.
- **Unverified seams**: `conversation.composer` pass-through of bare messages to the official submit path inside a takeover component; `conversation.input.dock` multi-entry coexistence with the official todo strip. Day-one spikes before building on them.
- **Replicated internal chrome**: `.refChip`, `MessageIconActions`, and `DisclosureRow` are not exported plugin API; we replicate their styles. Upstream visual drift is a maintenance tax — cosmetic, acceptable.
- **Cross-package dependency**: CLI members depend on the local-agent facade; R1/R2/R3 are family-side work tracked in the family's own proposal pipeline.
