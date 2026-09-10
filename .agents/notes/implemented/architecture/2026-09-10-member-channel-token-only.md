# Agent Note: member-channel token-only auth (host 0.1.5)

Status: implemented

English | [中文](2026-09-10-member-channel-token-only.zh.md)

## Problem

Host 0.1.5 removed `SubprocessHandle.pid` (the managed-range abstraction owns process identity). The member channel's bridge callbacks were authenticated on the per-run token AND a parentage cross-check against the spawned CLI's pid — unfeedable ever since. The batch-1 adaptation ([host 0.1.5 breaking adaptation](2026-09-10-host-015-breaking-adaptation.md)) failed CLOSED: with no pid bound, every callback rejected as foreign, and CLI member-to-member messaging stopped working at all. The [auth-hardening proposal](../../../proposals/active/2026-09-10-member-channel-auth-hardening.md) split the follow-up into M1 (restore delivery token-only now) and M2 (a real second factor later).

## Decision

The per-run token is the sole credential again. The wire drops the vestigial `pid` field (`{ token, to, text }` — the bridge no longer sends `process.ppid`), `MemberChannel.handle` resolves the token to the registered in-flight run and checks nothing else, and `LocalAgentMemberRun` loses `cliPid`. `bindMemberRunPid` is DELETED rather than kept: with no producer able to supply a pid it was dead code inviting a false sense of a second factor; the hardening proposal's M2 will introduce its own credential surface when it lands. Everything that made the token strong stays: minted per run (fresh and resume rounds alike), delivered only through the CLI's scoped MCP config inside the 0700 scoped home, invalidated at settle.

The threat model is documented in the package README's Known Limitations (both languages): the token keeps out other users, not a same-host same-user sibling member CLI whose model-driven bash can read and replay another member's token — and the old pid check was itself a self-reported field that never stopped a deliberate forgery, so its loss changes little. M2 (kernel-level socket peer credentials, or a spawn-time capability token via an upstream seam) tracks the real fix.

## Alternatives considered

**Keep `bindMemberRunPid` and the `cliPid` field for a future pid seam.** Rejected: dead API with no possible producer reads as a live control; the member-channel spec suite even pinned "never called" assertions around it. Deleting forces M2 to design its credential honestly instead of resurrecting a self-reported pid.

**Keep sending `process.ppid` on the wire for logging/forensics.** Rejected: an unchecked self-reported field in an auth-bearing payload invites a future reader to trust it; the wire carries only what the host verifies.

## Consequences

CLI member-to-member messaging works on host 0.1.5 again. The acceptance surface: `member-channel.spec.ts` covers the wrong-token, unknown/expired-run, and successful-delivery paths (the token-only test pins that a live token alone delivers), and `member-bridge.spec.ts` pins the pid-free wire shape. The security posture is honestly documented as single-factor with a named residual exposure; M2 owns closing it.
