# Agent Note: live-drive rounds report their settled model observation

Status: implemented

English | [中文](2026-09-13-live-settle-observed-model.zh.md)

## Problem

Production `delegations.jsonl` tails showed recent kimi and claude records with no `observedModel` at all, so after a host restart the rebuilt records carried nothing for the memberModel/harnessModel `lastObserved` fill (the composer chip's 默认（最近…） and the settings card). Root cause: only the EXEC drive reported settled observations (`onRoundSettled` → `recordRoundSettled`) — all four providers' LIVE settle paths folded transcripts and usage but never called the registry's observation channel, and production runs live. kimi's second record line per child was `setKimiMirroredLines`'s persist, not a settle merge. A secondary gap sat underneath: `recordRoundSettled`'s merge was skipped when the record did not exist yet (each provider's record point is its own), and `parseDelegationLine` dropped `cliVersion` on reload even though the merge persisted it. Separately, a member whose only named model was its last-observed one got an empty model menu: the gateway filled `lastObserved` but never offered it in `choices`.

## Decision

**Live settle reports (all four providers).** Each live driver's settle path now calls `recordRoundSettled` once per settled round that opened a turn, degrading silently on a core predating the API (the kimi driver's `reportAuthFailure` guard idiom). kimi captures the wire's `usage.record`/`llm.request` `model` from every mirror pass and reports the latest; claude captures `model`/`claude_code_version` off the per-turn `system/init` event and reports them with the result event's usage and the round's tool-call accounting; codex reads the round's own rollout file at settle (`codexRolloutRoundFacts`, threadId + cwd + round-start window — the exec settle mirror's exact read-back, recovering a non-completed turn's unstreamed spend); dsh reports the settle mirror delta's `observedModel`/`usage`/`toolCalls`. Absence stays absence, never guessed.

**Ordering tolerance in the core.** `recordRoundSettled` with no record yet stashes the observation (`pendingRoundObservations`); `recordDelegation` merges the stash, the record's own values winning, and consumes it once. In-memory only — an observation whose record never arrives stays unrecorded, exactly as before. `parseDelegationLine` also restores `cliVersion`, so the persisted merge survives a restart whole.

**Gateway choice appending.** `memberModel` and `harnessModel` append the merged `lastObserved` to `choices` as the final entry when no broker choice lists it (deduped, broker ranking untouched) — a member that ran once has a one-item menu instead of an empty one.

## Alternatives considered

**Ask providers to order record-before-settle.** Rejected: the record point differs per drive by design (a live round records at session/new, an exec round at the post-settle output parse), so the channel tolerates the inversion centrally instead of constraining every provider path.

**Report round-total usage on the kimi live settle.** Rejected: the live drive attaches usage per folded message and tracks only the uncarried remainder, so a "total" would be a guess; kimi's live report carries the model alone — absence is honest.

## Consequences

Live-driven rounds (production's path) now land `observedModel` in memory and `delegations.jsonl`, so restarts keep the `lastObserved` layer populated; the `settled` event also closes the parked progress route promptly instead of at the grace timeout. Tests: core delegation ordering + persistence (5 new), gateway choices (6 new), one observed/absent pair per provider's live-driver spec. The provider READMEs already documented per-settled-round read-back; the fix makes the live drive match the docs.
