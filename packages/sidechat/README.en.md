# @khorsheed/dsh-sidechat

English | [中文](README.md)

**Side chat (侧边对话)** — a "companion Agent" resident in every preset: a lightweight chat in the right Sidebar, always about *the current context*. Quote a few messages in an ordinary conversation and ask about them; when a content plugin (e.g. a canvas) is installed, its "ask about this" gestures land here too. Built once, useful everywhere — and it knows nothing about any concrete plugin's existence.

## The client (M2 onward)

- **Ref chips expand inline**: pending refs above the composer AND refs carried by transcript user rows click open into the full quoted block (label + full text, collapsible) — the quote's body travels with the conversation, no round-trip to the source tab. Transcript refs are parsed back out of the durable message text in our own fold format (they survive restarts).
- **Floating dock mode**: the header's "pop out" turns the whole chat panel into a draggable floating frame (registered on the official `shell.overlay` frame layer, the worktrees badge precedent) — chat beside a custom main panel (a canvas space) without yielding the detail tab. The frame drags, remembers its position (framework client-store persistence), and its close hands the same context back to the sidebar tab. Sends ride the currently selected session (read-only with none). Without the overlay seat — or on narrow screens — it degrades to tab-only.
- **Multi-context switching**: the header title is a context selector (listContexts) — switch to swap transcripts; a context with newer assistant replies than your last-seen mark shows an unread dot (the host projects each context's latest assistant time; the client compares against localStorage-persisted marks).
- **Selection quote (probe outcome)**: there is no official seam for "any transcript text selection → ref" (see Known Limitations), so M2 does not build it; the composer accepts pasted plain text as before.

## The session model

- **Each contextKey binds one persistent agent session.** In an ordinary conversation the contextKey IS the source session's id — opening the right-Sidebar "Side chat" tab in any conversation is asking beside it. The session is created lazily on the first send (composing the default agent preset, inheriting the source conversation's cwd, so the usual file tools work); after a restart the first gesture cold-resumes it through `ctx.agents.resume`, and **history is projected from the session journal, complete across restarts**.
- **Refs are opaque text chunks**: `{ label, text }`. Rendered as chips above the composer; on send they fold into the user message as `<quoted_context>` blocks. The plugin never parses or classifies a ref — words like "card" or "message type" appear nowhere in this package.
- **The "Quote to side chat" message action**: one more button in the assistant message's actions row — one click lands the message as a pending ref on that conversation's side chat and surfaces the tab on that context. (The seat is the official `conversation.chat.assistant-actions` list slot; the user-message side has no official action slot yet — the gap is recorded as an upstream candidate.)

## The host service API (the cross-plugin seam)

Consumers feed contexts through the host service `ctx.sideChat.openWith(...)` — **same-process objects, never over the Remote wire**, deliberately (type and safety questions only exist across processes):

```ts
await ctx.sideChat.openWith({
  contextKey: 'canvas:<id>',      // the consumer's choice; a prefix is advised — side-chat only isolates by key
  label: 'Canvas: why people stay silent',
  systemPrompt: 'Topic and board summary…', // appended segment: re-calling updates it; every assembly re-reads the latest
  tools: [/* ToolDefinition */],  // attached to that context's agent; origin tagging is the CALLER's job
  refs: [{ label: 'Card 1', text: '…' }],
})
```

- **One-way edge**: a consumer probes `ctx.get('sideChat')` and declares the service name in its own manifest's `dsh.references`; side-chat never mentions a consumer. A consumer's absence is its own degrade; side-chat installs and uninstalls alone.
- **Per-turn freshness**: re-calling `openWith` with the same contextKey UPDATES the systemPrompt segment (an agent-scoped prompt section re-reads the record at every assembly — never a create-time snapshot), same-named tools hot-swap on the live agent, and the session is NEVER recreated.

## Remote (`remote.sidechat`)

