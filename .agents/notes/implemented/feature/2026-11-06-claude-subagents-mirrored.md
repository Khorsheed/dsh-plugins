# Agent Note: A Claude Code member's own subagents, mirrored as grandchild sessions

Status: implemented

## Problem

A Claude Code member can call its own `Agent` tool (older builds name it `Task`). The CLI then runs a subagent. Before this change, that work reached dsh only as a plain tool row in the member session. Step M1 ([the Claude subagent-messages note](../bug-fix/2026-11-06-claude-subagent-messages-not-member-steps.md)) stopped the subagent's stream events from leaking into the member's steps. It kept them only as a liveness count.

The approved design `proposals/active/2026-11-06-member-cli-subagents.md` (not in the repository) mirrors each subagent as a grandchild session under the member. Step M2 ([the core writer note](2026-11-06-cli-subagent-sessions-core.md)) added the writer. This note covers step M4, the Claude Code integration.

## Decision

A new module `packages/local-agent-claude-code/src/subagent-mirror.ts` holds `ClaudeSubagentMirror`. It reads; the core's `openCliSubagent` writes.

**Source.** The content comes from the CLI's own files, never from the stream. Next to the member's transcript, Claude Code writes `projects/<slug>/<cliSession>/subagents/agent-<id>.meta.json` and `agent-<id>.jsonl`.

- The directory is found by the CLI session's name across the project directories. The cwd slug is lossy, so it is never computed (`records.ts` follows the same rule).
- The member stream's `Agent`/`Task` tool_use registers a call. The meta file's `toolUseId` pairs a subagent with that call. As a fallback, the call's tool result can name an `agentId`.
- A meta for a call this member never made is ignored.
- A half-written meta is retried on the next pass.

**Tailing.** The transcript is read by byte offset, one complete line at a time.

- The first plain user line is the subagent's prompt. It becomes the grandchild's `user/message`.
- `isMeta` lines and `attachment`, `api-request*` and `system` lines are skipped.
- The `assistant` and tool_result `user` lines go through the member's own fold (`ClaudeStreamParser`). Lines that share a `message.id` group into one API call, and each call becomes one step through `execution.mirror`. The call's repeated usage is stamped once.
- A `request/header` names the model the transcript's assistant lines show.
- While the subagent is still running, a call with an unresulted tool holds the pass. So does a last call with no tool, because it may still grow a block. Everything is flushed when the subagent finishes.

**One subagent = one session = one execution = one turn.** Claude Code gives every `Agent` call a new agent id, so there is no reuse case. The cause carries the call id, the agent type as `name`, and `background` when it applies. The core resolves the member's execution from the mirrored call.

**Closing.**

- **Foreground.** When the member's tool_result for the call arrives, the transcript is flushed and the execution ends `done`, at the last transcript line's time. If the member's round settles first, the execution ends `cancelled`, and the cut-off call is marked `interrupted`.
- **Background.** A call is background when its input has `run_in_background: true`, or its tool result reports `async_launched`/`isAsync`, or the result text starts with the CLI's "Async agent launched" notice. Such a tool result is a launch notice, not the answer, so it does not close anything. The execution stays open past the member's round. It ends `done` when the meta reports `finished: true`.
- **Process gone.** In the live path, a member process that goes away (idle reclaim, crash, model-switch retire, plugin unload) ends every still-open subagent `uncertain`.
- **Exec path.** At settle the process has exited. A background subagent ends `done` if the meta reports finished, and `cancelled` otherwise.

**Wiring.**

- **Live** (`live-driver.ts`). The driver keeps one mirror per member. It outlives a round, so a background subagent stays tracked. `onEvent` feeds it the init event, the member's own assistant/user events, and the subagent's `parent_tool_use_id` events. Those events are only a cue to schedule a coalesced tail; their content is never used.
- At round settle, after the member's turn has closed and been persisted, the mirror's `settleRound` runs.
- The runtime's `onDead` calls `lost()`.
- While a background subagent is open, a poll re-reads it between rounds. The poll uses `subagentPollMs`, default 2 s. `subagentTailMs` is the coalescing delay, default 250 ms. Both are optional fields on `ClaudeLiveDriverTimeouts`.
- **Exec** (`claude-cli-provider.ts`). `ClaudeCliRunSpec` gains an optional `homeDir`, which both exec spawns pass. After the process exits and the member's settle mirror has run, a one-shot mirror observes the whole stream and settles with `processExited: true`. This happens inside the member's round, before its turn closes.

