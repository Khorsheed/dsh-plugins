# Agent Note: a feed's summary is not the article, and a search says what it did

Status: implemented

## Problem

Two reports about the same surface, and the first one was a real defect with a long tail.

**The article never arrived.** Opening `https://transformer-circuits.pub/2026/workspace/index.html` from that site's own feed showed the title, then one paragraph — the feed's 167-character `<summary>` — and nothing else: no error, no fetch, no way to ask for more. The cause was a single promotion in the parser: `bestBody()` iterates `content:encoded`/`content` and then falls back to `description`/`summary`, so a feed that publishes only a summary produces an entry with `contentHtml` set. Everything downstream read that as "this entry has its text": the automatic backfill's candidate filter (`contentHtml === undefined`), the open-time fetch this repo added one batch earlier (same condition), and the detail view's "show the body" branch. The summary was also, for exactly that reason, never in the backfill's work list. The `detail.summaryOnly` copy had existed since the rewrite and **no component ever rendered it** — the message written for this case was dead text.

**A search did not say what it did.** Searching an exact paper title returned the paper last, under six newer posts, and nothing on screen distinguished "these all matched" from "the list was not filtered". The matcher itself was correct — measured against the live state document, `"Verbalizable Representations"` matches exactly one of 215 entries — but a result list that cannot be told apart from an unfiltered wall is a defect in its own right, and the reader's conclusion ("the search returned six other posts") was reasonable.

## Decision

**The feed's own summary is a summary, not a body.**

- `parse-rss` marks such an entry `summaryOnly: true` (a new `ReaderEntry` field), which is the honest description of what `contentHtml` holds.
- The two consumers of "does this entry still owe a fetch" now treat `summaryOnly` as missing text: the automatic backfill's candidate list includes it, and opening it fetches the article on the spot — the same `fetchBody` the card's 「抓取正文」 uses.
- The detail view renders the summary immediately (better than an empty page) with the long-dead `detail.summaryOnly` sentence above it, and that sentence disappears when the fetched article replaces the summary — the condition is a comparison with the feed's own text, so no extra state is stored.
- A failed fetch no longer blanks the body: `fetchBody` keeps what is on screen (the summary, or a previously fetched article) and adds the reason beside it. Taking the reader's only text away because a second request failed was the previous behaviour.

**A text search ranks by relevance and reports its count.**

- Rows are ordered by how directly the title answers the query (exact title, then title contains, then a match anywhere else), and the chosen sort decides *inside* each tier. `#sourceId` / `@tagId` selectors are not ranked — they match every row the same way.
- The footer shows `匹配「X」N 条` / `N matching "X"` whenever a query is active, so a narrowed wall is never mistaken for the whole wall.

**The field owns its row.** The wall's filter, sort and translation controls moved into the pane's header row (with refresh, settings and add), leaving the search field alone on its row at full width. The reported shape — a field squeezed between three buttons on a narrow sidebar — hides what the reader is typing. Each popover still hangs off its own button's wrapper. The clear button also stopped being a text `×`: it is now the toolbar's own stroke glyph at the toolbar's 15px inside a 22px box, so it reads as a control rather than punctuation.

## Alternatives considered

**Infer "the body is only a summary" from its length** (e.g. under 320 characters). Rejected: heuristics on length misclassify short real posts and long summaries, and the parser already knows exactly which element supplied the text. The flag is that knowledge, carried forward.

**Tell the two apart by re-reading the feed on demand.** Rejected: the parse happens once per load in the browser half; the host never parses, and making the host re-parse to answer "is this a summary" would move parsing across the boundary this package deliberately keeps in the browser.

**Drop the description fallback entirely** (no `contentHtml` unless a real content element exists). Rejected: it would empty the detail view for every feed that publishes body text in `<description>`, which is a large share of real feeds. The fallback is right; it just has to be labelled.

**Rank by a score instead of tiers** (field weights, term frequency). Rejected as unmeasurable here and invisible to the reader: three tiers express the only distinction the reader has ("does the title say it?"), and a hidden score would be harder to explain than to compute.

**Show the match count only when zero results.** Rejected: the report was about a *non-empty* list looking unfiltered, which is precisely the case a zero-only message does not cover.

**Put the search field last and the buttons first.** Rejected: the field is what the reader came to use; it keeps the leading position and the full width, and the controls move out of its way instead.

## Consequences

- Entries from summary-only feeds now pay one fetch when opened and up to eight per wall load from the backfill. That is the intended cost of showing the article instead of a teaser; the backfill's existing 6-hour failure backoff and two-request concurrency bound it, and the host records a failure so a page that will not parse is not retried in a loop.
- `ReaderEntry.summaryOnly` is session state (parsed in the browser half, never persisted), so it needs no state-document migration; a feed that later starts publishing full text simply stops producing it.
- The relevance tiers change what "Newest first" means while a search is active: within a tier the chosen order still holds, but the tiers come first. A reader who wants pure chronology can clear the search.
- The wall's toolbar is now two rows again (header with controls, row with the field) rather than one; the field gained width, and the header carries four controls where it carried three. On a very narrow sidebar the header's title truncates before any control does.
- The `detail.summaryOnly` copy is finally reachable, and its wording ("the full text lives on the original page") now sits above a body that is being fetched rather than replacing the article.

## Testing

`packages/dsh-reader` runs 208 tests (7 new):

- `parse-rss.spec.ts`: a feed whose only text is a `<description>` is `summaryOnly`; a feed with `<content:encoded>` is not.
- `selectors.spec.ts`: a title match ranks above a newer summary match; a `#sourceId` selector is unranked.
- `ReaderPane.client.spec.tsx`: opening a summary-only entry shows the summary, shows `detail.summaryOnly`, fetches the article once, and drops the notice when the text arrives; a summary-only entry is offered to the automatic backfill; the wall's field has a row of its own (no buttons in it) while the header carries the filter and sort wrappers; the filter panel still anchors inside its own wrapper.
- The test bench's `feed()` fixture now publishes `content:encoded`, because it is the fixture for "a feed that publishes its text" — the summary-only case has its own fixture, which is what changed several specs' expectations.
