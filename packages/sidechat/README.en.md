# @khorsheed/dsh-sidechat

English | [中文](README.md)

**Side chat (侧边对话)** — a "companion Agent" resident in every preset: a lightweight chat in the right Sidebar, always about *the current context*. Quote a few messages in an ordinary conversation and ask about them; when a content plugin (e.g. a canvas) is installed, its "ask about this" gestures land here too. Built once, useful everywhere — and it knows nothing about any concrete plugin's existence.

## The client (M2 onward)

- **Ref chips expand inline**: pending refs above the composer AND refs carried by transcript user rows click open into the full quoted block (label + full text, collapsible) — the quote's body travels with the conversation, no round-trip to the source tab. Transcript refs are parsed back out of the durable message text in our own fold format (they survive restarts).
- **Floating dock mode**: the header's "pop out" turns the whole chat panel into a draggable floating frame (registered on the official `shell.overlay` frame layer, the worktrees badge precedent) — chat beside a custom main panel (a canvas space) without yielding the detail tab. The frame drags, remembers its position (framework client-store persistence), and its close hands the same context back to the sidebar tab. Sends ride the currently selected session (read-only with none). Without the overlay seat — or on narrow screens — it degrades to tab-only.
- **Multi-context switching**: the header title is a context selector (listContexts) — switch to swap transcripts; a context with newer assistant replies than your last-seen mark shows an unread dot (the host projects each context's latest assistant time; the client compares against localStorage-persisted marks).
- **openWith surfaces itself (M3)**: the moment a consumer calls `openWith`, the side-chat client decides where to appear — the consumer no longer needs (and cannot reliably) summon the right Sidebar. Mechanism: the host keeps a per-context openWith revision (`rev`, bumped only by openWith, persisted); the client polls the lightweight Remote verb `surfaceHints` and diffs. The presentation rule — conversation panel active (`usePanelInfo().activePanelId === null`) → the right-Sidebar tab; a custom main panel (a canvas space) → the floating dock on that contextKey; dock seat missing or narrow viewport → still `openTab` (the navigation is recorded, so the tab is on the right context when you return). **Root cause**: the official `RightbarRoot` renders the right Sidebar only while the conversation panel is active, so a consumer's `openTab` from a custom panel is a no-op by construction — the presentation decision had to live inside the side-chat client.
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

## Workspace admission seam (server-side consumption)

Mounting this package on an **isolated Context with its own stateRoot** is a supported consumption form: the mounting side starts an independent instance through this package's `apply` plus `config.stateRoot` — all business state is instance-bound (`contexts.json` lands under the instance's own state root), and the read verbs (`getState` / `listContexts` / `surfaceHints`) need no session. The package's injects are `agents` and `sessions`, which the mounting Context must provide (with an injected execution backend `agents` is never touched — an empty stub suffices); without `fs` the state degrades to memory-only (never blocking a gesture).

```ts
import { apply } from '@khorsheed/dsh-sidechat'

apply(isolatedCtx, {
  stateRoot: '/path/to/instance-state/sidechat',
  agentRoute: { provider: '…', model: '…' }, // optional: the explicit execution route
  cwd: '/path/to/workdir',                   // optional: the explicit cwd anchor
  executionBackend: myBackend,               // optional: a custom execution backend port
})
```

The mounting side's obligations and the semantics:

