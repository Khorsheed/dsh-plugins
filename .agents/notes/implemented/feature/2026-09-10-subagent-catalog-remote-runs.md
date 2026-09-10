# Agent Note: Parent-side subagent catalog rows for remote CLI runs

Status: implemented

English | [中文](2026-09-10-subagent-catalog-remote-runs.zh.md)

## Problem

Host 0.1.5-rc.1 discovers session-backed subagents through a parent-owned `subagent/catalog` event plus its `subagentCatalog` projection, but the official `SubagentRuntime.start()` appends that row only when the fulfilled run carries an in-process child (`run.localAgent?.session`, harness `packages/subagent/subagent/src/index.ts`). The local-agent family's providers (kimi, codex, claude-code, dsh) are remote runs — they create the child session and append its `subagent/descriptor` themselves, but `localAgent` is absent, so the parent session never received a catalog row and family delegations were invisible to the official discovery surface. This is batch 4 of the [host-0.1.5 adaptation proposal](../../../proposals/active/2026-09-10-host-015-adaptation.md), whose plan named the official `establishCatalogChild()` helper as the write path.

## Decision

Each provider appends the catalog row itself, immediately after the child descriptor lands, inside the existing best-effort session-record block (`start*Fresh` in each provider). The shared writer is `establishSubagentCatalogChild(parent, childHeader, label)` exported from the family core (`packages/local-agent/src/index.ts`, next to `subagentDelegationLabel`): it writes `{ version: 0, childId, childCreatedAt, mode: 'one-shot', label? }` — byte-identical to what the upstream helper produces — with the same composed harness label the descriptor carries.

The writer is inlined rather than imported because `establishCatalogChild` is unreachable on the npm release line: `@deepseek-ai/dsh-subagent@0.1.5-rc.1` exports only `.`, `./internal`, `./invariant`, `./client`, `./typert`, `./remote`, and `./src/*`, and published artifacts ship no `src/`. The event type still rides the official package's own `SessionEventMap` augmentation (the root import pulls `catalog.ts` into the type plane), so the append stays type-checked against the host's schema.

Semantics inherited from the upstream contract:

- **Once per child session.** The append lives in the fresh-round branch only; resume rounds reuse the existing child session and never re-write the row (pinned by a provider test asserting zero catalog events on the resume path).
- **Degrade, never block.** A failed append (e.g. a host whose session layer predates the event) falls into the block's existing `logger.warn` catch; the delegation itself is unaffected. This deliberately differs from the official runtime, which disposes the run on catalog failure — the runtime owns a freshly published in-process child it can roll back, while a provider-side row trails a delegation record that is already durable.
- **No double write.** Family runs never populate `SubagentRun.localAgent`, so the official runtime's own append never fires for them.

## Alternatives considered

**Import the helper via `@deepseek-ai/dsh-subagent/src/catalog.ts`.** Rejected: the `./src/*` export resolves only in a source checkout; the published npm package ships no `src/`, so every install from npm would fail at import time. This repo's vitest preset masks exactly that by aliasing platform imports onto harness sources.

**Vendor the event schema with a local module augmentation instead of consuming the official one.** Rejected: re-declaring `subagent/catalog` in our own `SessionEventMap` merge would drift from the host's payload contract silently; consuming the official augmentation makes a host-side schema change a compile error here.

**Have the family core append the row from the delegation registry.** Rejected: the registry's `recordDelegation` runs on resume rounds too and after the child exists, so the once-per-child and degrade-in-place properties would both need reconstructing; the provider's fresh-create block already has the exact parent Session, child header, and label in hand.

## Consequences

Family delegations now appear in the official 子代理 discovery surface (the `subagentCatalog` projection and everything reading it) on 0.1.5 hosts, with no host change required. The delegation stays fully functional on a host that rejects the append — the catalog row is discovery metadata, and the descriptor-based surfaces keep working. The inline writer must be re-audited whenever the upstream catalog payload version moves past 0; the upstream seam-registry entry should note that exporting `establishCatalogChild` from the package root would retire the local copy. Verified by per-provider tests (fresh round writes exactly one row with the composed label; resume writes none) plus the full workspace build and test suite against the 0.1.5-rc.1 pin.
