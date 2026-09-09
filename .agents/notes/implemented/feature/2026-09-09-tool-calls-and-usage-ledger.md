# Agent Note: tool calls in the settled observation, and a per-round spend ledger

Status: implemented

English | [中文](2026-09-09-tool-calls-and-usage-ledger.zh.md)

## Problem

The efficiency table had six columns — active time, delegation rounds, output
tokens, input tokens, cacheRead, listed price — and no column for the one
thing a reader keeps asking about: how much the harness DID. Tokens say how
much text moved; they do not say whether a round ran one shell command or
forty.

The information was already in every provider. All four parse tool events for
the transcript mirror — codex's `command_execution` / `web_search_call` items,
claude's `tool_use` blocks, kimi's `tool.call` wire lines, the sub-dsh's
`tool/call` events — and each one folds them into the child session's tool
cards. Nothing ever counted them, so nothing downstream could.

The token columns had a second, quieter gap. They are computed per round and
merged per condition, and the ONLY place a per-round number survives is a
mission annotation inside the bundle. Anything outside the report — a pricing
step applying a rate card, an audit asking which round was expensive — had to
re-walk the bundle's annotation tree and re-implement the report's completed-
cell rule to get the same answer. The report kept the arithmetic private.

(Pricing itself stays outside this change: the `标价成本` column still reads
`run.meta.pricing`, which nothing writes, so it still prints a dash. Unit
prices are applied by a non-model step outside the bundle; this change only
guarantees that the per-round facts it needs are on disk and readable.)

## Decision

### `toolCalls` on the settled observation

`LocalAgentRunProgress`'s `settled` variant gains an optional
`toolCalls: { count, byName? }`, reported once per round beside
`observedModel`, `cliVersion` and `usage`.

**Counted only from events the provider already parses.** No new parse path,
no second pass over the stream, no new readback channel. Concretely:

| harness | counted where | `byName` keys |
|---|---|---|
| codex | the `item.completed` branches the stream fold already walks | `command_execution`, `web_search_call` — codex's OWN item types, not the `Bash` / `WebSearch` display names the mirrored cards carry |
| claude-code | the `tool_use` branch of the same fold | the block's `name`: `Bash`, `Read`, `TodoWrite`, an MCP tool's full `mcp__server__tool` |
| kimi | the transcript's `tool.call` lines carrying THIS ROUND'S turn | the name the wire gave the tool |
| dsh | the `tool/call` events in the round window `roundObservation` already walks | the name the event carries |

Three details each earned their place:

- **codex's `function_call_output` never counts.** It is a result that merges
  into the call before it; counting it would double every command.
- **claude's `TodoWrite` counts** even though the fold diverts it into the
  todo snapshot instead of the transcript. The CLI called the tool; an
  accounting that followed the transcript would under-report the round.
- **kimi and dsh count over the ROUND, not the mirror window.** Both mirror
  incrementally, so a settle pass whose delta a live poll already drained
  would otherwise report zero, and a kimi resume round would otherwise
  inherit the earlier turns' calls. Both read the round's own span instead.

**`byName` is never normalized across harnesses.** The keys are each CLI's own
vocabulary, verbatim. Cross-harness comparison is therefore `count` only, and
the READMEs say so: a shared taxonomy would be an equivalence the four CLIs
never agreed to, invented by us and then compared as if it were a measurement.

**Absent is not zero.** A round that reported no accounting carries no field —
"the harness counted none" and "the round used no tools" are different facts,
and only absence states the first one honestly. This rule travels the whole
path: the settled event, the annotation, the table cell, the ledger row.

**`toolCalls` rides the event only, never the delegation record.** The record
states a delegation's latest state (its model, its build); a per-round count
merged into it would silently overwrite the previous round's number.

Only the exec path reports it, because only the exec path reports ANY settled
observation today — the live drivers emit `delta` and `mirror` progress and no
`settled` at all. `toolCalls` therefore lands exactly where `usage` and
`observedModel` already live, and the evaluation's pinned drive is exec.

### The evaluation side: one column and one ledger

`DelegationProgress` gains `toolCalls` and `cliVersion`; the run loop merges
both into the delegation annotation the same way `usage` is merged, omitted
when the round reported neither. The efficiency table gains a `工具调用`
column, summed over completed cells (T23's rule) and printed as a dash — with
a line under the table saying why — when no round reported an accounting.

`report/usage.jsonl` is new: **one line per delegation round**, carrying
`{run, cell, attempt, condition, task, stage, round, counted, observedModel?,
cliVersion?, durationMs?, usage?, toolCalls?}`. It aggregates nothing and
prices nothing. The efficiency table is the sum of its `counted: true` rows,
and an external pricing step reads this file instead of re-walking the bundle.

`counted` marks whether the row is inside the table's scope (current attempt,
finished stages). Rows outside it are KEPT rather than dropped: that spend is
real, the table excludes it deliberately, and an outside reader may want a
different scope than the comparison does. `attempt` is carried for the same
reason — a retried cell reuses its mission id, so `cell` alone would not
separate the two attempts' rounds.

