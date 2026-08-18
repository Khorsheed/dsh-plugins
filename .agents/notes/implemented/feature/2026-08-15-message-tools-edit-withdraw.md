# Agent Note: message-tools edit/withdraw as a community-seam plugin

Status: implemented

English | [中文](2026-08-15-message-tools-edit-withdraw.zh.md)

## Problem

The community message-tools experiment (outside the repo) gave user messages edit and withdraw actions, but its data chain was never connected: the keyed slot entry injected hardcoded placeholder props, the host half called `ctx.provide('messageTools')` without any Remote registration so the browser could not reach it, and "withdraw" only appended an ignorable marker event that left the original message in the model context. The rewrite had to work entirely through public seams: no edits to official packages.

## Decision

The plugin lives at `packages/message-tools` (`@khorsheed/dsh-client-message-tools`), one package with a host face and a client face (the api/remotes split-tsconfig pattern).

- **Withdrawal is a surface replacement.** The host `MessageToolsService extends TypertRemoteService` exposes `@Remote('withdraw')`, which validates the target (append-surface user message still on the live surface) and appends a `user/message` with `surfaceOp: { op: 'replace', start, end }` covering the target and the whole surface tail, `sourceEventSeqs` citing every shadowed node, and `source: { kind: 'plugin', plugin: 'message-tools' }`, then flushes. The model side is fully hidden by the same mechanism compaction uses.
- **No new session event types.** `Session.append` assigns the envelope and cannot set `ignorable: true`; a persisted event type unknown to `KNOWN_SESSION_EVENT_TYPES` makes session-persistence refuse the log on reload. The replacement event is the audit trail. This supersedes the experiment's `user/message/withdrawn` marker event.
- **The client mounts its own Remote.** Following ui-file-preview, the client apply awaits `ctx.remote.$mount(messageToolsRemote)` on the generated `/remote` contribution and reads the namespace back with `ctx.get('remote.messageTools')` (declaring it in `inject` would deadlock the loader). Editing `dsh-api-remotes` is not required.
- **UI composition follows the slot standard.** The user renderer shadows key `user` at priority -1 via `ctx.slots.inject('conversation.chat.node', ...)`; a `message-tools-withdrawn` Definition (merged into `ChatNodeDataMap`) claims replacement events into divider nodes; the renderer folds divider nodes into hidden seq spans through `useSession` + `shallowEqual` and renders null inside a span. Edit is withdraw-then-`conversation.send` through the scope-addressed conversation service. Copy uses the real copy icon; the withdraw dialog drives `RiskConfirmation`'s caller-owned `acknowledged` state; all copy lives in a plugin-owned locale namespace.

## Verification

Unit tests cover the withdrawal plan fold (span, tail, and every rejection code), the replacement predicate, and the divider Definition plus hidden-range fold. `tsc -b` on both aggregates, the package vitest run, oxlint, and translation pairing pass. On the 3080 instance the packed tarball boots without plugin errors, renders real bubble text with the action row, and an end-to-end edit and withdraw on a test session behave as specified.

## Alternatives considered

**Append a `user/message/withdrawn` marker event, as the experiment did.** It leaves the message in the model context (not a withdrawal) and, because `ignorable` cannot be set, makes the log unreadable after reload for any harness without the plugin's types.

**Hide every chat node kind in the span by shadowing all thirteen `conversation.chat.node` keys.** The assembler runs every Definition's `match` per event with no veto (`packages/client/runtime/src/client/sessions/conversation-assembler.ts:370`), `match(event)` reads only the current event, and a shadowed event keeps `surfaceOp: 'append'` in the log — the built-ins (`conversation-nodes/message.ts:36-40`, `assistant.ts:247-250`) exclude replacement events, not shadowed ones. Node `visibility` is owned by the producing Definition (`conversation-nodes/common.ts:56`; render-order filter at `chat-snapshot-builder.ts:135-139`), the assembler forbids null-withdrawal of a materialized node (`conversation-assembler.ts:296-300`), and node keys are bound to the owning Definition's kind (`conversation-assembler.ts:707-718` + `contract/conversation.ts:272`), so a plugin Definition can neither flip nor impersonate an official node. Keyed shadowing cannot delegate to the shadowed entry, and the `command`, `turn-tail`, and `tool-call` entries declare child slots a shadow cannot re-declare (`ui-slots/src/index.ts:829`; `tool-call` owns the unbounded per-tool `tool.call.toolview` keyspace, `ui-tool/src/client/apply.ts:23-31`). No host-side writing choice changes any of this because the chat projection folds the log, not the surface — the same reason compaction's shadowed span stays in the transcript by design (`chat/CompactionItem.tsx:1-7`, `runtime/src/client/sessions/conversation.ts:206-212`). Rejected: hiding stays scoped to the plugin's own renderer, and the divider marks the spot.

