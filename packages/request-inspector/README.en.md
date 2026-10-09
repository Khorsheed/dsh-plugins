# Request Inspector

Aggregates every model call by turn and shows its full composition — which sections the system prompt came from, how many tool definitions were sent, how much is carried history vs newly added — plus token and timing views, answering "is injection bloated, why did the cache break, and where did the time go".

## Entries

- **Turn action-row icon**: every completed turn's action row (copy/like/share/usage) gains an icon that opens the right sidebar at **that turn's** detail (via the `conversation.chat.assistant-actions` seat; the owner `messageId` is matched against the turn's closing assistant message, falling back to the latest turn).
- **Session-header utility icon**: opens the sidebar at the latest turn.

Both land on the same right-sidebar tab (`request-inspector`); the panel's turn switcher (a menu with each turn's request count and token totals) reaches every captured turn of the session, and switching turns scrolls the conversation to that turn (the `[data-chat-turn]` DOM anchor, falling back to the nearest later mounted turn, silent when nothing is mounted); the 「定位到最新」 (latest) button beside it jumps back to the latest turn and bottoms the conversation out.

## The two views

- **Token 分布 (token view)**: left — request cards (`#seq · response summary`, input/output tokens, duration, measured cache hit with a mini bar); right — the selected request: the config header line (config · provider/model · maxTokens; **config lives at scope/request level** — a subagent may run a different model), the category stacked bar with click-to-filter legend, the **input four-segment breakdown** — system (attributed by `system-prompt/assemble` section names) / tool definitions (two-column grid) / history (collapsed) / newly added (expanded; includes the previous response and its tool results, response rows labeled `← response of #N`) — then the **output** section holding this request's own response verbatim (reasoning / text / one row per tool call; the header carries the response summary · output tokens · duration; streaming shows an in-progress note, a pre-block failure shows the error text, and an uncaptured response fabricates nothing). Every row expands to its verbatim full text.
- **耗时分布 (timing view)**: whole-turn six-bucket split (model wait / reasoning / tool-argument generation / model output / tool execution / other) + a strictly ordered timeline + per-tool breakdown + per-call rows that click through to the same request in the token view.

Scope navigation: one chip per delegation run (`▸ #seq label ✓/✗`) — runs are never merged or grouped by description; a failed run (0 model calls) gets its own status page, because that emptiness IS the diagnostic.

## Measurement honesty

- Segment sizes are **exact character counts** (the host exposes no per-segment tokenizer); request token totals are **real provider usage** (including measured `cacheReadTokens`). The panel footer states this split.
- History vs added is a message-level diff between adjacent requests in the same scope (durable id first, content hash otherwise).

## How it works

Three read-only host seams (requests are never rewritten):

- `llm/stream` waterfall: the full `GenerateOptions` of every model call (assembly-layer original, before adapter projection) plus block-level stream timing and usage; the listener forwards every chunk unchanged.
- `system-prompt/assemble` waterfall: system-section attribution.
- `session/event`: turn boundaries, `subagent/catalog` (subagent correlation), tool/call・tool/result (tool execution time), assistant/message (usage and the turn's closing message id).

**History backfill**: a panel query first reconstructs the session's pre-mount turns from its own durable log — `request/header` supplies the config and full tool definitions, `system/message` the system prompt text, assistant messages the responses and usage (incl. measured cache reads), tool/call・tool/result the tool execution timing. Both lanes share the host's own turn numbers and never duplicate; a turn with any live-captured request stays wholly live (no log rows merge in). Backfill fills newest-first within the retention budget, live turns winning the budget, and runs once per session. The log lane's one fidelity delta: the log keeps no system-prompt section names, so a reconstructed system segment renders as a single block (section attribution is the live lane's upgrade).

**Subagent coverage**: `subagent_dsh` one-shots run in a fresh child process (SDK spawn) that the parent's waterfall cannot see — those runs are reconstructed from the **child session log on disk** (messages/usage/timing are complete; a one-shot's system prompt and tool definitions never land in the log and are shown as honest empty states, never faked). In-process subagent providers are captured at the same fidelity as the main conversation.

Data lives in memory only (configurable), never written to the session log or disk: the latest 30 turns per session; history backfill additionally capped at 500 reconstructed requests per session; and all sessions' segment text shares one global character budget (default ~150MB — the verbatim segment text is the real memory driver). Under pressure the oldest *backfilled* turns evict first; live captures never yield to backfill pressure. Budget-dropped older turns are flagged in the footer and refill automatically once room frees.

## Workspace admission seam (server-side consumption)

All four Remote verbs (`listTurns` / `getTurn` / `getRequest` / `getTurnTiming`) accept an optional trailing `filter: { scopes?: readonly string[] }` — an authorization filter for **trusted server-side callers**: the caller (e.g. a collaboration plugin proxying workspace-member RPC) derives the allowed scope set from its own authorization facts, and the plugin applies it as an opaque allow-list per query.