- **Where side agents execute is decided by the execution backend port**: everything that touches an execution target goes through `SideChatExecutionBackend` — lazy open (create) and cold resume (one `open(init)`, told apart by `init.resume`), send (`session.send({ text, source })`, refs already folded into the text by the service), read (live `status` + the `events()` snapshot; the cold read `readCold(sessionId)` hits the durable side and never resumes), cancel (`session.cancel()`, the stop gesture), and release (`session.release()`, the handle dispose — the session itself stays persisted). The default backend (`SideChatDefaultExecutionBackend`) is the existing `ctx.agents` behavior extracted as-is; **with an injected backend the service never falls back to deployment defaults** — the route chain's `agentDefaultModel` probe runs only for the default backend, and so does the calling-less-no-route `agent-unavailable` refusal (an injected backend owns routing itself). A correct mount must be **verified by observation** (inspect the sessions the backend actually opens), never assumed.
- **The open payload carries the resolved values**: `{ contextKey, sessionId, resume, route?, presetId?, cwd?, segmentText(), tools() }`. `route`/`presetId`/`cwd` arrive resolved by the service's chains — route: **explicit `agentRoute` > the calling session's folded request header** (the default backend additionally probes `agentDefaultModel`); preset: calling header > the record > the plugin config (the backend resolves its own default); cwd: **explicit `cwd` > the source session > the calling session**, carried on first open only (a resume replays what created the session). `segmentText`/`tools` are **live readers** (in-process thunks, never on a wire): the backend re-reads them at every assembly — per-turn freshness holds for any backend. Refs (the attachment semantics) never reach the backend: the service folds them into `<quoted_context>` text blocks before sending and parses them back on projection.
- **Capabilities degrade one by one, never crash**: `capabilities: { presets, promptContext, callerTools, cancel, coldRead }`. `callerTools: false` → the openWith tool sync is skipped silently; `cancel: false` → the stop gesture is refused coded `cancel-unsupported`; `coldRead: false` → a cold context answers the honest unknown (empty transcript, `lastError` null, null times, status still `cold`); `presets` / `promptContext` are honored backend-side — the service passes `presetId` and the `segmentText` reader regardless, the flags never rewrite the open payload.
- **The stop gesture (host-side)**: `ctx.sideChat.stop(contextKey)` — a running turn is cancelled through the backend's `cancel()` (the default backend rides the agent's own `cancel({ kind: 'user' })`; on an old host line whose agent lacks the capability the refusal is `cancel-unsupported`). The coded refusals are three-way: `not-found` (no such context) / `not-running` (nothing live right now) / `cancel-unsupported` (backend or session cannot cancel). The wire Remote has no such verb.
- **The calling agent is optional**: `ctx.sideChat.send(undefined, …)` is the shape for a server-side caller without a session — the write fences at the deployment default mode with no session id, and the route/cwd resolve from the explicit config or (default backend) the deployment defaults. `quoteMessage` keeps its mandatory calling (it quotes a message OF the calling session).
- **Terminal dispose + same-root rebuild**: `disposeAgents()` is idempotent and terminal — afterwards every public verb (reads included) refuses with the coded, package-named `SideChatDisposedError` (`code: 'disposed'`); an in-flight open racing disposal is released on arrival — no handle leaks, and its caller gets the same disposed error. Rebuilding on the same root is legal: a new service instance over the same `stateRoot` works as usual (with a custom backend too — the resume rides the backend's `open({ resume: true })` onto its own persisted log); only the old instance stays dead.
- **Local behavior unchanged**: with no backend injected, the new keys unset, and a calling agent passed as today, semantics are byte-identical to before (the pre-existing test suite passing unmodified is the pin); the wire Remote face is byte-identical.

## Remote (`remote.sidechat`)

| Verb | What it does |
| --- | --- |
| `getState({ contextKey })` | Read one context's full state (label, pending refs, transcript, status). A cold context answers from a persistence inspection — **reads never resume an agent**. |
| `listContexts()` | List every known context (most recently active first, with the live status overlay and the latest assistant times). |
| `surfaceHints()` | Each context's openWith revision (`rev`) — the diff basis of the client's self-surfacing mechanism; the lightest read (memory only, no projection, no inspection). |
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
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; no other surface changes. Session V4 adaptation: send's followup source moved to the producer-owned kind `sidechat` (V4 native admission refuses the retired `kind: 'plugin'` wrapper at the durable write; a 0.1.5 host's `user/message` admission accepts any non-empty kind, so both lines write durably); the transcript projection keeps treating this package's sends as user speech in all three source forms (new kind / `plugin:@khorsheed/dsh-sidechat` migrated form / released V3 wrapper), and the tool/result fold reads both the V4 message-level `toolCallId`/`isError` and the V3 block-level wrapper.
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
