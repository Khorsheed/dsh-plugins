# Agent Note: kimi live mirror — three root causes behind empty folds (0 tok, missing prompt, duplicated prompts)

Status: implemented

English | [中文](2026-08-27-kimi-live-mirror-fold-fixes.zh.md)

## Problem

Real-instance acceptance of the live settings card (demo 3291) surfaced three kimi live-mode symptoms: the child session showed **0 tok** and **no usage**, the **member's prompt was missing** from the conversation, and once the fold did land, the **same prompt appeared multiple times**. Three independent root causes, all in the live mirror path (exec was unaffected — its single settle pass masked two of them).

## Decision

**1. ACP session ids are directory names (`session_<uuid>`); the mirror blindly re-prefixed.** Real kimi ACP `session/new` returns `session_<uuid>`, so the mirror looked for `session_session_<uuid>/wire.jsonl`, found nothing, and folded zero lines — silently. Fix: `bareKimiSessionId` / `acpKimiSessionId` helpers (`live-driver.ts`); the delegation record stores the **bare uuid** (the exec path's convention, keeping live- and exec-written records interchangeable), the wire protocol always uses the ACP-native form (`session/load` verified by probe to REQUIRE it — bare ids fail with "Unknown sessionId"), and both filesystem consumers (`session-mirror.ts` lookup, exec resume's `kimi -S` argv) are prefix-tolerant for legacy records.

**2. The mirror's belt-and-braces persistence append killed every pass before the offset advanced.** `mirrorKimiSessionDelta` ended with `persistence.append(id, childSession.events)` — the FULL event list. For a live child session, the store's own write-behind pipeline already persisted those events, so the coordinator's contiguous-seq contract rejected the append ("append seq mismatch"), the fold threw after appending events but before `setKimiMirroredLines`, and every later pass re-folded from line 0 (duplicated prompts; the delegation record never gained `kimiMirroredLines`). Fix: persist only for standalone sessions (`persistIfStandalone` — a live session's pipeline owns durability; the redundant call is skipped).

**3a. The settle fold raced the wire flush.** kimi's wire.jsonl flushes asynchronously past the prompt response (prompt lines early, answer by turn end); the single settle pass often read a prefix and the round ended with no folded answer. Fix: the settle chain now folds until the transcript total is stable across 3 consecutive 300ms reads (bounded at 3s) — format-agnostic quiescence.

**3b. The usage attach window excluded boundary records.** kimi writes a request's `usage.record` BEFORE the content parts it accounts for, so with an advanced offset the record sits exactly at `fromLines` and the old `> fromLines` filter dropped it — incremental folds lost the round's entire accounting. Fix: `>= fromLines` (accepted trade-off: a record exactly on a pass boundary may attach to both passes; losing usage entirely was worse).

## Alternatives considered

- **Storing ACP-native ids in the delegation record** — rejected: exec records are bare uuids, and mixed forms force every consumer to guess; one canonical form with tolerant consumers is simpler.
- **Catching the seq-mismatch and continuing** — rejected: the live-check makes the intent explicit (write-behind owns live sessions); swallowing arbitrary persistence errors would hide real failures on standalone sessions.
- **Waiting for a wire `turn.ended` line before the settle fold** — rejected: quiescence needs no wire-format knowledge and also covers multi-request turns.

## Consequences

- Live child sessions now show the member's prompt once, the folded answer with usage (tokens and cache hit render in the UI), and the delegation record carries the mirror offset again.
- **Known remaining issue (not fixed here):** under `liveMirrorGranularity: 'token'`, streamed chunks and the settled fold both render (duplicated content), and the hardcoded `step: 1` chunk stream never closes — the UI shows a 已停止 badge on the dangling stream. The official projection merges stream+message only when they share a step; aligning the stream's steps with the fold's (or skipping folded text in token mode) is a follow-up. The default `event` granularity is unaffected.
- codex/claude-code live drivers append their own `user/message` at round start (they don't share this fold), but M2 should re-check their settle mirrors against root causes 2 and 3a.

## Testing

- `live-driver.spec.ts` +3: strict-persistence mount (live session + coordinator double that always rejects the full-list append) pins "offset advances, no re-fold, boundary usage attaches"; flush-race test pins the settle quiescence. `session-mirror.spec.ts` +1 (prefixed-id resolution), `kimi-cli-provider.spec.ts` +1 (exec resume never double-prefixes). The fake ACP server now issues realistic `session_<uuid>` ids, turning the pre-existing settle-mirror test into a prefix regression. Suite: kimi 110/110; full-repo build/test both exit 0.
- Real instance (demo 3291, ~/.dsh-live-demo): live round shows the prompt once, the answer with usage (24.4K tok, cache 79% in the UI), record carries `kimiMirroredLines: 3`; mid-run tokens stream under token granularity.

## Cross-references

- [Live settings card M1](2026-08-27-local-agent-live-settings-card-m1.md) — the acceptance that surfaced these.
- [Live driver proposal](../../../proposals/closed/2026-08-20-local-agent-live-driver.md) — kimi M3's mirror design this corrects.