**Hand-write the client Remote contribution and rely on the gateway SRC fallback.** It avoids the generated `/typert` + `/remote` artifacts, but loses strict zod boundary validation and hand-maintains a generated format. The generator path is the sanctioned contract and costs one host-face tsconfig.

## Follow-up: model chip and full-span DOM hiding

Second iteration on the same package, two additions:

- **The editor's trailing seat now renders a real model chip.** It reads and submits through `ctx.get('modelDirectories')` — ui-model-selection's shared per-session `ModelDirectory`, the same store the composer seat and the /model popup echo — so a switch made in the editor is host-validated and applies to the resent edit. The service is read with `ctx.get`, never declared as an inject edge, so a composition without ui-model-selection degrades to no chip (a frozen stub observable keeps the hooks compartment shape) instead of a loader wait. Addressed subagent sessions get no chip, mirroring the official availability rule.
- **Full-span chat hiding moved to the DOM layer.** The projection analysis above still holds — no sanctioned seam exists — so the client installs one dynamic stylesheet hiding every chat row whose `data-chat-flow-key` attribute (`ChatNodeSeat.tsx:44-46`) anchors inside a withdrawn span, covering all node kinds. The hider tracks the currently selected session only (flow keys collide across sessions), rewrites rules only when the span set or node count changes, and disposes with the plugin fiber. The attribute is undocumented, so on the first non-empty rule set the hider probes for it one frame out (after React's commit); when absent it disables itself with a single `console.warn` and the plugin behaves exactly as the first iteration (user messages still hidden by the shadowed renderer). The withdrawal divider's own kind is excluded from rule generation.

## Follow-up: restore, divider redo, and the undo glyph

Third iteration, four additions:

- **Withdraw/restore carry a package-drawn undo-arrow icon** (`src/client/icons.tsx`, `fill="currentColor"` path in the official 16×16 outline conventions): ui-primitives ships no undo/revert glyph and its refresh glyph means reload.
- **The divider was redone** in the compaction marker's visual language (dim clickable row, chevron) with the hidden-node count「已撤回 N 条消息」derived from the live node store, an in-place read-only replay of the span (user originals + assistant text, folded in the expand event handler — render code subscribes, handlers read), and a restore action.
- **Restore is a tail replay.** The surface fold is positional — a replaced span splices into one node (`packages/core/session/src/surface.ts` `applySurfacePlan`) — so the withdrawn assistant steps can never re-enter the model context in place. The host `messageTools.restore` Remote appends the withdrawn user message's content verbatim as a fresh plugin-tagged `user/message` (`sourceEventSeqs` cites the original), making it simply the newest user message the model sees. A second Definition claims restore events (append + plugin tag) into bubble rows with an「已恢复」label; the divider derives its「已恢复」badge from a restore row citing its span start. The DOM hider needs no change: the restore row's anchorSeq sits outside every withdrawn span.
- **Action-row metrics aligned with the official MessageIconActions** (10px gap; 28px round buttons, tertiary → secondary hover).

## Follow-up: rotate-ccw glyph, cancel-on-edit, steering shadow

Fourth iteration, three changes:

- **The undo glyph became a rotate-ccw circle arrow** (near-full arc with a corner arrowhead, `stroke="currentColor"`, 16×16) — the straight undo arrow read poorly; shared by the withdraw action and the restore badge.
- **Edit now cancels the running turn between withdraw and resend** (`src/client/edit-resend.ts`): the running reply is inside the withdrawn span, so without the cancel the resend queued behind or steered into the old turn. `editResend` reads `snapshot.running` after the withdraw lands, cancels via the scope-addressed `conversation.cancel()` only when running, and a failed cancel rejects without sending. Unit tests pin the order (withdraw→cancel→send), the idle path (no cancel), and both failure paths.
- **The shadow registration extends to the `steering` key** (upstream registers one renderer for both `user` and `steering`, `register-node-renderers.ts:17-19`): an admitted steering message is an append-surface user message, so edit/withdraw work identically. Queued (not yet admitted) messages need nothing from this plugin: the official queue dock already edits/removes them through `conversation.updateQueue` (`{ kind: 'edit' | 'remove' }`), and they never enter the session log, so the surface mechanism does not apply. Shadowing the queue dock was evaluated and rejected as redundant — the official UI exists.

## Follow-up: edit redefined as in-place replacement

Fifth iteration: edit semantics redefined per product decision ("edit corrects, withdraw revokes").

- **Edit is a single-step in-place replacement.** The host `messageTools.edit` Remote appends one `user/message` replacement whose content IS the edited text — no placeholder, no divider, no tail duplicate. The span [target..surface tail] still shadows everything after the edited message (editing discards what followed), and the DOM hider hides the span's stale rows the same way as withdrawals (edit bubbles carry `{ seq, hiddenStartSeq }` and fold into the same hidden ranges).
- **Regeneration is triggered by `agent.followup` with a minimal plugin trigger.** Investigation found no wake-without-append path in the harness (`agent.ts` claims append at turn start; an empty claimed batch makes no model call): `followup`/`steer`/`prompt` all append, and nothing listens to plain appends. The trigger (`op: 'edit-trigger'`, text `(用户编辑了上一条消息，请按编辑后的内容重新回答)`) lands once as itself — the edited text stays exactly once, in the replacement. Its context row is hidden by the DOM hider (`op`-based, alongside the restore duplicate rule).
- **Edit chains and cancellation.** A running turn is cancelled first and awaited (bounded idle wait) so its teardown writes land inside the shadowed span; a failed cancel rejects without editing. An edited bubble edits again — the previous replacement's seq is a legal target (`planEdit` accepts edit replacements on the surface).
- **Markers.** The plugin source gains an `op` discriminator (`'edit'` | `'edit-trigger'`); legacy events (no `op`) read as withdraw/restore, so old sessions replay unchanged.

## Follow-up: full-span restore replay and re-withdrawal

Sixth iteration, two changes:

- **Restore replays the whole withdrawn span, in original order.** `planRestore` resolves the span from the withdrawal replacement's `sourceEventSeqs` (never re-derived) and folds it into replay entries: user-source messages and edit replacements (whose content IS the last edit's new text) replay verbatim as user messages; assistant replies replay as framed plugin-sourced user messages (op `restore-assistant`, frame `(以下是先前被撤回、现随恢复放回的助手回复)`) because `assistant/message` cannot carry a plugin source (`AssistantMessage.source` is `ModelMessageSource`) and the session trace requires an open step for assistant appends (`packages/core/session/src/invariant.ts:118`); tool calls/results, withdrawal placeholders, and edit triggers never replay (the call/result pairing cannot be re-entered, side effects are not replayable, and the assistant text usually summarizes them). The host appends the entries back-to-back at the tail, each citing its original seq in `sourceEventSeqs`. The client projects them as a「已恢复」group: user bubbles through the shared shadowed renderer (with the copy/edit/withdraw action row) and assistant text lines (new `message-tools-restored-assistant` kind). Edit–restore combination: restoring a span that contains or starts at an edit replacement replays the last edit's new text; purely edited spans have no divider, hence no restore entry.
- **Restored and edited rows withdraw and edit again.** `planWithdrawal`/`planEdit` accept restore replays as targets (edit replacements were already accepted) — previously the restored row's plugin source failed the user-source check, so a restore could never be re-withdrawn. The divider's「已恢复」badge now tracks a LIVE restore row: withdrawing the restored rows hides them (they fall inside the new span), clears the badge, and re-enables the divider's restore action; the restore events stay in the log as the audit trail.

