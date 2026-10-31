# Agent Note: a member's refused admission is rechecked on the next admission

Status: implemented

## Problem

Room 5d4f0d41's Codex member was refused by the broker's old effort rule ("Codex has not advertised this reasoning effort…"). The member control persisted `status: failed`. After the fixed broker shipped, every dispatch still failed in 0 ms on that stored verdict, because the next admission never asked the adapter again. Only the member card's 对账并重试 button cleared it, and nothing told the user to press it.

## Decision

A failure recorded by `admit`'s own configuration check (the adapter's `prepare` refusing, before anything native starts) marks the record `admissionFailed`. The next admission first runs the same `retry` path as the button: it reconciles and rechecks. If the check still refuses, the round fails with the current reason and the mark is set again. The mark is persisted, so a host restart, which is how a fix ships, keeps it.

Two kinds of failure still wait for the user:

- a failed native start (`MemberControls.runNow`'s `rejectAdmission`, the spawn-failed spec);
- a configuration change that did not apply (the `drain` failure).

The first could spawn in a loop. The second is intent the user must see.

## Alternatives considered

- **Recheck every failed state on admission.** That would turn a spawn failure into a retry loop and silently re-apply a failed selection.

## Consequences

A configuration refusal clears itself once whatever caused it is fixed: a broker rule, the directory, or the endpoint. Records written before this change carry no mark and still need one manual retry.

## Testing

`local-agent` (421): a member-control spec has an admission refused twice, then rechecked by a restored controller and admitted. A second spec keeps a failed apply failing. The spawn-failed spec in member-controls still blocks the second start.
