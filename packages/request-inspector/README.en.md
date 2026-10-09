# Request Inspector

Aggregates every model call by turn and shows its full composition — which sections the system prompt came from, how many tool definitions were sent, how much is carried history vs newly added — plus token and timing views, answering "is injection bloated, why did the cache break, and where did the time go".

## Entries

- **Turn action-row icon**: every completed turn's action row (copy/like/share/usage) gains an icon that opens the right sidebar at **that turn's** detail (via the `conversation.chat.assistant-actions` seat; the owner `messageId` is matched against the turn's closing assistant message, falling back to the latest turn).
- **Session-header utility icon**: opens the sidebar at the latest turn.

Both land on the same right-sidebar tab (`request-inspector`); a turn switcher inside the panel reaches every captured turn of the session.

## The two views

- **Token 分布 (token view)**: left — request cards (`#seq · response summary`, input/output tokens, duration, measured cache hit with a mini bar); right — the selected request: anchor header row (this response → tool · output · duration ｜ config · provider/model · maxTokens; **config lives at scope/request level** — a subagent may run a different model), the category stacked bar with click-to-filter legend, and the **four-segment breakdown**: system (attributed by `system-prompt/assemble` section names) / tool definitions (two-column grid) / history (collapsed) / newly added (expanded; includes the previous response and its tool results). Every row expands to its verbatim full text.
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

**Subagent coverage**: `subagent_dsh` one-shots run in a fresh child process (SDK spawn) that the parent's waterfall cannot see — those runs are reconstructed from the **child session log on disk** (messages/usage/timing are complete; a one-shot's system prompt and tool definitions never land in the log and are shown as honest empty states, never faked). In-process subagent providers are captured at the same fidelity as the main conversation.

Data lives in an in-memory ring buffer only (latest 20 turns per session / 200 requests total, configurable); nothing is written to the session log or disk.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — the page-type right-sidebar tab exists since 0.1.5 (hence `minHost` 0.1.5-rc.1) and the `conversation.chat.assistant-actions` seat since 0.1.7-rc.1; on 0.1.5–0.1.6 hosts the action-row icon is silently absent and the session-header entry remains (all registrations ride `ctx.slots.inject`; a missing seat never breaks boot).
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.0-rc.1).
- **The wire-body view is a 0.1.2+ probed enhancement**: byte-level request bodies need `deepseekLlmApiExtensions.prepare` (deepseek adapter only); when unavailable the bottom view is greyed out and everything else is unaffected.
- **Web-facing plugin**: a headless profile has no browser consumer; the host half still captures and serves the Remote.
- **Probed degradation**: without `sessionPersistence` the child-log lane is off (main-conversation capture unaffected); any missing capture seam silently degrades to an emptier panel, never a boot failure.

## Known Limitations

- **No live refresh during streaming**: the panel is pull-based (fetch on open / turn switch); a running turn's view freezes at fetch time.
- **Child-log lane honest gaps**: a one-shot sub-run's system prompt and tool definitions are unavailable (not logged); segment-level history/added diffing is only meaningful within one sub-run.
- **Opening a child session directly** (navigating into a catalog'd child session id) shows an empty panel — its events fill the parent session's scope.
- **Capture starts at mount time**: requests from before the plugin mounted are not backfilled (the log lane serves subagents only).
- No manual refresh action yet (follow-up); the wire-body view awaits the host 0.1.2+ capability hookup.
