# Agent Note: the narrowing's unmount flush

Status: implemented

## Problem

Live repro on 3199 (build 443f149d): the reader set a source filter (query `#rss-…`, wall correctly filtered), then hit the dockkit split button — which reseats the pane body — and later added a feed through the add dialog. When it all settled, the search box was EMPTY and the wall unfiltered.

The narrowing (view / query / sort / unreadOnly / read cursor, plus the wall's translation switch and card texts) lives in the per-mount store and crosses remounts through the page-level session memory: a passive `useEffect` mirrors it on every change, and the next mount hydrates from that record. The [state-boundaries note](../architecture/2026-09-19-reader-state-boundaries.md) established the pattern. What it did not survive: the mirror is a PASSIVE effect — it flushes after the commit, and a pane reseated in the same commit window as the reader's last gesture can be unmounted before the pending flush runs. Every missed flush is the previous narrowing coming back on the next mount; the add-flow cascade (refresh → reload → re-parse) right after the split is exactly the kind of commit traffic that widens the window.

The reading position never had this problem because it writes AT the gesture (`rememberReadingPosition` is called from the scroll handler). The narrowing went through the effect — two write timings for the same memory, and the effect-timed one is the one that can lose.

## Decision

Keep the effect mirror (it is still the per-change path), and add the guarantee that has no timing: an **unmount flush**. A ref carries the last COMMITTED narrowing — assigned during render, so it is fresh at every commit, not at some effect's leisure — and an unmount cleanup, which always runs, writes it into the session memory. The cleanup carries the mirror's own guard (`hydrateStartedRef`): a pane that never got past its pre-hydration render must not overwrite the record with the store's defaults, the same reason the mirror skips its first run.

The flush writes through the same `patchSession`, so the `sessionStorage` place layer (view / open entry) is persisted in the same call, as before.

## Alternatives considered

**Write-through in the store actions (setQuery and friends patch the session synchronously).** The strongest timing, but the mirror also covers the three useState fields (the wall's translation switch and its card texts), and the store's actions are deliberately pure — two write mechanisms for one memory is how the last bug happened. The cleanup covers store and useState fields alike from one ref.
**Hydrate earlier (during first render instead of the first effect).** The loss was on the WRITE side, not the read side; hydrating earlier changes nothing about a write that never landed.
**Do nothing — the sequence is rare.** The wall's narrowing is the pane's everyday state, and a split is a first-class host gesture now; "usually flushes in time" is not a persistence contract.

## Consequences

- A remount can no longer come back to an older narrowing than the one the reader last saw committed, whatever the effect scheduler did.
- The mirror keeps its shape (one write per change, guarded first run); the flush is idempotent with it.
- The regression is pinned at three levels: the plain remount with a source filter, the exact 3199 sequence (filter → remount → add feed → close), and the missed-mirror case itself (snapshot wiped between mounts; only the cleanup can bring the narrowing back) — plus detail view and query travelling together.

## Testing

`packages/dsh-reader` (+3): `tests/ReaderPane.client.spec.tsx` — a source-filter narrowing (`#hn`, two feeds so the rows prove it) survives a plain remount; survives the remount + add-source + dialog-close sequence; survives the mirror never having written (the unmount cleanup is the only writer); and survives together with the open detail view. The missed-mirror case was red before the fix; the sequence cases pass both ways and stay as guards.
