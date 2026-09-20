# Agent Note: the fetch-state mirror follows the write paths

Status: implemented

## Problem

Reported with a screenshot: a card on the reader wall shows 「抓取」; the reader opens the article, the detail view fetches and shows the body; back on the wall the card still says 「抓取」 instead of 「已抓取」 — until the next mount.

The host's per-entry annotation is the only authority on what the plugin holds (a cached body, an in-flight or stored-raw fetch record, a classified failure with its message and code), and the pane mirrors it in its engine store (`fetchStates`). But the mirror was fed by exactly three writers — the mount/rev full-wall poll, the 2-second poll that runs only while something is in flight, and `startFetch`'s cleanup — while the two paths that actually change host state most often wrote nothing back: `open()`'s owed-fetch (through `fetchBody`) and the automatic backfill. The card pill reads the mirror, so it answered with whatever the last poll happened to know.

Two adjacent defects rode along: `noteBackfilled` never cleared `staleBodies`, so an "expired" marker would outlive the fresh body that replaced it; and `staleBodies` had no path that ever set it at all (`open()` learned `cached && !fresh` from `getEntryBody`'s answer but dropped it), making the expired state unreached rather than merely uncleared. A failed fetch also CLEARED the marker in `fetchBody`, though the failed fetch left the host's stale copy exactly as it was.

## Decision

The fix is propagation, not a new state model — the five-state pill (none / fetching / raw / ready / failed) and the host's derivation stay exactly as they were:

- **One read path into the mirror**: `fetchStateOf(states, entryId)` in `client/selectors.ts` owns the lookup including the `none` default. The card pill and `sweepRaw` go through it; the failed variant carries `message` and `code` through untouched, which is what the ingest proposal's M0 reason taxonomy will consume.
- **Write paths re-read the one entry they touched.** `syncFetchState(entryId)` is a targeted `entryFetchStates([id])` into the mirror. `fetchBody` calls it in `finally` — which covers all three of its callers (open's owed-fetch, the card pill, the detail view's 重新抓取） — and `startFetch` drops its now-redundant full-wall poll. The mirror never holds a client-computed state: the classification of a failure lives host-side, and a second derivation on the client would be the same bug again one layer down.
- **`open()` learns two things from `getEntryBody`'s answer it used to drop**: whether the host's cached copy is past its deadline (`cached && !fresh` → `staleBodies`, written before the screen guard — a per-entry host fact, true no matter which entry is on screen by then), and whether the mirror disagrees with the answer (host holds a body the mirror calls `none`, or a recorded failure the mirror hasn't seen) — in which case it re-reads that one entry. A mirror that already agrees costs zero extra calls.
- **The backfill re-reads once per run** (`refreshFetchStates` after the workers drain), not once per entry — a run is bounded at eight.
- **`noteBackfilled` clears the entry's stale marker when a body landed** and keeps it when the fetch failed; `fetchBody`'s failure branch no longer clears it either. The marker's rule is now symmetric: it describes the host's copy, and only a landed body ends it.

## Alternatives considered

**A full-wall poll after every gesture that could change a state.** The same answer at N times the cost, per fetch; the targeted re-read is the poll the gesture actually needs.
**Write client-computed states into the mirror on success/failure.** The success half is easy (`ready`), but the failure half would duplicate the host's classification (`recordFetchFailure` stores the message AND the code); two derivations of one state is how this bug happened.
**A push channel from host to pane.** The Remote contract has no events; the in-flight poll already exists for the multi-second cases, and a settled fetch is exactly where a targeted read is cheap and final.
**Sweep orphaned raw payloads in this fix.** Deferred: a `fetch:{state:'raw'}` record whose entry rolled out of the feed window is never consumed (`sweepRaw` walks only on-wall entries) and never evicted (`pruneBodies` keeps referenced raw files forever). A client-side sweep would have to poll states for entries the wall no longer shows, and aging out a raw file needs a policy call — the raw payload IS the fetch's resumability. The right owner is the ingest proposal's resumable-fetch design, where the raw lifecycle is being re-cut.

## Consequences

- The card flips on the same gesture that changed the host's state: open-triggered fetch, card-pill fetch, detail refetch, and the automatic backfill all land in the mirror immediately.
- The mirror carries the failure's `message` and `code` everywhere, so M0's reason UI reads the same record the pill already shows.
- `staleBodies` is now a real map: written when the host reports an expired copy, cleared when a fresh body lands (open's fetch, or a backfill fill). Still no UI reads it — the 已过期 surface is M0's, and this fix deliberately builds none of it.
- `open()`'s useCallback now depends on `fetchStates`: a poll recreates it, and the restore effect re-runs and no-ops behind its guards. No per-scroll or per-render work was added; the new calls are per-gesture and per-run.

## Testing

`packages/dsh-reader` runs 290 tests (+8; six of them red against the pre-fix code, two both-sides-green guards):

- `tests/ReaderPane.client.spec.tsx` (+3): opening from the card and fetching flips the pill to 已抓取； the automatic backfill flips it; a failed open-triggered fetch flips it to 抓取失败 with the host's classified reason in the title. All three drive the mocks as a model host document (`entryFetchStates` answers whatever the writes made true), so they cannot pass without real propagation.
- `tests/store.spec.ts` (new, 3): the expired marker's set/clear, cleared by a landed backfill, kept through a failed one.
- `tests/selectors.spec.ts` (+2): `fetchStateOf` defaults to `none`, and hands the failed record through with its reason and code.
