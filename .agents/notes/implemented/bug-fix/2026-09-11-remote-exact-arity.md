# Agent Note: Remote client enforces exact arity — optional parameters must be passed explicitly

Status: implemented

English | [中文](2026-09-11-remote-exact-arity.zh.md)

## Problem

The four local-agent provider settings cards all read "not logged in" on prod 3080 while every credential sat intact in the scoped homes. The chain was: the named-scopes feature ([84ce03d](https://github.com/Khorsheed/dsh-plugins/commit/84ce03d)) widened the family gateway's `status(name)` to `status(name, scope?)` (and `sessions(name)` to `sessions(name, sessionId?)`); the four cards kept calling `status(name)`. The api-gateway client validates invocation arity exactly (`prepareInvocation`: `values.length !== expected` throws, "expected 2 argument(s), got 1"), so every status probe failed and the card rendered its unavailable state. TypeScript's optional parameters admit the one-arg call at compile time, so nothing caught it at build or test time.

## Decision

The cards pass the default scope explicitly: `gateway().status(name, undefined)`. `undefined` is the host-side "omitted" (default scope) and satisfies the arity check. One regression spec per provider (`tests/client-apply.spec.ts`) drives the client plugin's `apply` over a fake gateway and pins the two-argument call. The gateway's `sessions(name, sessionId?)` has no live callers (the records action is unmounted), so nothing else moved.

## Alternatives considered

**Fix the arity check upstream to tolerate omitted trailing optionals.** Rejected for now: the check lives in the host's api-gateway client and the repo rule is no local host forks; an upstream proposal can still relax it, but the explicit-argument call is correct on every host line, so the plugin-side fix is sufficient and portable.

**Widen the card's status face to carry a scope selector.** Rejected: the cards report the default scope today and no card UI selects scopes; the minimal fix restores exactly the pre-regression behavior.

## Consequences

The four providers' auth dots and blocks read the real credential state again (verified live on a 0.1.5-rc.1 composition: a planted credential flips the kimi card to 已登录, empty homes correctly stay 未登录). The trap to remember: a Typert Remote method's runtime arity is its DECLARED parameter count — an optional parameter added server-side is a breaking change for every existing client call, and the compiler will not say so.
