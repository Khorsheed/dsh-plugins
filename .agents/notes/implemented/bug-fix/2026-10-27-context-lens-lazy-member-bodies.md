# Agent Note: member request bodies are rebuilt on read

Status: implemented

## Problem

In room 2e44ba43 (10-27), the panel showed main turn 1 as "not loaded", no requests on the map, and a round stuck on "加载中". The child-log lane materialized every member request with its whole copied context, with no window. The room's two members (a kimi member's contexts run 100–400k chars) held 391 requests and 139M chars, 93% of the store's 150M global budget. Reading any other session pushed the total over, and the eviction, least recently read first, emptied the room's own member holder turn and its main turn. A fresh process listed the room in 7.2 s, almost all of it spent materializing.

## Decision

- Member child logs are folded **bodiless**. The child cursor's materialize predicate is always false, so each request keeps its structure, usage, timing, response and executions but no copied context. An external agent's own session (log-driven) is backfilled the same way.
- Every log-lane request records `logIndex`, its position among the log's requests. Bodiless ones are flagged.
- On `getRequest`, the service rebuilds the body: one fold of the request's log with only the read request and its scope predecessor (the prefix comparison's baseline) materialized. It hydrates them into the store. The last 8 rebuilt bodies stay; older ones are dehydrated again.

## Alternatives considered

- **A per-room window over member requests.** Thirty rounds of a kimi member still run to tens of millions of chars.
- **Raise the budget.** It moves the cliff without removing it, and the heap is the real limit.

## Consequences

- On real data, room 2e44 held 1.06M chars after listing instead of 140M. The list took 56 ms instead of 7.2 s, and a member request read took 44 ms with its full history and prefix comparison.
- A member request's list-level `totalChars` (context size) is 0 until read. The list and map use usage tokens, so they are unchanged.

## Testing

`context-lens` (228). A child-log spec asserts that listing keeps the store free of copied context, that a read rebuilds the body, and that a dehydrated body reads identically. The existing child-log specs, which read each request's segments, pass unchanged against the rebuilt bodies.
