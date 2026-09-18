# Agent Note: the reader translates in the browser — on-device, sentence-aligned, three views

Status: implemented

## Problem

The wall collects English research feeds (measured on the acceptance instance: the OpenAI alignment feed's 48 items and the Anthropic research feed's 43, 886,000 characters of article text between them, with full-text posts running 22,000–105,000 characters). The detail view renders those bodies as DOM text and the reader has no way to read them in Chinese without leaving the pane — copying into a translator or a chat, which is exactly the surface this package exists to replace.

The two routes that suggest themselves are both wrong for the first version:

- **A host model call.** The sanctioned one-shot seam is `ctx.llm.stream({ provider, model, messages, system })` (used by `local-agent-dsh` for the model vocabulary), with the instance's default model read from `ctx.get('agentDefaultModel').currentSelection()`. It works, and it is the eventual "better quality" tier — but for one 22,000–105,000-character article it costs tens of thousands of tokens per article, takes tens of seconds, and sends a second copy of the article to a model provider. For a reader whose default act is "scan the wall, open the interesting one", that is a lot of cost and latency for a first look.
- **Paragraph- or node-level browser translation.** The browser has offered an on-device Translator API since Chrome 138 (expert models, no network after the pack, no per-use cost), but the obvious implementations fail the request the reader actually makes: "what does this ONE sentence say in the original?" A paragraph-level unit cannot answer it afterwards — the model merges and splits sentences, so re-aligning the two sides later is a guess, and a wrong guess shows the wrong original. A text-node-level unit cannot answer it either, because a paragraph without inline markup is a single node.

## Decision

The feature lives entirely in the **browser half**. A globe in the detail bar is a switch (lit = this body is showing a translation), its caret opens the view menu (translation only / side by side / original only), and the article is translated by the page's own `Translator` API. There is no Remote verb, no host change, no `state.json` field and no new dependency; `detectTranslator()` is the entire degradation story.

