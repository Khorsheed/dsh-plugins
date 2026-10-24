# Agent Note: A resumed member re-binds the model it was bound to

Status: implemented

English | [中文](2026-10-24-member-model-identity.zh.md)

## Problem

A Claude Code room member's second round in the same host process failed at once with "Member configuration identity changed: model". `MemberControls.get` pins a member's configuration identity (provider, parent, cwd, scope, model, effort, lock) on its first round and refuses a later round whose binding differs.

- The first round binds the model the caller asked for (the invite's pick, for example an alias).
- The Claude provider then records the model it resolved (`round.model`, for example `claude-opus-5-5`) in the delegation record.
- Every resume builds its binding from that record, so the second round named a different model than the pinned one.

A start that named no model hit the same failure once the provider recorded its resolved default. After a host restart the pin is gone, which is why the failure only showed within one process.

## Decision

`recordDelegation` makes the record's `model` mirror the bound one verbatim whenever the member has a bound identity, including its absence. It already did this for `effort` and `configurationLock`. The resolved model stays observable through `observedModel` and the member controls' applied configuration.

Codex, Kimi and dsh already record the requested model. The fix is in the core so that no provider can reintroduce the mismatch.

## Alternatives considered

**Change only the Claude provider to record the requested model.** Rejected: it fixes one writer and leaves the invariant ("the record's model is what a resume binds") to each provider again.

**Relax the identity check for `model`.** Rejected: the check is what keeps a foreign binding out of a member's queue, and a model change belongs in the member configuration controls, not in a silently different binding.

## Consequences

- Delegation records written while a member is bound carry the requested model, not the resolved one. Older records keep their resolved value. After a restart they bind from scratch, so they do not conflict.
- `tests/delegation-facade.spec.ts` covers an aliased model and a model-less start across two rounds.