Every failure degrades. A missing directory, unreadable files, an unknown format, or a writer throw is logged once as a warning. The subagent is then not mirrored, and the member's round is untouched.

## Verified vs inferred about Claude's formats

**Verified, from field shapes only** (claude 2.1.x, read-only from the user's own `~/.claude/projects/*/*/subagents/`, no content copied):

- the meta keys (`agentType`, `description`, `toolUseId`, `spawnDepth` 1 or 2, `requestShape`, `requestNonInteractive`, and on newer builds `isBuiltIn`, `launchedWithDefaults`, `finished`);
- one assistant line per content block, with `apiBlockIndex` and a shared `message.id`/`requestId`;
- usage repeated on each line;
- the first user line holding a string prompt, then an `isMeta` line;
- the `attachment` and `api-request*` lines;
- the member transcript's `Agent` tool_result carrying `toolUseResult { status: 'async_launched', isAsync, agentId, … }` with the text "Async agent launched successfully…".

**Not usable:** `requestShape` was `background` on all 146 sampled metas, including calls that ran in the foreground, so it is not the background flag. `finished` is missing on about a third of the metas, so it is only a positive signal.

**Inferred:**

- Every sampled `Agent` call on this machine was asynchronous, so a foreground tool result's structured shape was not observed. The fixture's `{ status: 'completed', agentId }` is a guess, and the mirror does not depend on it.
- Stream-json spells the structured result `tool_use_result`. The mirror accepts both spellings and also the text notice.
- The transcript is assumed to be flushed before the member's tool result arrives.
- A `claude -p` member may not keep a background subagent running after its process exits.
- Whether a member's CLI defaults `Agent` to the background, as this user's interactive CLI appears to, is untested on the member home.

## Alternatives considered

**Mirror from the stream with `--forward-subagent-text`.** Rejected, as in the design. The stream carries only part of the conversation and no per-call usage, while the transcript has both.

**Close a background call when the member's turn ends.** Rejected by the design. A background subagent outlives the member's round, and its completion is a later fact.

**A per-round mirror in the live path.** Rejected. A background subagent would lose its tracker when the round ends. One mirror per member keeps the cursor and the open execution across rounds, and it dies with the process.

## Consequences

- There are no core changes. M4 uses the M2 API as is: `openCliSubagent`, `beginExecution`, `beginTurn`, `mirror`, `end`, `persist`, and the exported `appendRequestHeaderIfChanged`.
- The member's own steps and the mirror snapshots are unchanged. The member log gains one `subagent/catalog` row per subagent, and only when a subagent record exists.
- A subagent's TodoWrite is intercepted by the shared fold, as it is for the member, so it does not appear as a tool card in the grandchild.
- A subagent of a subagent (`spawnDepth` 2) is not mirrored yet. Its meta's `toolUseId` names a call made by a subagent, not by the member, so it is never paired.
- Claude Code background subagents do not enter the room's "background N" tray yet (design decision). The card shows them running.

## Testing

Synthetic fixtures are generated at test time by `tests/subagent-fixtures.ts` into a scratch home. No real content is used.

- `tests/subagent-mirror.spec.ts` (10 cases):
  - foreground pairing, steps, usage, the request header, the prompt, the catalog row and idempotency;
  - incremental tailing with no duplicate step;
  - two subagents from one member message;
  - a foreground subagent cancelled with an interrupted call;
  - background open past the round, then `done` on `finished`;
  - `async_launched` alone marking a call background;
  - `uncertain` on `lost()`;
  - exec `cancelled` for an unfinished background subagent;
  - degrade cases;
  - an exec round run with and without `homeDir`, asserting that the member's events are identical apart from the catalog row.
- `tests/live-driver.spec.ts` (2 cases):
  - a live foreground subagent mirrored mid-round and closed by the member's result;
  - two background subagents that outlive the round: one closed by the poll after `finished`, the other ended `uncertain` by `disposeAll`.
- Every grandchild log and every touched member log passes `assertReleasedV4Relationships`. The existing mirror snapshots are unchanged.
