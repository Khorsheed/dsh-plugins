# Agent Note: local-agent delegation-mapping persistence (delegations.jsonl)

Status: implemented

English | [中文](2026-08-19-local-agent-delegation-persistence.zh.md)

## Problem

`LocalAgentRegistry`'s delegation mappings (`childSessionId → { provider, parentSessionId, cliSessionId, kimiMirroredLines? }`) and the kimi mirror offsets lived in in-memory Maps, lost on host restart — so a resume handle from a previous run failed `resolveDelegation` with "no delegation recorded" and the cross-restart resume chain stayed broken. This is milestone M4 of the [delegation-API proposal](../../../proposals/active/2026-08-18-local-agent-delegation-api.md); the storage design is absorbed verbatim from item 1 of the rejected [codex persistence note](../../rejected/feature/2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md) (absorbed into the proposal's M4 when that note was retired).

## Decision

Append-only `delegations.jsonl` in each harness's scoped home (`registry.homeDir(name)/delegations.jsonl` — harness-level bookkeeping, same domain as session_index/rollout files, NOT the child session's log):

- **Write path**: `recordDelegation` appends one JSON line synchronously (`appendFileSync`) after updating the in-memory Map — recording happens once per fresh-round settle, so durability beats async cleverness. The owning harness resolves from the registered harnesses' `delegationProvider` field; an unclaimed provider keeps the in-memory record and warns, never throws (recording must not break a settling run). `setKimiMirroredLines` re-appends the record with the latest `kimiMirroredLines`, so the offset survives restart WITH its record.
- **Load path**: `register(harness)` synchronously reads the harness's file into `delegations` and `kimiMirrorOffsets` before `localAgent/harness-added` fires. Last line per childSessionId wins — the same replace semantics as `recordDelegation`. Malformed lines, and lines naming a provider other than the loading harness's, skip with a warn and never fail registration.
- **`resolveDelegation` is untouched**: same synchronous signature, same ownership checks (parent session, provider) applied to restored records exactly as to live ones.
- Growth is accepted (append-only, no rotation) — the same class as session_index/rollout growth — and documented in the package README's Known Limitations.

With M1's reattach recipe, the cross-restart chain closes: the mapping loads at `register` → `resolveDelegation` passes → the facade reattaches the child session from persistence → the provider resumes the CLI thread → kimi mirroring resumes from the persisted offset (no first-round duplication).

## Alternatives considered

- **Storing the mapping in the child session's log** — rejected (carried over from the rejected codex note): the mapping is harness-level bookkeeping ("which dsh child session continues which CLI thread"), while the child session log belongs to the dsh session domain whose lifecycle (reopen, cleanup, compaction) the session system owns; scoped-home storage lets both domains evolve independently.
- **In-memory Map + async/batched writes** — rejected: the write happens once per delegation round; a sync append is simpler and removes the lost-write window between settle and flush.
- **Rewriting the file with the current Map state instead of append-only** — rejected: append-only matches the harness's other journal files, needs no read-modify-write race handling between concurrent registry operations, and last-line-wins gives replace semantics for free.
- **Loading lazily on `resolveDelegation` miss** — rejected: it would force the (sync, contract-pinned) ownership check to become async or to hide I/O inside it; loading at `register` keeps every read path synchronous.

## Consequences

- A delegation's resume handle survives a host restart, closing the last break in the cross-restart chain (M1 reattach + M4 mapping); `kimiMirroredLines` no longer falls back to 0 after a restart, so resumed rounds never re-mirror earlier content.
- Every `recordDelegation` now does a synchronous file append — bounded to once per fresh-round settle (plus one per mirror pass when a record exists); providers on the settle path are unaffected functionally.
- Records for a provider no harness claims stay memory-only with a warn — visible in logs, never fatal; the file is only as durable as the harness registration that owns it.
- The offset-independence invariant stands: `kimiMirrorOffsets` remains a dedicated map at runtime (offsets still advance without a record); persistence simply has no offset to restore when no record exists — which is exactly the case where resume is impossible anyway.
- The file grows unboundedly in long-lived profiles (accepted; rotation deferred — see the package README).

## Testing

`packages/local-agent/tests/delegation-persistence.spec.ts` (6 tests) mounts fresh registries over a shared homesRoot to simulate restarts: record → restart → resolve with ownership checks intact (wrong parent / wrong provider / unknown child all still rejected), replace semantics across restart (later line wins, single in-memory record), corrupt and foreign-provider lines skipped while valid siblings load, unclaimed provider (in-memory kept, no throw, no file written), and offset persistence (`setKimiMirroredLines` advances restore). Warn text itself is not asserted — cordis's built-in logger is not interceptable from tests (a fresh instance per `ctx.logger` access); the tests pin the skip/no-throw/no-file behavior instead. Regression: local-agent 101/101, kimi 56/56, tool-subagent 10/10.

## Cross-references

- [Delegation-API proposal](../../../proposals/active/2026-08-18-local-agent-delegation-api.md) — the milestone plan this completes (M4, design §2).
- [Rejected codex persistence note](../../rejected/feature/2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.md) — source of the absorbed storage design (item 1).
- [Delegation facade](2026-08-18-local-agent-delegation-facade.md) — the M1 facade whose reattach recipe this completes.
- [Live transcript mirroring](2026-08-19-local-agent-live-mirror.md) — the M3 mirror whose offset this persists.
