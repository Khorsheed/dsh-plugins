# Agent Note: Member composer running bit is dual-source — Stop and the running badge light up for external CLI runs

Status: implemented

English | [中文](2026-08-30-member-composer-active-delegations.zh.md)

## Problem

Live bug (prod 3080): while a CLI member's run was in flight, the member composer showed an enabled input and a Send arrow — never the running badge or the Stop button — so there was no way to interrupt a member from its own composer ("无法在子agent的composer停止一个子agent"). Root cause: the composer derived "run in flight" solely from the session summary's `running` flag, which is host `agent/status`-driven. External CLI runs have no live host agent, so the flag stays false for the entire run (the family's own gateway doc had long noted this: "the official session summary's `running` flag is agent-based and stays false for external CLI one-shots"). The same dead source also silently disabled the re-probe-on-running-flip path (2026-08-28) in production: the read-only → writable flip on a first round's settle never fired off the test bench. The official subagent catalog's "当前未运行" row label shares this root cause but is host-owned (fixing it means shadowing the `conversation.session.header.lineage` slot or an upstream seam — deliberately out of scope here).

## Decision

- **Dual-source running, the taskpilot dock's proven pattern.** The composer polls the family's in-flight delegation registry through the gateway's `activeDelegations` Remote every 1.5 s while mounted (a new `MemberComposerInjected.activeDelegations` entry; RPC failure maps to undefined). `running = summary.running || activeDelegations.includes(childId)` — the dsh member's sub-instance still drives the official flag natively, and external CLI runs light up via the registry.
- **A poll failure keeps the last known bit.** A transient RPC error never flaps Stop off mid-run.
- The existing probe effect already re-runs on `running` flips, so the first-round read-only → writable flip now works in production with no further change (pinned by a new test).

## Verification

`tests/member-composer.client.spec.tsx` (+3, suite 30; package 167 green, build green): Stop and the running badge appear from the polled bit alone (summary flag false) and Stop dispatches `stopMember`; a failed poll keeps the bit; the panel flips read-only → writable when the in-flight bit drops at settle and the re-probe finds the record. Deployed to prod 3080 (canary PASS).

## Alternatives considered

**Drive the running UI from mirrored transcript events** — rejected: the mirror appends content events, none of which the host's agent-based flag reads, and inventing a family-private running projection duplicates exactly what `activeDelegations` already publishes.

**Shadow the official lineage dropdown to fix the "当前未运行" label too** — rejected for scope: it replaces a host-owned component we would have to track across upstream releases; the label is cosmetic, the missing Stop was functional. Left as a possible upstream seam.

**Push instead of poll (a family event bus)** — rejected: the gateway already exposes the pull Remote, taskpilot's 1.5 s cadence is proven cheap, and a bus adds lifecycle surface for no user-visible gain.

## Consequences

The member composer now shows the running badge and Stop during any member run (exec or live, any provider), and Stop interrupts the run through the existing `stopMember` facade path. One Remote call per 1.5 s per open composer — negligible local traffic; non-member one-shot sessions poll too (their answer is always "not active"). The official catalog's "当前未运行" label is unchanged (host-owned; see Alternatives).