```ts
// One read authorized for the main conversation and child-a only
const { turns, backfill, generation, authorizedScopes } =
  await remote.requestInspector.listTurns(sessionId, { scopes: ['main', 'child-a'] })
```

- **The scope set is computed by the trusted caller**: `scopes` is a filter, not an authorization source — never forward a browser-supplied set verbatim; the server derives it from authorization facts such as membership. The plugin neither derives nor validates it; absent (or no `scopes` key) is today's local semantics.
- **An excluded scope contributes nothing**: request rows, scope/failure counts, token sums, timing lanes, and tool names all aggregate over the authorized subset only; scope identifiers are the ones `AgentScopeOverview.scopeId` exposes (the main conversation is the stable `'main'`, child scopes key on the childId). Turn rows themselves (query preview, timestamps) are session-level metadata and stay listed. Verbatim responses (`CapturedResponse`) hang only on `getRequest`'s `CapturedRequest.response` — the other three verbs' surfaces never carry them (even unfiltered), so no second leak path exists beside the filter.
- **An unauthorized child scope's log is never opened on its behalf**: filtering happens ahead of the lazy child-log reads — for an unauthorized query the open itself never happens (and neither does the read of its response records).
- **Zero-authorized is explicit**: with a filter, results carry `authorizedScopes` (the authorized scopes that exist); an empty array means the query resolved to zero authorized content — three-way distinct from the field's absence (unfiltered) and from `undefined` (unknown session/turn/seq). `getRequest` answers `{ refused: 'no-authorized-content' }` when the address exists inside an excluded scope (the refusal confirms existence and carries no content); an unknown seq stays `undefined`.
- **Fidelity metadata reuses the existing watermark**: turn rows and scope rows carry `origin` (`'live'` / `'log-reconstructed'`; a scope holding no content yet omits it); `BackfillInfo` is unchanged; `listTurns` adds `evictedTurnCount` — "collected then evicted under the retention caps" is distinguishable from "never seen" while the session record lives; **blind spot**: evicting the last turn frees the whole session slot, so fully-evicted reads exactly like never-seen.
- **Address semantics**: `(sessionId, turnSeq)` is a TURN-level address only; real turns key on the host turn number (stable across restarts) while negative pseudo-turnSeqs are not durable addresses. A request `seq` is a process-local monotonic counter that resets on restart — a caller holding seqs across calls must also hold the result's `generation` (the instance epoch, minted at mount); a changed generation invalidates every held seq, so an old seq never silently resolves to a new request.
- **Retention is unchanged**: 30 turns / 500 backfilled requests per session and the global ~150MB character budget apply as before; filtering is read-path only and affects neither capture nor retention.
- **Local behavior unchanged**: calls without `filter` keep today's semantics byte for byte; the panel does not consume the new fields (server-side consumers render their own states).

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — the page-type right-sidebar tab exists since 0.1.5 (hence `minHost` 0.1.5-rc.1) and the `conversation.chat.assistant-actions` seat since 0.1.7-rc.1; on 0.1.5–0.1.6 hosts the action-row icon is silently absent and the session-header entry remains (all registrations ride `ctx.slots.inject`; a missing seat never breaks boot).
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.0-rc.1).
- **The wire-body view is a 0.1.2+ probed enhancement**: byte-level request bodies need `deepseekLlmApiExtensions.prepare` (deepseek adapter only); when unavailable the bottom view is greyed out and everything else is unaffected.
- **Web-facing plugin**: a headless profile has no browser consumer; the host half still captures and serves the Remote.
- **Probed degradation**: without `sessionPersistence` the log lane is off — both the child-scope detail and the history backfill (live main-conversation capture is unaffected); any missing capture seam silently degrades to an emptier panel, never a boot failure.

## Known Limitations

- **No live refresh during streaming**: the panel is pull-based (fetch on open / turn switch); a running turn's view freezes at fetch time.
- **Child-log lane honest gaps**: a one-shot sub-run's system prompt and tool definitions are unavailable (not logged); segment-level history/added diffing is only meaningful within one sub-run.
- **No section attribution for backfilled system segments**: a log-reconstructed turn's system prompt renders as one block (the log keeps no `system-prompt/assemble` section names); aux requests (compaction / session-title) never land in the request log and do not appear historically.
- **Budget truncation is labeled**: when the memory budget can't hold older turns the backfill truncates newest-first-kept and the footer shows "Older turns not loaded (memory budget)"; a later query refills automatically once room frees. A log that refuses to decode (e.g. unknown event types) shows a "Session log unreadable" note with the reason instead of looking empty.
- **Opening a child session directly** (navigating into a catalog'd child session id) shows its own log-reconstructed view (a one-shot has no system/tools); the same content lives under the parent session's scope.
- No manual refresh action yet (follow-up); the wire-body view awaits the host 0.1.2+ capability hookup.