## Follow-up: 「重新编辑」 draft backfill and the pack-dist script

Seventh iteration, two changes:

- **The withdrawal divider gains a「重新编辑」action** that backfills the span's first withdrawn user message text (folded from the live node store via `collectWithdrawnEntries`, first `user` entry — flattened spans keep later entries out, no multi-select) into the session's composer draft: `conversation.input.for(actx).setDraft` is the only public draft write path (`packages/client/ui-conversation/src/client/input/contract.ts:74`), an empty/blank draft is filled directly while a non-empty draft gets the text appended on a new line (`src/client/backfill.ts` `mergedDraft`), and an info notice lands on the session's composer through the same facade. It never sends — the user edits and sends a fresh ordinary message through the official pipeline, decoupled from the withdrawal history. No official composer-focus API exists, so only the draft is filled.
- **The dist-pack rescope is automated** (`scripts/pack-dist.ts` + spec): staging copy, manifest rescope (name/version, `workspace:^` → caret on the source version, repo-only fields dropped), self-name rewrite in `cordis.patch.yml` and every runtime `.js` artifact (the typert manifest owner name included), a stale-`lib/types` check that fails loud, and pre-pack verification of the two names whose omission cost a silent plugin drop and a boot loop in the previous round.

## Follow-up: restored assistant rows reuse the official markdown renderer

