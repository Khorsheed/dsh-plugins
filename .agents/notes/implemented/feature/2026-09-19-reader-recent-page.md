# Agent Note: a recent-reading page of the reader's own

Status: implemented

## Problem

The reader asked for a 最近阅读 page, with the design settled up front: a clock in the header, its own page, persisted, capped at 100 entries, clearable.

The tension with the work that landed just before it is the point of this note. The pane now keeps "where the reader was" in **session memory** (the open article, the reading position, the translation) and deliberately persists nothing. A recent-reading list is the opposite kind of state: "what was I just reading" is a fact about the reader's own behaviour, and a list that starts empty after every reload or restart is not a record of anything. It is also safe to persist in a way the translation is not — a title and a URL the reader already asked for, and no third-party text.

Building it exposed a second problem: the detail view resolved its entry from the wall's parse **only** (`allEntries.find`). A feed's window rolls over, so a "recent" row pointing at an entry the feed no longer publishes would have opened nothing at all — the one case the list exists for.

## Decision

- **`state.json` gains `recent`**: `{ entryId, sourceId, title, url?, readAt }[]`, newest first, one row per entry, capped at `MAX_RECENT_ENTRIES` (100). The normalizer drops anything that cannot be reopened (either id missing) or ordered (no timestamp), collapses duplicates, and truncates — the file is user-editable state, like every other table in it.
- **Three verbs on the host half**: `recordRead` (reopening moves an entry to the top instead of duplicating it, then truncates), `listRecent`, `clearRecent`. `recordRead` is deliberately not batched: opening is a human-paced gesture, and a queue that had not flushed would lose the item on a restart.
- **Written on the gesture that opens the article** — the same `open()` the card, the restore path and the page itself call, so "opening counts as reading" is one rule and a reopen from the page moves the entry to the top for free. The write is fire-and-forget, and the pane also mirrors it into its own store so the page is right the first time it is opened in a session; the page re-reads the host's copy on mount and whenever it is shown.
- **A row stores no body and no summary.** The article cache and its TTL already own that (`annotations`), and a second store of text would be a second cache with a second expiry policy.
- **`entryById`: the wall's parse first, the stored record second.** That is what lets the page reopen an article the feed has rolled out of its window — and the restore-open path uses the same helper, so such an entry also survives a panel switch. A row whose SOURCE is gone renders disabled with the reason (there is nothing left to open it through).
- **The page is a list, not a grid**: title (one line, ellipsised), source, "how long ago", the whole row a button. It keeps the subscription row's metric so the two pages read as one plugin.
- **Clearing is a single click, no confirm.** Nothing in the list is the reader's only copy of anything, and a modal on the one action this page owns would make the page feel like a hazard.

## Alternatives considered

**Keep it in the pane's session memory, like the reading position.** Rejected: that is "where I was a second ago", and the reader's own request was a page that survives. It would also fight the session snapshot's whole premise (a reload is a fresh visit).
**Store the extracted body or summary alongside.** Rejected: `annotations` already holds bodies under the cache policy, and a recent list that quietly became a second cache would double the storage for the same articles.
**One row per SOURCE rather than per entry.** Rejected: an RSS entry has no source-level page to reopen, and "the article I read" is the unit the reader remembers.
**Cap by age (30 days) instead of by count.** Rejected: the count is what bounds the file (`state.json` stays small) and 100 items is already far more than "what was I just reading" needs.
**A badge with the count on the clock.** Rejected: it would fight the unread count already in the header and would be wrong the moment an entry is opened (the pane does not re-read the list on every write).

## Consequences

- `state.json` grows by at most 100 small rows (a few KB) and is written once per open. No body text is stored, so the growth is bounded by reads, not by article size.
- The detail view's entry lookup is no longer "the wall's parse only". That is a real widening: an entry can now render from a record that has only four fields, so the detail view's own warnings (`summaryOnly`, the script-figures note, the truncated copy) simply do not apply to such a row — there is no body to warn about until the fetch answers.
- The page costs one extra local RPC per pane mount, because the fallback has to be available before the detail view needs it.
- A deleted source leaves its recent rows in place (they are the reader's record), listed but unopenable. Deleting the rows with the source would silently rewrite history; the row says why instead.
- The cap lives in the host store (`MAX_RECENT_ENTRIES`) and is applied again on read, so a hand-edited file cannot grow the page without bound. The pane's optimistic mirror does not cap (it never imports the host store — that module pulls `node:fs`), which is harmless: the page re-reads the host's capped copy whenever it is opened.

## Testing

`packages/dsh-reader` runs 254 tests (14 new):

- `tests/annotations.spec.ts` (+4): records that cannot be reopened or ordered are dropped, a missing URL is legal, duplicates collapse keeping the file's order, the 100-row cap truncates from the oldest end, and the list round-trips through the disk document.
- `tests/boot.spec.ts` (+4): newest open first, a reopen moves the entry to the top with the new title, an unopenable record is refused, the cap drops the oldest read, and the list survives a second host on the same state root while `clearRecent` is durable too.
- `tests/ReaderPane.client.spec.tsx` (+6): every open records the entry with its source and URL; the page lists what the host holds and a click reopens it; an entry the feed no longer publishes is rebuilt from the record and opens; a row whose source is gone is disabled and says why; clearing empties the list and keeps the empty state; with nothing read there is nothing to clear.
