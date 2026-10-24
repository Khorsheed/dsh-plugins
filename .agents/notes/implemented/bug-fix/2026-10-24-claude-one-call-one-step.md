# Agent Note: one claude API call folds into ONE step (and its usage counts once)

Status: implemented

## Problem

Two visible defects in a claude member's Context Lens lane:

- One API call appeared as several request records. Claude emits one assistant event PER CONTENT BLOCK of a single message (thinking / text / tool_use), and the mirror folded each block into its own step — so a call that said "先看看有什么工具" and called ToolSearch read as two requests.
- After per-call usage landed, EVERY one of those steps showed the call's usage, identical numbers repeated: the wire repeats the message's usage on each per-block event, and the fold stamped each event independently.

## Decision

- The fold tags every line with its `messageId` and keeps a per-message stamp ledger: the call's usage rides its LAST folded line and is lifted off whatever line it previously rode — a multi-block call accounts exactly once even before grouping.
- The exec mirror (both the live pass and the settle pass) now folds by GROUP (`groupClaudeTranscriptLines`): consecutive lines sharing a message id become ONE step with a single mixed-content assistant/message (reasoning + text + tool-call blocks, the host's and kimi's own shape), the tool lifecycles inside it, and the call's usage once. Id-less lines stay singleton units, so older streams and the existing fixtures keep their exact shape.
- The round-total fallback (last non-tool group) only fires when no per-call usage exists anywhere; the persistent live driver's final stream snapshot applies the same suppression, so a snapshot never double-writes the total beside per-call reads. The persistent driver keeps its per-block streaming steps; the dedupe above is what stops its duplicate accounting.

## Alternatives considered

- **Keep per-block steps and only dedupe usage**: the duplicate numbers go away, but one call still reads as several requests — the user's actual complaint. Grouping is the fix, not a cosmetic preference.
- **Move usage to the group's FIRST line**: puts the accounting on the text step while the tool steps read — again; last-line matches kimi's one-usage.record-per-request placement and the host's tool-step accounting.

## Consequences

- New claude rounds: one API call = one lens record, with its own usage once; text+ToolSearch no longer splits, and 21.2k no longer repeats on both halves.
- The 40k "input jump" the user asked about was separately verified to be REAL context growth, not double counting: the `room_read` tool result was 38,337 chars (~21k tokens, including the full planCommands JSON schemas). cache_read and cache_creation on the following call refer to the old prefix and the new result respectively — they do not overlap. A slimmer room_read payload is a separate optimization candidate.
- Old child logs unchanged; the persistent live driver's steps stay per-block but no longer double-count.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-claude-code test` (267): a fold-level spec asserts per-message usage dedupe (usage lifted off the earlier block's line); an exec-mirror spec drives one call as per-block events and asserts ONE step with a mixed [text, tool-call] message, one usage, one tool lifecycle, and a valid released log. The pre-existing id-less fixture suites pass verbatim.
