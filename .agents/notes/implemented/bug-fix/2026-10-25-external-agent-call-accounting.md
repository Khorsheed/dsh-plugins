# Agent Note: external agents' calls account and time like real requests

Status: implemented

## Problem

In Context Lens, a room member's session (Claude Code, Codex, Kimi) showed rows with no tokens, repeated usage, near-zero output and 0.0s on every request. Checked against each CLI's own record:

- **Claude Code, persistent live driver.** Session 2377f26d… turn 2 made 4 API calls (Claude's transcript, `message.id` + final usage); the mirror wrote 7 steps. Call A (Skill + ToolSearch, output 242) became 3 steps: Skill and ToolSearch both carried A's usage, and a "text" step held the Skill's injected instructions mirrored as an assistant answer. Every output count was the `message_start` snapshot (6, 32, 3, 2 against 242, 109, 167, 2687): each per-block `assistant` event repeats that snapshot, and only the call's `message_delta` carries the final count. The persistent driver wrote a block as soon as the next event arrived, so the usage could not be moved afterwards.
- **Codex.** `input_tokens` already contains both cache buckets (`total_tokens = input + output`; rollout: 14353 = 11404 read + 2946 write + 3). Both mappings subtracted only the cached reads, so a cold-cache call counted its input about twice. The live mirror writes one step per app-server item, so commentary + tool call of one call are two steps, usage on the last.
- **All mirrors.** The host's `Session.append` stamps the current time, and mirrors write a step only once its call is over: step/start and the answer land together, so every request read ~0s.

## Decision

- **Claude live driver** (`packages/local-agent-claude-code/src/live-driver.ts`): calls are tracked by native message id from the stream events. `message_start` records the start usage, `message_delta` completes it and ends the call. A call's lines fold only once the call ended (or the round settles), and the call's final usage rides its last line alone; the line's own per-block snapshot never overrides it. Without stream events (older CLIs) nothing is held and the previous rules apply.
- **Claude parser** (`claude-cli-provider.ts`): text in a `user` event is the CLI's own injection (a Skill body, command output), never mirrored as an answer. The exec path gets this too.
- **Codex** (`usageFromAppServer`, `usageFromCodex`): uncached input = input − cached − cacheWrite, keeping the shared contract's three input buckets disjoint.
- **Context Lens log lane**: a log whose `subagent/descriptor` names a provider outside the host (anything but `spawn`/`fork`) is external. A step/start written within 50 ms of its answer starts at the log's previous progress event instead (the user message, the previous tool result). In an external log, a step without usage waits and joins the following steps of the same turn into one request (input from the first step, response blocks, tool execs and the final usage from all); a call that never gets its usage step still shows at the turn's end.

## Alternatives considered

- **Fold each Claude call into one step in the live driver.** The streaming ledger opens a step per block for the live chat. Regrouping it touches the live display, and the live driver is being reworked on another branch. The lens-side join gives one request per call for all three mirrors without that.
- **Backdated step/start.** `Session.append` takes no time; it would need a host change.

## Consequences

- New Claude rounds: one request per API call with its final usage once; old logs keep their numbers.
- Codex input totals drop to the true uncached count; cost readings on cold-cache calls roughly halve.
- External request times are the gap since the previous event: the model time plus whatever the mirror's own lag adds. dsh-cli logs (step/start written live) keep their real times.
- Not fixed here: Codex's lost turns and Kimi's log truncation (`append seq mismatch` in the same window). Causes not established.

## Testing

- `local-agent-claude-code` (268): a live-driver spec replays call A/B in the real event order and asserts no fold before `message_delta`, final usage (242 / 109) on the call's last line only, and no skill text as an answer.
- `local-agent-codex` (253): the real rollout numbers map to 3 / 11404 / 2946.
- `context-lens`: `tests/external-calls.spec.ts` covers the start from the previous event, the join of a usage-less step, the in-process exemption, and a call left without usage. The dsh-cli child fixture keeps its live times.
