# dsh-client-message-tools

English | [中文](README.md)

Edit, withdraw, and restore user messages in the dsh web GUI: every user message grows a copy / edit / withdraw action row. Withdrawals really remove the message (and everything after it) from the model context, collapse it into an expandable divider, and can replay it back at the tail — no core-package edits.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions1.png" width="480" alt="copy / edit / withdraw action row on a user message">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions2.png" width="480" alt="in-place editing: saving re-sends as a new message; the edited original leaves the model context">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions3.png" width="480" alt="the confirmation dialog before withdrawing, spelling out the consequences">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions4.png" width="480" alt="withdrawn messages collapse into a divider, restorable to the end of the conversation">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions5.png" width="480" alt="restored messages return to the conversation as they were">

## Features

- **Action row on every user message** — copy, edit, and withdraw on user bubbles and admitted steering messages.
- **Edit in place** — inline editor with a working model chip; saving regenerates the turn from that point, and edited bubbles edit again.
- **Real withdrawal, not a marker** — the message and the whole tail after it leave the model context, collapsing into an expandable 「已撤回 N 条消息」 divider.
- **Draft backfill** — a landed withdrawal puts the original text back into the composer draft, never auto-sent.
- **Restore to tail** — 「恢复到对话末尾」 replays user messages verbatim and assistant text as a 「已恢复」 group; tool calls never replay.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
```

Restart the web instance to activate; uninstall restores the previous composition exactly.

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-message-tools
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: chat-node owner props dropped `loadImage` for the required `renderMessageImages` attachment-slot renderer — stay on the previous build on rc.6/rc.7 hosts. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21)
- source line (deepseek-harness master): ✅

## Known Limitations

- **Full-span hiding relies on an undocumented DOM attribute** — if upstream drops it, hiding degrades to renderer-only (user messages still hidden) with one `console.warn`, never an error.
- **Edit is text-only** — image attachments of the original message are not carried into the resend.
- **Restore is a tail replay, not an in-place repair** — assistant text replays as framed user-role messages, tool calls/results never; the span stays out of the model context, and the restore entry exists only on withdrawal dividers.
- **Context and queued messages are out of scope** — context messages keep the official renderer (no action row); the official queue dock already edits/removes queued messages.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The browser half shadows the official user-message renderer (`conversation.chat.node`, keys `user` and `steering`, priority -1) with a visual clone that adds the action row, and registers four `ConversationNodeDefinition`s: a withdrawal projects as an expandable 「已撤回 N 条消息」 divider (N = user-visible messages hidden by the span), an edit replacement as an in-place bubble with an 「已编辑」 badge, and a restore entry as a replayed row in the 「已恢复」 group. The host half is the `messageTools` Typert Remote service (`withdraw` / `edit` / `restore`); the client mounts its generated Remote contribution via `ctx.remote.$mount`, so no core-package edits are needed.

**Edit** is an in-place replacement: the host appends one `user/message` replacement whose content IS the edited text (spanning the target and the surface tail — editing an old message discards what followed it), then starts regeneration via `agent.followup` with a minimal plugin-sourced trigger. The edited text appears exactly once in the model context; the old content stays in the log as the audit trail. A running turn is cancelled first and awaited until fully settled — settle means the cancelled turn's teardown (tool results, `turn/end`) has fully landed in the log, not the `running` flip; the wait is bounded, a turn that never settles rejects with 「编辑失败」, and a failed cancel rejects without editing. Edit chains work: an edited bubble edits again, targeting the previous replacement's seq. The editor's model chip shares the per-session `ModelDirectory` (`ctx.get('modelDirectories')`, optional) with the composer and the /model popup — without ui-model-selection no chip renders — and the switch applies to the regenerated turn.

**Withdrawal** is real, not a marker: the host appends a `user/message` surface replacement (the compaction mechanism) spanning the target and every surface node after it, so the span leaves `session.surface` and never reaches the model again; the same cancel-and-settle choreography as edit keeps streaming content from landing after the replacement. The event is plugin-sourced, cites every shadowed node in `sourceEventSeqs`, and is durable (`SessionStore.flush`) before the method returns — it is the audit trail. No new event type is introduced: an out-of-harness type cannot carry `ignorable: true`, and a persisted unknown type would make session-persistence refuse the log on reload. A landed withdrawal backfills the target's original text into the composer draft (blank fills, non-empty appends a new line, info notice) — never auto-sent, nothing on failure; edits never backfill.

**Projection and hiding.** The plugin's Definition claims the replacement into a divider anchored at its seq. Hiding is two-layer: the shadowed user renderer renders nothing inside a hidden span, and a dynamic stylesheet drops every chat row whose `data-chat-flow-key` (`ChatNodeSeat.tsx`) anchors inside the span, covering assistant steps, tool calls, and turn tails. The hider probes that undocumented attribute on its first non-empty rule set and, on a miss, enters a bounded retry (MutationObserver plus deadline) so a not-yet-mounted chat doesn't disable it; only an expired window disables it — one `console.warn`, renderer-only hiding — and the observer outlives the disable, so late-mounting rows reactivate it. It never throws. The divider expands in place to a read-only replay of the span (user originals plus assistant text, folded from the live node store) with the 「恢复到对话末尾」 action; a span whose rows fell out of the loaded window shows 「撤回的内容不在当前已加载的历史中」 instead.

**Restore** is a tail replay of the whole withdrawn span, never an in-place repair: the surface fold is positional — a replaced span splices into exactly one node (`applySurfacePlan`) — so the span cannot re-enter the model context where it was, and its model-side hiding is never undone. The host walks the log interval `[start, seq)` delimited by the replacement itself and appends every replayable entry in original order: user messages verbatim (an edit replacement's content IS the last edit's text, so it replays as such) and each assistant reply's text as a framed plugin-sourced user message — `assistant/message` cannot carry a plugin source and the trace forbids assistant appends outside a step, so role fidelity is carried by the frame `(以下是先前被撤回、现随恢复放回的助手回复)`, stripped from display. An interrupted step without `assistant/message` is merged from its `assistant/chunk` rows (reasoning-only fragments preserved). Tool calls/results never replay: the pairing cannot be re-entered and side effects are not replayable. Replayed rows render as the 「已恢复」 group — user bubbles with the full action row, assistant text via the official `MarkdownText` — and the divider carries a 「已恢复」 badge while a live restore row cites the span; withdrawing the restored rows again clears the badge and re-enables the action (restore events stay in the log).

**Why the projection cannot hide the span (the upstream seam a durable fix needs).** The assembler runs every Definition's `match` per event with no veto (`conversation-assembler.ts:370`), and `match(event)` reads only the current event; shadowed events keep `surfaceOp: 'append'` (the range metadata lives on the replacement only), so they still match the built-in Definitions, which exclude *replacement* events, not shadowed ones. Node `visibility` is set only by the owning Definition, the assembler forbids withdrawing a materialized node, and a node key is bound to its Definition's kind — a plugin can neither flip nor impersonate an official node. Shadowing the other `conversation.chat.node` keys fails too: the official components are not exported, and `command`/`turn-tail`/`tool-call` declare child slots a shadow cannot re-declare (`tool-call` owns the unbounded per-tool-name `tool.call.toolview` slot). The official compaction pipeline makes the same choice by design — a replaced span stays in the transcript.

**Model experience.**

- *Edit replacement* — the model reads the edited text and nothing that followed the original, plus one short trigger (`(用户编辑了上一条消息，请按编辑后的内容重新回答)`). Token effect: the shadowed span's tokens leave subsequent requests; the edit adds the edited message plus the trigger. KV cache: the prompt prefix is invalidated from the edit point.
- *Withdrawal replacement* — the span is replaced by one placeholder (`(用户撤回了这条消息及其后的所有内容)`). Token effect: the span's tokens leave; one short message is added. KV cache: the prefix is invalidated from the replacement point — the same trade compaction makes; withdrawing an older message discards more cached prefix.
- *Restore replay* — the span's replayable content (user messages verbatim, assistant text behind the frame) appends at the tail in original order, plugin-tagged and citing original events; tool tokens stay out. KV cache: none beyond an ordinary tail append.

**Exports.** `/client` exports the plugin body (`apply`/`inject`) and the `MessageToolsRemote` type; the host export is the `MessageToolsService` class plus wire types under `/types`.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/message-tools`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
