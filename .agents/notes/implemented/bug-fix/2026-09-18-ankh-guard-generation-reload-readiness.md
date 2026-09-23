# Agent Note: A boot-generation reload waits for the successor's composition

Status: implemented

English | [中文](2026-09-18-ankh-guard-generation-reload-readiness.zh.md)

## Problem

The boot-generation channel answers `ready/reload` on any stale boot id while no cutover is active, and it is reached as soon as the shared `webServer` service exists — which is when the listener binds. The watchdog's own log states the distinction the channel ignored: `transport up on :3080 (HTTP 404); application readiness still pending` precedes `instance ready` by seconds.

A tab reloaded into that window boots a page whose first — and only — session-list pull races the successor's mounting rows. On prod 3080 the result was: after an ankh-guard restart the left session list held only the session the restart had recalled, and a manual page reload restored the full list.

The client side of that failure is upstream harness behavior, and it was not changed here:

- `session-controller`'s refresh treats a successful list response as authoritative membership (`mergeOrderedBaseline` removes identities absent from the baseline), and it re-pulls only on `connection/reset` — never on a retry timer.
- A freshly reloaded page has no established rows to fall back on, so a failed or empty first pull leaves the store empty; the only rows that appear later are the ones the host announces live (`api-session/added`), i.e. after a restart exactly the recalled/restored session.
- The harness gates its own browser handoff on Loader settlement for the same reason (`packages/bundle/web-app/src/index.ts`: a browser "requests the page as soon as it opens", so it "may not run while sibling rows such as the `/api` route owner are still mounting").

This is a regression of the automatic reload, not of the host. The previously deployed ankh-guard (0.1.0/0.1.1/0.1.2 tarballs) had no browser half at all — no `lib/client.js`, no `dsh.client` — so an ordinary restart only reconnected the WebSocket, and a failed re-pull on a resident page kept the rows it already had. The channel shipped in 0.3.0 (`0f776cc3`, released 2026-09-11, first deployed 2026-09-15).

## Decision

**The generation answer waits for the successor's Loader tree to settle.** `applicationReadyProbe` in `packages/ankh-guard/src/browser-handoff.ts` reads `ctx.get('loader')?.await()` when the route is registered and flips ready only on fulfillment; a composition without a Loader is already complete, and a failed tree stays not-ready because the watchdog's crash recovery — not a page load — owns that outcome.

**The held answer is `{ state: 'waiting' }` without the boot id.** The client stores a boot id before acting on the state, so teaching the successor's id here would consume the tab's one-shot generation check and strand it on the unusable page. Omitting the id keeps the stored id stale, the client re-asks every 250 ms under its existing restart overlay, and the first poll after settlement reloads.

Cutover precedence is unchanged: the receipt channel is still evaluated first and still owns the pacing when a cutover is active.

## Consequences

- Restart recovery is delayed by the successor's remaining mount time — seconds — during which the tab shows the existing restarting overlay. Nothing is lost: the poll loop already retries at 250 ms.
- Wire semantics are unchanged for old clients: `{ state: 'waiting' }` without `cutoverId` retries and never reloads.
- The tab now also survives a successor whose tree fails: it holds instead of loading a dying process, and the next healthy process (new boot id) triggers the reload.

## Alternatives considered

**Hold the poll open until ready with the existing long-poll machinery.** Rejected: the held-response path falls through into the pre-generation/idle branch, which answers *with* the boot id; a hold that outlives the 25 s window lands in exactly that branch and consumes the generation check.

**Treat a rejected Loader settlement as ready.** Rejected: app-boot treats a pending entry as a fatal boot, so "settled with failure" means the process is exiting — reloading into it trades a truncated list for a broken page, and the watchdog's respawn answers the still-stale poll anyway.

**Cap the hold with a timeout so the overlay cannot stick.** Rejected: the stuck-overlay case is an unhealthy instance (the same fatal-pending condition), and a timeout would reintroduce the premature reload exactly when the tree is slow.

**Fix it in the client by retrying the list pull.** The client belongs to the upstream harness, and the invariant it states — a browser may enter once the tree has settled — is what the guard was violating. Guarding the reload restores that invariant for every plugin-driven reload, not just the session list.

## Testing

Two cases pin the halves of the handshake:

- `packages/ankh-guard/tests/browser-handoff.spec.ts` — a stale id with `applicationReady: () => false` is answered `{ state: 'waiting' }` with no boot id; the same stale poll then reloads once the probe flips, still carrying the successor's id on the ready response.
- `packages/ankh-guard/tests/browser-handoff.client.spec.ts` — the shipped client accepts the held response, reloads nothing, re-asks with the *same* stale `knownBootId`, and reloads on the later ready answer.

The lane inventory in `scripts/run-test-lane.mjs` moved with them (`pure`: 57 → 59).

Not covered by tests: the reason the session list emptied, which lives in the harness client (authoritative baseline + no re-pull). It was observed on the instance and is cited above from the harness sources; only the guard-side trigger is asserted here.