Eighth iteration, presentation only: the「已恢复 · 助手回复」line's body moved from plain `MessageText` to the official `MarkdownText` (publicly exported from ui-primitives; ui-conversation's `AssistantMarkdown` renders through it), so restored replies match native assistant typography (prose, code blocks, lists), and the row dropped its 525px bubble-width cap to sit full-width like a native reply. The caption stays as a small tertiary marker; no action row (the group's user bubbles already carry copy). The model-facing frame prefix is now stripped for display (`stripRestoreAssistantFrame` in marker.ts, applied in the Definition) — it belongs to the model context only, and had been leaking into the transcript row since the round-7 full-span replay.

## Follow-up: automatic draft backfill on withdrawal

Ninth iteration: a landed withdrawal now backfills the target's original text into the session composer draft automatically — the「重新编辑」click is no longer needed for the common path. The choreography (`src/client/withdraw-backfill.ts` `withdrawAndBackfill`, stub-verb unit tests) backfills only after the withdrawal lands, skips empty texts (image-only messages), and never backfills on failure; the in-place edit path never backfills. Both call sites (the shadowed renderer's withdraw confirm and the divider's「重新编辑」, which stays for drafts the user already cleared or edited) share one `backfill(sessionId, text)` closure in apply — the `conversation.input.for(actx).setDraft` + `mergedDraft` + info-notice path from the previous follow-up.

## Follow-up: debt cleanup — reedit removal, replay fold fix, coverage

Tenth iteration, four items:

- **「重新编辑」removed.** Automatic backfill on withdrawal made the divider button redundant; the expand area keeps the read-only replay and the restore action. The `withdrawn.reedit`/`reeditFilled` keys are gone; the auto-backfill notice lives at `withdrawn.backfilled`.
- **The divider replay fold read the wrong assistant shape.** `collectWithdrawnEntries` looked for type-keyed `finalNode.blocks`; the real assistant-step data is kind-keyed (`data.blocks`, `finalNode.blocks` once settled — `conversation-nodes/assistant.ts`), so assistant entries never appeared in the expand replay. Fixed with `joinAssistantText` plus a regression test on the real shape. The window boundary stands: rows outside the loaded node window still don't appear (「撤回的内容不在当前已加载的历史中」).
- **Coverage debt cleared: the package's src is at 100% per-file** (statements/branches/functions/lines). New suites: component specs for UserMessageView and ModelChip (jsdom, stubbed selector hooks), WithdrawnDividerView/RestoredMessageView/icons/locales, an apply composition spec (real cordis Context + SlotRegistry + LocaleRuntime, stub Remote namespace), a REAL-composition host spec (real SessionStore plugin + the package service plugin; withdraw/restore/edit through the real surface fold), and the invariant companion spec. Four justified `v8 ignore` arms remain (regex groups that always participate, a ref guard, a disabled-button guard, the never-empty replay receipt).
- **The lockfile now carries the package**: `pnpm install` with the registry reachable recorded the importer and the new `dsh-client-test-runtime` devDependency; the hand-added node_modules symlinks from the early rounds are superseded by normal links.

## Consequences

A profile installs the plugin by adding one cordis row (`id: message-tools`, the package name); the row's package must be built (host lib plus typert artifacts and the client bundle). Withdrawing hides the span from the model for every later turn; in the transcript the span's user messages vanish and a divider appears, while assistant and tool rows in the span remain visible until an upstream suppression seam exists. A withdrawal can be reversed by a tail replay of the span's replayable content (user messages and assistant text; tool calls stay out), and the replayed rows themselves can be edited or withdrawn again.
