# Agent Note: dsh sub-agent session mirror — comparison-grade records for the fourth harness

Status: implemented

English | [中文](2026-08-18-local-agent-dsh-session-mirror.zh.md)

## Problem

The dsh harness (`local-agent-dsh`) delegated through a sub-dsh headless process but mirrored nothing into the parent-side child session: it carried only the descriptor and turn boundaries — no conversation, no token usage. With kimi/codex/claude already mirroring content and usage at comparison-grade fidelity, the dsh harness was the odd one out for the four-harness evaluation the family is built for.

## Decision

Mirror from the sub-dsh's own session file — the cheapest and highest-fidelity path of all four harnesses, because the sub-dsh session shares the child session's id AND the `SessionEvent` format:

- `src/session-mirror.ts` reads `<scoped home>/sessions/<workspace>/<id>/session.jsonl[.zstd]`. Decompression uses Node ≥22.15 built-in `node:zlib` zstd support — the published `dsh-session-persistence-jsonl` rc.6 JS exports `decompressZstdFrame` but its types do not, so a package dependency would not compile. **Multi-frame is mandatory**: the persistence layer appends one zstd frame per flush batch, and Node's single-shot (and streaming) decompressor stops at the first frame — the first deployment of this mirror silently read only the session header until the frames were scanned individually (guarded by a two-frame test fixture).
- **Round scoping without a registry**: the parent's `turn/start` count IS the round number, and the sub-dsh numbers its turns identically across fresh/resume rounds — a round's mirror span is the sub-dsh events from its `turn/start` with `turn === round` to the next `turn/start`. Restart-safe by construction (no offset map like kimi's `kimiMirrorOffsets`).
- **Verbatim copy, not re-encoding**: `user/message` (only `source.kind === 'user'` — the sub-dsh's own scaffolding from agent-instructions/plugin/skill-catalog sources is filtered) and `assistant/message` (content blocks and the `usage` field ride the event into the tokenUsage projection; reasoning blocks render natively). Turn boundaries are NOT copied — the parent's real-time spawn→settle boundaries stay authoritative for subagentTiming.
- The mirror runs after `result.then(() => child.done)` on EVERY terminal path (completed/aborted/error), so a killed round still preserves partial work — the same chaining the one-shot abort-chain fix established for kimi (settle chain first, process exit second, or turn/end would be missing from the persistence batch).

## Alternatives considered

- **Depending on `dsh-session-persistence-jsonl` for decompression** — rejected: its published rc.6 type surface does not declare `decompressZstdFrame` (present in JS only); Node's built-in zlib zstd covers the need with zero new dependency.
- **Registry-held mirror offset (kimi's pattern)** — rejected: turn numbers are already aligned between the two sessions, so the round span is derivable from the events themselves; one less piece of state to lose on restart.
- **Mirroring turn boundaries too** — rejected: the sub-dsh's own turn/start|end would double-fold the subagentTiming projection against the parent's real-time boundaries.

## Consequences

- The dsh harness's child session now shows the full conversation (task, replies, natively rendered thinking) and real per-round token usage — all four harnesses' records are comparison-grade.
- Resume rounds mirror incrementally by construction (round span = aligned turn numbers), with no offset state to lose on a host restart.
- No new package dependency: decompression rides Node ≥22.15's built-in zstd, which the engines range (`^22.19 || >=24`) guarantees.

## Testing

`tests/session-mirror.spec.ts` pins round scoping (round-2 spans leak nothing from round 1), scaffolding filtering, verbatim usage carriage, zstd reading, and the absent-session no-op; the provider's existing suite still passes with the mirror chained into `startDshCliRun`.

## Cross-references

- [CLI sub-agent resume](2026-08-16-local-agent-resume.md) — the resume rounds this mirror increments through.