- **The unit is a sentence.** The rendered article is segmented BEFORE any request: each prose text node is cut into sentence pieces and each piece becomes a span. The pairing between a translated sentence and its original is therefore true by construction, not recovered afterwards. The click gesture the reader asked for — click one sentence, see that one sentence's original under its paragraph, click again to hide it — falls out of the data model instead of being a special case.
- **Only text nodes are ever touched.** No markup round-trip, so a link inside a sentence stays a link with its href intact, and `<pre>`/`<code>` content is skipped outright. A sentence that CROSSES an inline element becomes two units (the text on each side) — what Chrome's own page translation does — and each side still reveals exactly its own original. Because the originals stay in memory, "original only" and cancel restore the exact bytes the host sent.
- **Batches are verified, and the fallback gives up granularity rather than correctness.** Whole sentences go out as one string with a sentinel between them; the answer is accepted only when it comes back with the same number of parts. A mangled separator (or a failed call) re-sends that batch one unit per request, which cannot be mis-aligned. A unit that still fails keeps its original text — never a hole in the body.
- **Three views, and the globe is a switch.** *Translation only* is the default (the sentence click is the discovery path, taught once by a dismissable line); *side by side* shows every paragraph's original underneath it and can fold per paragraph; *original only* shows the source text while keeping the translation ready, so flipping back costs nothing. The globe is lit only while a translation view is showing, which is why the menu's tick and the globe never disagree. The two sides of a pair are lit together — the opened sentence keeps an accent underline and its original line gets the active surface — and the original line is itself a toggle, so the gesture reads the same from either side.
- **Hidden unless it can work.** The globe is rendered only when the page has the API, the browser reports the pair as available, and the body is not already the target language (`isCjk` decides that from the article's own script). Chrome/Edge desktop only — Safari, Firefox and mobile simply have no globe, and nothing else changes.
- **`availability()` is a hint, not a promise, and the failure says so.** On the acceptance instance a pair answered `available` and then rejected `create()` with `NotSupportedError` — "Unable to create translator for the given source and target language" — an error that names neither language (Chromium has the same failure recorded for macOS builds). Three things follow, all shipped: the source language is asked of the browser's `LanguageDetector` first (a wrong source is one way a pair cannot be built, and `isCjk` cannot tell German from English); the target is really tried in every accepted spelling, `zh` then `zh-Hans`; and when every attempt is rejected as unsupported the globe HIDES itself while the status line names the pairs it tried and points at `chrome://on-device-internals` ("Broker State"). A download or quota failure is NOT permanent: the globe stays, and the message carries the attempted pairs plus the browser's own reason.
- **Working states are honest.** A first use downloads a language pack: the reader sees the download progress and can cancel. A failed `create()` shows the reason and leaves the article untouched (no segmentation, no half-translated page). A run in which every batch failed says so and offers the retry in the menu.
- **Chinese only, for now.** The target language is a parameter everywhere (the session request, the availability probe, the copy) and the menu is a constant; a language picker is a menu change, not a rewrite.

## How a translation is applied

1. `buildArticle(root, classes)` walks the article's text nodes, skips code/pre and anything that is not prose, splits each run into sentences, and replaces the run with spans (keeping the leading/trailing whitespace in place so the join is exact). It is idempotent and records what it needs to undo itself.
2. `runTranslation(...)` paints remembered sentences immediately and sends the rest in batches of whole sentences (`⟦|⟧` between them, ~1,200 characters or 12 units per batch). Each accepted part is written back into its span; a rejected batch degrades to one request per unit.
3. `setView(...)` paints the spans and the reveals for the chosen view and marks the container `data-reader-translated`, which is also what switches the typography to the CJK metrics — but only once at least one unit actually arrived (the marker reads `pending` until then, so English text is never styled as Chinese).
4. Clicking a span toggles that segment's `open` flag and re-paints its block's reveal container. The reveal shows the block's ORIGINAL SENTENCES, not its units: a sentence cut into three units by an inline link is still one line, and the reader reported the unit-per-line version as sparse fragments ("Frontier Red Team" / "has developed some…"). To do that the block keeps a flattened copy of its original prose — including the whitespace that belongs to the runs BETWEEN units, which lives in the text node rather than in any span, and whose absence the test caught as "See thebest-studied domains". A line is highlighted when the sentence it belongs to is open, and clicking it collapses that sentence. The reveal goes after the block for paragraphs and headings, inside it for list items and quotes, and right after the last sentence when the body is bare text (which `extract-article` really does emit — that shape was found by the render test, not by reading the code).
5. `restoreArticle(root)` puts every original text node back byte for byte and removes the spans and reveals. It runs on cancel, on a new body, and on unmount.

## Verification

`packages/dsh-reader/tests/translate.client.spec.ts` pins the module: sentence splitting (abbreviations, initials, decimals, "U.S.", CJK terminators, no terminator at all), segmentation and byte-exact restore, the bare-text body shape, idempotency, link and code survival, view switching, the click toggle, one-request batching, the sentinel-mismatch fallback (one batch then one request per unit), a failing unit being counted instead of losing the article, remembered sentences costing no request, and cancelling between batches.

`ReaderPane.client.spec.tsx` pins the flow with a scripted `globalThis.Translator`: the globe translates in place, a click reveals exactly one sentence's original and a second click hides it, the menu switches to original-only and back, the globe is absent without the API / with an unavailable pair / on a Chinese body, a failed `create()` shows the reason while the body keeps its original bytes, and a mangled separator still yields per-sentence translations.

The reveal's own typography is pinned too (12.5px, the secondary ink, 3px between lines): the first version was 11.5px in the tertiary ink with 5px gaps, and the reader reported the English as small and sparse.

The same two files also pin the session-creation chain: the next target spelling is tried when a pair is rejected, the detected source is tried before the fallback, a `NotSupportedError` on every pair is reported as permanent with the attempted pairs, a network failure is not, an already-`unavailable` pair is skipped, the language probe prefers a confident detection and otherwise falls back, and the pane hides the globe after an unsupported failure while a mere pack failure keeps it.

`pnpm --filter @khorsheed/dsh-reader test`: 164 passed, 9 files. The bundle was rebuilt (tsc + tsdown) with the new module and CSS present in `lib/client.js`.

## Alternatives considered

**The host model seam (`ctx.llm.stream`) as the first implementation.** Rejected for this milestone, not forever: it works on every browser and would translate better, but it costs tens of thousands of tokens per long article, adds tens of seconds of latency, and sends the article to a model provider a second time — for a first-read scan. The on-device route is free, local and seconds. The model tier stays the plan for browsers without the API and for a future "translate better" menu item; the menu is already shaped to hold it.

**Send the article into the side chat (`quoteToSideChat`, the canvas precedent).** Rejected: the translation would land in a conversation rather than in the article, could not be cached per article, and would mix reading with chatting. The pane's promise is reading in place.

**Translate paragraph by paragraph.** Rejected: the reader's request is one SENTENCE's original, and a paragraph-level result cannot be split back reliably (the model merges and splits sentences). Guessing an alignment would sometimes show the wrong original — a silent wrong answer, which is the one failure this package must not have.

**Translate text node by text node.** Rejected: a paragraph with no inline markup is a single text node, so "one sentence's original" would not exist for ordinary prose. Sentence splitting inside the node is what makes the granularity real.

**A pinned bottom "original" bar with a "pin" affordance (the first mockup).** Rejected by the user during the design loop: it added standing chrome under the article, and the verb "pin" described a mechanism rather than the reader's intent. The inline-under-the-paragraph reveal does the same job with no extra furniture, and the sentence itself is the affordance (hover tint plus one dismissable tip).

**In-place replacement of the clicked sentence (the second mockup variant).** Rejected by the user: it shows only one language at a time, so the comparison has to be remembered rather than seen. Keeping the Chinese in place and putting the original underneath is the true side-by-side reading.

**Two views instead of three (translation / original).** Rejected: the side-by-side mode was already part of the agreed design, and the sentence click does not replace it — a reader who wants to check a whole section at once uses the paragraph-level view.

**`translateStreaming` per unit.** Rejected: batches already paint progressively at sentence granularity, so streaming within one short sentence adds no visible benefit and another code path to keep correct.

**Cache translations in `localStorage`.** Rejected for now: the memory is bounded and in-page (4,000 sentences), so nothing about what the reader read is persisted beyond the tab's lifetime. A durable cache would be a second copy of article text on disk, which the package's posture (the host's own fetch cache, `$DSH_HOME/state/dsh-reader`) does not need for a free, local operation.

## Consequences

- Translation adds no host surface, no wire contract, no on-disk state and no dependency; the plugin's compatibility story with the host is unchanged. Its availability is a browser fact, and `dsh.compat.notes` records it as one.
- The price of free and local is platform reach: Chrome 138+ / Edge 148+ desktop only. Safari, Firefox and mobile see no globe at all — an absent offer rather than a broken one.
- Sentence splitting is deliberately conservative: when a rule is unsure it does not split, so an unsplit paragraph costs granularity (one bigger unit) and never correctness. A sentence containing an inline element splits into its two sides; the original shown for each side is that side's text, which is honest but not always a full sentence.
- The article DOM is mutated by a module React does not own. The lifecycle is owned by three effects (new body, unmount, cancel) and `restoreArticle` is byte-exact; the render suite covers the round trip rather than trusting it.
- Translations are Chinese-only in this milestone, and the source is assumed to be Latin/Cyrillic prose (runs without those letters are skipped, and a CJK body hides the globe), so Japanese→Chinese is not covered yet.
- The click gesture has no affordance of its own, so it is taught by one dismissable line per session; if readers do not find it, the fix is a stronger affordance on the sentence, not a bigger menu.
- The reader's own model quota is never spent, which also means translation keeps working when the host has no model configured or the quota is exhausted — and it keeps working offline, after the pack has been downloaded once.

## Related

- [the reader rewrite](../feature/2026-09-17-reader-rewrite.md) owns the wall/detail/management split, the fetch and persistence seams, and the detail view's DOM-text decision this feature builds on.
- [the wall pass](../bug-fix/2026-09-18-reader-wall-toolbar-tag-panel-and-card-pass.md) owns the toolbar and card treatment the globe joins.