`results.jsonl` gains an optional per-CELL `toolCalls` (its rounds summed,
repeated on each of the cell's verdict rows), and nothing else: a cell whose
rounds reported no accounting carries no key, which is what keeps a report
recomputed over an older bundle byte-identical.

## Real-machine verification

Two harnesses, one round each through the shipped provider entry points
against the real CLIs, reading the settled `toolCalls` back and comparing it
with the tool cards the same round mirrored into the child session:

| harness | task | `toolCalls` | mirrored tool cards |
|---|---|---|---|
| codex | list the directory, count the files | `{count: 1, byName: {command_execution: 1}}` | `[Bash]` |
| codex | two shell commands, then answer | `{count: 2, byName: {command_execution: 2}}` | `[Bash, Bash]` |
| claude-code | list the directory, count the files | `{count: 1, byName: {Bash: 1}}` | `[Bash]` |
| claude-code | read two files with Read, then run ls | `{count: 3, byName: {Read: 2, Bash: 1}}` | `[Read, Read, Bash]` |

The codex rows are the naming decision made visible: the accounting says
`command_execution` (codex's item type) where the mirrored card says `Bash`
(the display name), for the same one call.

Recomputing the pilot-a-round1 bundle with this branch, against the same
bundle recomputed on `main`:

- `results.jsonl` — **byte-identical**. No round in that bundle recorded an
  accounting, so no row grew a key.
- `summary.md` — one new column, all dashes, plus the line naming the
  conditions that reported no count.
- `report/usage.jsonl` — new, 7 rows for 7 delegation rounds. Its
  `counted: true` rows reproduce the table: codex 4 rounds / 21.0 min, dsh
  2 rounds / 11.9 min; the one `counted: false` row is the dsh cell parked
  after stage one, which T23 excludes from the table and this file keeps.

## Alternatives considered

**Normalize tool names into a shared taxonomy (`shell`, `read`, `search`).**
Rejected. The mapping would be ours, not the CLIs', and every reader would
then compare four harnesses through a translation table nobody validated —
worse than comparing counts and reading the raw names. `count` is the honest
comparable; `byName` is for a reader who wants to know what actually ran.

**Count in a new pass over the stream, or from the child session's mirrored
tool cards.** Rejected. A second parse is a second thing to keep in sync with
the CLIs, and the mirrored cards are a display surface: codex renames
`command_execution` to `Bash` there, claude's TodoWrite never becomes a card
at all, and a live-mirrored round's cards may already be in the session before
the settle pass runs. Counting in the fold that already reads the events keeps
one source of truth.

**Report `count: 0` for a round that made no tool call.** Rejected. Only the
harnesses that report an accounting can distinguish zero from unknown, and a
zero in the table would read as a measured fact about an older bundle that
measured nothing. Absence propagates instead, and the table prints a dash with
a line explaining it.

**Merge `toolCalls` into the delegation record like `observedModel`.**
Rejected: the record is per delegation and the count is per round, so the
merge would keep only the last round's number while looking like a total.

**Put the per-round ledger inside `results.jsonl`.** Rejected: that file is
one line per VERDICT, and a verdict has no round of its own — the rounds would
have to be duplicated across every verdict row or flattened into a total. A
separate file keeps the round the unit of the row, and keeps `results.jsonl`
byte-identical for bundles that predate this.

**Write only the counted rounds to `usage.jsonl`, so the file needs no
`counted` field.** Rejected: it would silently drop real spend an external
pricing step may want, and the information could not be recovered from the
file. One boolean keeps both scopes available.

**Also write the pricing column.** Out of scope by decision: unit prices are
applied by a non-model step outside the bundle, and `run.meta.pricing` stays
the read path it already is. This change only makes sure that step has a
per-round file to read.

## Consequences

The delegation annotation gains two optional fields. Older bundles keep
loading unchanged (both are read as optional and absent stays absent), and a
report recomputed over one produces the same `results.jsonl` it did before.

`usage.jsonl` is written on every export, empty file included — an empty file
says "no delegation round was recorded", where a missing file cannot be told
apart from an export that predates the ledger.

The four harnesses' counts are comparable only as totals. Two of them
(kimi, dsh) name tools by their own event vocabulary, which means a reader
comparing `byName` across harnesses is comparing four dictionaries; the
READMEs and the field's doc comment both say so, but nothing enforces it.

Live-driven rounds report no `toolCalls`, because they report no settled
observation at all — the same gap `usage` and `observedModel` already have
there. Closing it means giving the live drivers a settled channel, which is a
separate piece of work and is not started here.