| Verb | What it does |
| --- | --- |
| `getState({ contextKey })` | Read one context's full state (label, pending refs, transcript, status). A cold context answers from a persistence inspection — **reads never resume an agent**. |
| `listContexts()` | List every known context (most recently active first, with the live status overlay). |
| `send(agent, { contextKey, text, label?, refs? })` | Send one user message: pending refs fold in and clear; the agent spins up lazily or cold-resumes. Agent-first — the calling session powers the fence and donates the cwd. |
| `quoteMessage(agent, { messageId, label? })` | Land one assistant message of the calling session as a pending ref on its side chat (the host folds the text from the session journal by messageId — no body crosses the wire). |

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-sidechat
# uninstall:
dsh plugin --profile web remove @khorsheed/dsh-sidechat
```

Restart the host after installing. Uninstalling does NOT delete `$DSH_HOME/state/sidechat/` (the contextKey → session mapping) or any side-chat session — they are ordinary sessions of yours.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the page-type right-Sidebar tab (`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`) and the assistant-actions seat (`conversation.chat.assistant-actions`) exist since 0.1.5, which is where `minHost` is pinned; earlier hosts have no right Sidebar and this package does not publish to them.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)
- **Seat-probed degrade**: the tab, the message action, and the floating dock (`shell.overlay`) all register through `ctx.slots.inject` — a host declaring none of the seats simply never mounts the surfaces, and boot is unaffected; without the overlay seat the "pop out" button hides and the tab is the whole surface. When the right-Sidebar navigation face (`ctx.sidebarRight`) is absent, quotes still land; only the automatic tab reveal is skipped.
- **A web surface**: a headless profile has no browser consumer, so the plugin contributes nothing there; the host half still provides `ctx.sideChat` and the Remote face.
- **Re-rooted state fence**: the contexts mapping is deployment-level state (`$DSH_HOME/state/sidechat/contexts.json`). Writes keep the mounted `ctx.fs` (version guards, atomic writes); the calling session resolves the **mode** and lends its id (a read-only deployment still denies), while the writable boundary re-roots at the plugin's own state dir — never bare `node:fs`. Host-side `openWith` (no session) writes under the deployment default mode. A composition without `ctx.fs` degrades to memory-only state (lost on restart, never blocking a gesture). Without `DSH_HOME` the state root falls back to `process.cwd()` (the datasets precedent).
- **Capability probes**: with no agentPresets roster the side agent composes plain (chat-only); with no sessionPersistence a cold context has no readable history; with no agent factory (no agent-loop loaded) a send returns `agent-unavailable` instead of throwing. None of the three affects boot.
- **Tools and prompts are host-side objects**: `openWith`'s `tools`/`systemPrompt` travel in-process only, never over Remote; origin tagging of caller tools is the **caller's** responsibility (side-chat never tags on its behalf).

## Known Limitations

- **User messages have no "Quote to side chat" action.** The assistant-actions seat is an official seam; the user-message actions row (`MessageIconActions`) accepts no extension upstream, and the only precedent — message-tools' whole-node shadow — would collide with that plugin's own shadow. The gap is recorded as an upstream candidate (see the Agent Note).
- **No official seam for "any transcript text selection → ref"** (M2 probe outcome): the `conversation.*`/`conversation.chat.*` slot catalog has no selection/excerpt seat, ui-conversation's selection APIs are all composer-input (Lexical) internals, and message-tools has no such feature either; a DOM-anchor hack is off-limits by the design red line. Registered as an upstream candidate; the fallback stands: the composer accepts pasted plain text.
- **Side-chat sessions appear in the session list.** They are ordinary sessions (auto-titled from the first message); `agents.create` has no "hidden session" flag — whether a presentation-level folding (subagent-style lineage) should exist is an upstream candidate.
- **No official composer parity.** Withdraw-backfill, slash commands, image attachments and the rest of the official composer ecosystem are unavailable in the side chat (a deliberate lightweight trade-off, same origin as room-composer-parity).
- **Updates are pull-based**: one fetch on mount and after own gestures, a 1.2s poll while the agent runs; live push remains future work.
- **A consumer's tools/prompts must be re-supplied after a restart**: the mapping and the prompt segment persist, but `tools` are same-process objects — a cold resume carries only what the mapping holds until the consumer's next `openWith` hot-patches them back.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**On-disk layout**

```
$DSH_HOME/state/sidechat/
  contexts.json    # { version: 1, contexts: [{ contextKey, label, sessionId?, segment?, agentPreset?, refs[], createdAt, updatedAt }] }
```

A corrupt file reads as an error and refuses writes — never rewritten into something the plugin understands (the canvas rule). Uninstalling the plugin does not delete it.

**Session lifecycle**: contextKey → record. On the first `send`: `ctx.agents.create({ sessionId: randomUUID(), meta: { cwd, agentPreset }, setup })` — the cwd inherits from the live session the contextKey names (the ordinary-conversation scenario: the source conversation), else from the session the send gesture runs in; the preset defaults to the profile default (probed agentPresets, mounted into the agent's scope). After a restart, `ctx.agents.resume({ resumeSessionId, setup })` cold-resumes; a resume failure (a torn log) falls back to a fresh session and corrects the mapping.

**Per-turn freshness**: at creation/resume the agent's scope registers a prompt section (`sidechat:context`, order 10300, after the deployment persona suffix) whose text provider **re-reads the record's latest segment at every assembly** — the built-in orientation segment plus the consumer's. The transcript is always projected from the session journal (user/assistant text, tool calls folded to one-line statuses) — no shadow copy anywhere.

**Client**: a page-type right-Sidebar tab (kind `sidechat`, key = the package name). It shows the current conversation's context by default (contextKey = the session id); `openTab('sidechat', { params: { contextKey } })` switches it programmatically (the quote action rides this). Since M2 the shared panel (`SideChatPanel`) also mounts on the `shell.overlay` floating dock (root scope, position persisted through the framework's client store, sends riding the currently selected session); the context selector reads `listContexts` (the host projects each context's latest assistant time from its journal), and unread dots compare against localStorage last-seen marks. The composer keeps the canvas invariants: an uncontrolled textarea, a hard stop during IME composition, one scroll container; ⌘⏎/Ctrl+⏎ or the button sends. Assistant messages render through the official `MarkdownText`; every colour is a `--dsw-*` token.

</details>
