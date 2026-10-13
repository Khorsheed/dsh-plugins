# Agent Note: Bound idle handoff polling cost

Status: implemented

## Problem

After a launch cutover settles, a new browser capability has no matching registration. Optional chaining made the missing registration look unacknowledged, waking the long poll immediately. The client immediately polled again. Each ownership check also spawned synchronous process probes on macOS, blocking unrelated HTTP delivery.

## Decision

A settled receipt wakes a poll only for an existing unacknowledged registration. The handler shares its own cached process identity between the boot-generation and receipt channels. It compares both PID and start token on every ownership decision; receipt, registration, authentication and canary checks remain live. A process cannot change its own start identity during its lifetime, and a restarted process constructs a new handler. Missing identity fails closed. Test-injected ownership probes remain supported.

The browser adds a 250 ms floor after idle responses for interoperability with older servers and immediately answered terminal states. Normal idle requests still wait up to 25 seconds and detect cutover changes every 200 ms.

## Alternatives considered

**Only throttle the browser.** This leaves synchronous subprocess work in every held-poll iteration and does not protect against already-open older clients.

**Cache arbitrary PID checks or skip ownership checks.** Either could accept a recycled PID. Only this handler's own immutable identity is reused; foreign process checks elsewhere in the guard remain unchanged.

## Consequences

New tabs no longer turn settled receipts into request loops. Receipt polling still reads state files, but no longer spawns processes per tab and interval. The fallback delay adds at most 250 ms between an immediately answered idle state and its next poll. Tests cover concurrent unregistered tabs, one identity lookup, mismatched/unavailable identity, browser pacing, and existing cutover/generation flows.
