# Agent Note: consolidating the local-agent provider family into its core

Status: proposed

## Problem

The four CLI providers (`local-agent-claude-code`, `-codex`, `-kimi`, `-dsh`) carry about 15k lines beside the 8k-line core. Each provider reimplements the same three layers:

- **Mirror vocabulary.** The same `*_INTERRUPTED_TOOL_RESULT` text appears four times. Each provider has its own `append*RequestHeader`, assistant-event builder, transcript-line append, `textTask`, `toolCallsOf`, `register*MemberRun` and CLI-version probe.
- **Log structure.** Each provider numbers turns and steps, closes them, pairs tool lifecycles and attributes usage on its own. Between 10-24 and 10-27 this layer produced seven different unreadable-log shapes and two "answer folded into the process" regressions (see [the write guard](../../implemented/feature/2026-10-27-member-child-log-guard.md)).
- **Resident-process lifecycle.** Each live driver (1.0k–1.7k lines) has its own runtime class, idle reclaim, crash respawn with resume, channel breaker, per-member round chain, abort wiring, stream ledger and settle ordering. The four implementations differ mostly by accident.

A fix to one layer reaches one provider at a time, and every behavior change has to be re-derived four times.

## Proposal

Move each shared layer into `@khorsheed/dsh-local-agent` behind a small provider seam, one phase at a time. Each phase lands green and on its own.

1. **Write guard (done).** The core guards every member child session. Providers keep their own numbering, but the guard owns validity.
2. **Mirror vocabulary.** The core exports one interrupted-result text, one request-header append (only on change), one assistant-event and tool-lifecycle writer (an atomic step: message, call, result, end), one usage mapper contract with per-provider adapters, `textTask`, `toolCallsOf` and the version probe. Providers delete their copies.
3. **Step writer.** The core exposes `childLog.step(turn, { blocks, tools, usage })` and `childLog.turn()`. It numbers at write time (the rule Claude and Codex already follow, and Kimi as of 59c2cbb24) and closes turns on settle. Providers stop handling numbers; reservations stay only as preview keys.
4. **Live runtime base.** A core `ResidentRuntime` base class holds spawn and resume, idle reclaim, the breaker, round chaining, abort wiring and settle-then-close ordering, including Claude's rule that nothing is written after settle. Providers supply the protocol adapter: stream-json, app-server, ACP or dsh `--serve`.

## Constraints

- Coordinate before each phase. The live drivers are under active edits (`codex/room-local-agent-main-integration` touches all three), so each phase starts from main after those branches merge.
- No behavior change inside a phase. Each phase deletes duplicates behind an unchanged contract, and the providers' existing specs stay green unmodified.
- The core-companion direction rule still holds: providers inject `localAgent`, and the core never imports a provider.

## Acceptance criteria

- Each phase lands as its own merge, with every provider's existing spec suite green and unmodified.
- After phase 2, no provider package defines its own interrupted-result text, request-header append, assistant-event or tool-lifecycle writer.
- After phase 3, no provider numbers a durable step. `pnpm repair:member-logs` stays at zero unreadable logs across a week of prod use, and the quarantine holds no answer content.
- After phase 4, each live driver keeps only its protocol adapter, and the four share one lifecycle implementation.

## Risks

- The four protocols differ in places a shared base may flatten: kimi's wire-versus-ACP split, codex's per-item app-server, claude's per-block events. Each adapter must keep its own ordering rules.
- Phases collide with in-flight driver work if started before those branches merge.
- A shared lifecycle bug would hit all four providers at once, so phase 4 needs the providers' live-driver suites run against the base.

## Alternatives considered

- **Leave the family as is and rely on the guard.** The guard prevents unreadable logs, but not wrong content (split calls, wrong usage, answer order), and lifecycle fixes would still be repeated four times.
- **One big refactor.** Too wide to review against four live protocols, and it collides with the in-flight driver work.

## Consequences

- If accepted, provider packages shrink to protocol adapters, parsers and their settings and auth faces.
- The log contract that Context Lens and the room read is owned in one place.
