# Agent Note: a saved link's card learns the paper's own title

Status: implemented

## Problem

Reported from 3080 acceptance: a pasted link (an arXiv paper, say) sits on the wall as a card whose title is the URL-derived label (`arxiv.org/2604.03147`) **forever** — even after the body was fetched and read. The reader's words: 「能从卡片就看出来内容，如果很多论文不用一篇篇点」. The pane extracted the page at load either way (the detail view needs the body); it just never used what the extraction knew, and nothing was persisted past the payload's lifetime.

## Decision

The extraction now captures the article's identity, and the card prefers it — in session immediately, and persisted past eviction:

- **`extractArticle` returns `title` and `excerpt`** alongside the body: the body's own first `<h1>` (the post's name on every measured shape), else the document `<title>` (read BEFORE the noise strip — `<title>` is in `DROP_TAGS`, so `doc.title` dies with it), capped at 200 chars; the excerpt is the first paragraph substantial enough to pass the scorer's own per-script prose bar, truncated to the card's 280-char measure.
- **The annotation carries them** (`ReaderEntryAnnotation.title`/`excerpt`, capped 300/1000 on write and on read): `storeEntryBody` takes them with the body — supplied beats stored, stored beats absent, so a re-store without meta keeps the captured values. They are load-bearing past the body: the normalizer, the body-budget eviction and the tag-cleanup sweep all keep a meta-only annotation. `getBodies` joins them onto a LINK source's payload answer (a feed source never joins — its entries' titles are the publisher's), which is the wall's existing read path, so no new verb exists.
- **The pane upgrades the card at synthesis** (`load()`): fresh extraction beats stored meta beats the URL label, in both branches (payload present / evicted). `noteExtractedMeta(entryId, meta)` is the one write path into the parsed wall: it patches the entry's `title`/`summary` and **refuses feed entries** (a feed title is the publisher's own; the owed-fetch on open runs the same extraction for feed entries and must not replace it). It fires on the two in-session extraction moments — `fetchBody` success (open / card pill / refetch) and `sweepRaw` — and `persistFeedBody` carries the meta for a link row whose title was actually upgraded (`title !== sourceLabel`), which is how an open-with-contentHtml persists the upgrade without a fetch.
- **The detail view and the recent list inherit the upgrade for free**: both read the parsed entry's title, and `recordRead` writes the upgraded one.

## Alternatives considered

**A source-level field instead of the annotation.** The link source IS its single entry, so `ReaderSource` could carry the meta and `listSources` would serve it without a join. Rejected on ownership: the annotation table is where per-entry content already lives (body, tags, translation), and the failure/title/excerpt facts all answer "what is this entry" — splitting them across two tables is two truths.
**A dedicated `noteEntryMeta` verb, written at load.** Rejected as surplus wire: every persistence path that matters already stores a body (`fetchEntryBody`, `sweepRaw`, `persistFeedBody` on open). The one gap this leaves is narrow and honest: a link that was never opened nor fetched keeps its URL label after its payload is evicted — nothing was ever extracted to remember.
**Patch the card from the fetch-state poll.** `entryFetchStates` is the wall's other per-entry channel, but it is the STATE mirror (the five-state pill); putting content fields on it mixes the two derivations the [fetch-state note](../bug-fix/2026-09-20-reader-fetch-state-propagation.md) separated. The payload channel (`getBodies`) is where the wall already reads entry content from.
**Upgrade the source LABEL too.** Rejected: the label is the reader's name for the source (editable in subscription management); the card title is the article's name. They coincide only on links, and conflating them makes a reader's rename un-stick.

## Consequences

- Paste an arXiv link and the card names the paper and shows its abstract from the first load; the identity survives restarts, payload eviction (via the annotation), and the feed window.
- The translation surface is untouched: the wall translation reads `entry.title`/`entry.summary`, which now hold the real text.
- The stored meta is a string pair per link — no budget impact worth a policy.
- Known narrow gap (accepted, above): never-opened, never-fetched links whose payloads are evicted fall back to the URL label.

## Testing

`packages/dsh-reader` (+13; the pane's three upgrade cases were additionally verified red by stashing the client diff — they fail without it, while the feed-guard case passes both ways by design):

- `tests/extract-article.spec.ts` (+4): h1 beats document title, document-title fallback (read pre-strip), excerpt truncation at 280, absence reported as absent.
- `tests/host-pure.spec.ts` (+2): the normalizer carries/caps/trims the meta and never sweeps a meta-only annotation; body-budget eviction keeps the meta.
- `tests/boot.spec.ts` (+3): stored meta rides `getBodies` for the link source (payload present and gone), a meta-less re-store keeps it, a feed source never joins it.
- `tests/ReaderPane.client.spec.tsx` (+4): card upgraded at load (title + abstract on screen), captured meta read when the payload is gone, a pill fetch flips the card in place, and a feed entry's own title is never rewritten.
