# Agent Note: ankh-guard cutover process ownership

Status: implemented

English | [中文](2026-09-02-ankh-guard-cutover-process-ownership.zh.md)

## Problem

The [transactional launch-cutover protocol](../feature/2026-09-01-ankh-guard-launch-cutover.md) transferred the durable watchdog pidfile before stopping the old host, but it did not transfer an authoritative identity for the host process tree. A real host self-upgrade exposed the gap: terminating an outer launcher left an inner watchdog reparented to PID 1, the old host kept its listener, and the target repeatedly failed with `EADDRINUSE`. Because readiness queried only the shared port, the old host's HTTP 200 was credited to the failed target; the receipt recorded transport, canary, and ready while target failures remained zero, so recovery never ran.

The same experiment showed that dsh tool sessions may omit `/usr/sbin` from PATH. A bare `lsof` invocation then looked indistinguishable from "no listener" when its error was swallowed. Fixing PATH alone would make the probe run but would leave the ownership confusion intact.

## Decision

- Before preparing a cutover, `reconfigure` requires exactly one listener on the shared port and traces its parent chain to the live previous supervisor. It persists both the supervisor's direct-child root and the listener as PID plus kernel-visible process-start token. An ambiguous or unprovable relationship refuses before the old host stops.
- The successor stops only those captured identities. It freezes the child root before enumerating descendants, reaps the tree deepest-first, separately retires the captured listener identity, confirms both identities exited, and requires the port to be empty. It never chooses or kills a cutover process merely because `lsof` finds it on the port.
- Process discovery resolves canonical absolute paths for `lsof`, `ps`, and `pgrep` before falling back to PATH. Missing proof tooling fails the watchdog loudly; it is not converted into absence.
- Every launched attempt records its direct-child PID/start token. HTTP or authentication success is provisional until the port has exactly one listener in that child tree and the same child/listener identities remain alive and unchanged through the default three-second stability window at retry zero. The proof is repeated around HTTP exchange and before canary. Browser handoff occurs only after the stability proof, so a rejected short-lived target cannot leak its URL. Receipt transitions reject an ownership proof that does not match the active attempt, and target ready additionally requires completed handoff when applicable and canary pass.
- A failed provisional readiness, target `EADDRINUSE`, identity change, or child exit increments the role-specific failure count and follows only the pre-approved complete-spec recovery policy. Cutover failure never falls through to port cleanup, repository reset, or profile-composition rollback.
- `abort-cutover` durably requests the policy approved by `reconfigure`. `restore-previous` durably adds explicit authority to restore the complete previous launch specification even when the original policy was `wait-for-user`. A later ordinary abort cannot downgrade that stronger request. The watchdog consumes the marker and records the control event before changing process state.

## Durable evidence

`launch-cutover.json` now carries previous, target, and restored child/listener ownership identities; the stable-window duration and retry count; per-role failure counts; authentication and browser handoff; canary; recovery; and control events. PID start tokens make a recycled numeric PID fail identity comparison. Full commands remain only in the mode-0600 launch state; the receipt remains credential-free.

## Alternatives considered

**Only add `/usr/sbin` to PATH.** Rejected because it repairs tool lookup but still lets an unrelated listener's response impersonate the target and still gives the successor no safe process to stop.

**Infer the child from the port at stop or readiness time.** Rejected because a shared authority is exactly where old, target, crash-page, and foreign listeners race. Port membership is an observation, not ownership authority.

**Kill the old supervisor or an assumed process group.** Rejected because deployed instances are not guaranteed to be process-group leaders, and an outer supervisor can exit while an inner watchdog or shell descendants are reparented. Capturing the old supervisor's direct child before handoff and freezing that root closes the reparent window without broad group signals.

**Accept a single successful HTTP probe and detect later exit in the ordinary loop.** Rejected because the receipt and session wake would already be terminal. A bounded stability window keeps short-lived readiness inside the recoverable transaction.

**Use signals as the operator abort interface.** Rejected because a signal is not durable, does not identify the cutover or requested policy, and can be lost across supervisor replacement. The state file is the command; SIGUSR2 only wakes its current consumer.

## Consequences

- Cutovers add a three-second default stability delay and fail closed when listener ancestry, process start identity, or proof tooling is unavailable. This is intentional: availability is preserved by leaving the previous host untouched until ownership is known.
- A nonterminal receipt created by older code without previous child/listener ownership cannot be resumed automatically. A new foreground supervisor refuses with an explicit diagnostic instead of inventing evidence or killing a port owner; the operator must settle that exceptional transaction with the still-running host left untouched.
- Ordinary same-launch restarts still use their smaller path, but their watchdog readiness benefits from the same child/listener identity proof. Ordinary non-cutover recovery retains its bounded port-cleanup escape hatch; cutover does not.
- Real-process regressions cover restricted PATH, nested supervisor/child/listener ancestry, complete previous-watchdog to replacement-watchdog takeover, a detached stale 200 listener plus target `EADDRINUSE`, target exit after provisional 200, target/previous failure counts and restoration, and both durable control commands. No host source change is involved.
