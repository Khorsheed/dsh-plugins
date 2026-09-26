# Agent Note: Mobile cold catalog reads

Status: implemented

## Problem

Mobile rendered the Session catalog's displayTitle directly. The 0.1.7 host may serve a cold row without its title projection; the directory basename is then a display fallback, not the saved conversation title. Opening the conversation supplies the projection, explaining why selected rows can look correct while unopened rows show the directory. Mobile also calls Room getState for member counts; Room's cold path inspects persisted events, so simultaneous visible-row reads can compete with conversation history loading.

## Decision

Visible mobile rows missing a nonblank title explicitly call the official sessions.refreshProjections API. The official store continues to own titles, deduplication and connection-generation caching; mobile never opens/retains a conversation merely to fetch its label. The API is optional for older hosts. Failure retains the official fallback and re-entry can retry.

A library-scoped scheduler bounds enrichment to two in-flight reads. Queued title reads precede optional Room member reads. Intersection observation is rooted in the scrolling list; leaving the viewport, collapsing a group, hiding the library or unmounting cancels queued work. Existing owner APIs do not accept a cancellation signal: already started reads finish and keep their concurrency slot. Room state and mutations remain with their existing owner.

## Alternatives considered

Opening every conversation to obtain titles would load histories and create unnecessary ownership. An independent title cache would diverge after rename or reconnect. An unbounded projection request per row would trade missing labels for additional cold-log pressure. Modifying host source is unnecessary because a public explicit-read API exists.

## Consequences

Regression tests cover a cold directory fallback becoming the saved title without opening a Session, hidden-list suppression, visible-read bounds, cancellation, failure recovery and title priority. Package build and tests verify against the installed 0.1.7 baseline. These tests do not measure real iPhone or tunnel latency; total loading time still includes transport, bundle loading and host history reads. No production restart is part of this code change.
