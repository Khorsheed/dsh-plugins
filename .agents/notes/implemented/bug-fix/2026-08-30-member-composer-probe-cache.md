# Agent Note: Member composer probe window can never flash the read-only panel; membership is cached per session

Status: implemented

English | [中文](2026-08-30-member-composer-probe-cache.zh.md)

## Problem

MemberComposer verifies membership through the `memberOf` Remote on every mount, and two gaps let a family member session briefly render the "one-shot subagent" read-only panel — a false unavailable signal the room demo surfaced:

1. **An RPC failure collapsed into "not a member".** The injected `memberOf` maps an RPC failure to `undefined`, and the component settled `view ?? null` — a transient failure (the Remote channel not yet connected right after mount) rendered the read-only panel for a real member until a `running` flip or a re-enter re-probed. A rejected promise was worse: the `.then` had no rejection arm, so the panel hung on "checking" forever with an unhandled rejection.
2. **No cache.** Every mount started at the checking state, so re-entering the same member session re-ran the probe and re-flashed the window every time.

## Decision

- **Session-level positive membership cache.** A module `Map<childSessionId, LocalAgentDelegationView>` (same shape as the auth-status bus) seeds the initial state and every child switch; a recorded delegation is immutable for the session's lifetime, so a cached member renders the writable box on the first frame with no probe at all. Null answers are never cached — the record lands with the first round's settle (exec) or live handshake, and the existing running-flip re-probe keeps covering exactly that window.
- **RPC failure is never membership evidence.** An `undefined` (or rejected) answer keeps the neutral checking state and retries within a bounded budget (2 retries × 300 ms) before degrading to the read-only panel — without the gateway, send cannot work, so read-only remains the honest end state, only delayed. The checking state was already neutral copy ("正在确认成员身份…"); it is now also the only state a transient failure can show.
- The probe's rejection arm routes into the same retry path, closing the hang-forever hole.

## Verification

`tests/member-composer.client.spec.tsx` (+3, suite 27 green; package 163 green, build green): an RPC failure stays on the checking copy and resolves writable on retry without ever rendering the read-only copy; budget exhaustion degrades to read-only with exactly 1 + 2 probe calls; a re-entered member session renders the writable box on the first frame with zero `memberOf` calls. The suite resets the cache in `afterEach` through the exported `resetMembershipCache` test hook.

## Alternatives considered

**Retry forever while the gateway is down** — rejected: a dead gateway makes send impossible anyway, so an eternal spinner hides the real degradation; the bounded budget falls back to the same read-only panel a confirmed non-member gets.

**Cache null answers with a TTL** — rejected: the record-lands-at-settle window already has the running-flip re-probe, and a stale null would reintroduce the flash for a session that became a member mid-view.

**Skeleton/grayed-box checking visual** — rejected as scope: the complaint was the read-only *semantics*; the checking state was already neutral copy. The flash is eliminated by fixing the collapse and caching positives, not by restyling the window.

## Consequences

A member session open goes straight to either the writable box (cached) or a brief neutral checking beat (first ever view); the read-only panel now means only "confirmed non-member" or "gateway unreachable past the retry budget". The cache lives for the module's lifetime — a few bytes per viewed member session, no eviction. Non-member one-shot sessions still flash the neutral checking state on every enter (their null answer is deliberately uncached).
