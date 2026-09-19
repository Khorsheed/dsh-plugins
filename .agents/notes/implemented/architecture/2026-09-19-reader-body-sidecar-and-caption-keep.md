# Agent Note: large bodies live in their own files — and a caption is content

Status: implemented

## Problem

Three things landed together, and one of them was a correction of my own previous decision.

**A hard-coded ceiling silently overrode the cache policy.** The previous batch made a body over 4 MiB *not cached at all* (`tooLarge`), to keep `state.json` small. But this package already has a cache policy the reader configures — `ttlHours` (12 / 24 / 168 / 0, default 24) and `maxEntries` (500) — and the ceiling was neither surfaced in the UI nor subject to it: a 41 MB article was served once and then forgotten, no matter what the reader had chosen. Reported, correctly, as a contradiction of a setting that was already agreed and implemented.

**A 41.8 MB download timed out.** After the byte and character caps were raised to 64 MB, the same article failed with `web fetch timed out` — the seam's `timeoutMs` defaults to 30,000 ms and the measured download takes 19.5 s on a direct connection, so any competing load blows the deadline. The seam's caps are three, and only two had been raised.

**Dropping caption-only figures was wrong.** The previous batch removed every `<figure>` whose picture the fetch could not bring, on the argument that a caption under nothing reads as data loss. The reader's objection is better: the caption is text the page published, it carries the figure number and what the figure shows, and hiding it converts "this picture cannot be fetched" into "this paragraph lost its data". Restored: the figures stay, captions included, and the body-level note explains why they have no picture under them.

## Decision

- **A body over 256 KiB is written to `bodies/<sha1(entryId)>.html`** and the document keeps `{ file, chars }` instead of the markup. `INLINE_BODY_MAX_CHARS` (256 KiB) is the only threshold; there is no ceiling that discards a body. The reader's `ttlHours` / `maxEntries` govern sidecar bodies exactly like inline ones, and the sweep that runs after every commit deletes the files of bodies the document no longer references — so eviction, a hand-edited document and a tag-only annotation all release their files.
- **`getEntryBody` reads the file back**, and a missing or unreadable file simply means "no cache": the view returns no html and no error, so opening the entry fetches it again instead of showing a blank page.
- **The state store owns the directory.** The document holds a bare file name, never a path, and the name is a digest of the entry id — entry ids are URLs, and a path derived from remote text is a traversal waiting to happen.
- **The swept directory is best-effort.** A failed sweep never fails the commit that triggered it: an unreachable file left behind costs disk, while a refused commit costs the reader their tags.
- **The deployment raises `timeoutMs` to 180,000 ms** alongside the two size caps, in the same patch row.
- **Script-drawn figures keep their captions**; the extractor counts them (`scriptFigures`) and the detail view says once, above the body, that those N pictures cannot be fetched and that the captions are kept.

## Alternatives considered

**Keep the 4 MiB ceiling and make it a setting.** Rejected once the sidecar existed: a second size knob beside the retention policy asks the reader to reason about storage internals to decide whether an article can be read twice. The directory keeps the document small without adding a control, and the policy they already configured governs everything.

**Cap `state.json`'s total size instead of moving bodies out.** Rejected: it is the same problem one level up — the document is rewritten whole, so the right answer for bulk text is not to put it in the document at all.

**Store sidecar bodies under a per-entry directory named after the entry id.** Rejected: entry ids are URLs and titles; a digest is stable, path-safe and needs no escaping rules.

**Delete evicted files only when the process shuts down.** Rejected: the watchdog restarts the instance at will, and a crash would leave the directory growing silently. Sweeping after each successful commit is idempotent and cheap at this scale.

**Keep the figures dropped and rely on the note above the body.** Rejected on the reader's argument: the count says how many pictures are missing, not *which* discussion they belong to, and the captions are exactly what ties them to the prose.

**Insert a per-figure marker ("[picture not fetched]") inside each caption.** Rejected for now: the marker text would have to be baked into extracted content, which is language-neutral by design, while the note above the body is localized like every other string in the pane. Worth revisiting if the count alone proves insufficient.

## Consequences

- The retention policy once again means what it says. A large article read within its TTL is served from its file; past the TTL it is fetched again; when the entry count exceeds `maxEntries`, the oldest body — file and all — goes.
- Disk use is no longer bounded by the document budget: `bodies/` grows to `maxEntries` × body size. That is the deliberate trade (the reader asked for long articles to be readable), and the sweep means it cannot grow past what the document references.
- `state.json` stays small enough to read and rewrite on every mutation, which is the property the ceiling was protecting in the first place.
- Uninstall documentation changes: the state is now a directory (`state.json` + `bodies/`), and the README says to delete the whole `dsh-reader/` for a clean removal.
- The `tooLarge` field and its notice are gone — nothing is served-but-discarded any more.
- Two bugs in the previous batch were also fixed in passing: `normalizeBody` had never carried `scriptFigures` (so the script-figure note survived exactly one read), and the locale key union was missing the new key (the build caught it after the commit; the commits were redone green).
- The extraction keeps 84 captions on the measured paper that the previous batch had thrown away.

## Testing

`packages/dsh-reader` runs 216 tests:

- `boot.spec.ts`: a 300 KB body is written to `bodies/`, the document holds `{ file, chars }` and no html, a later read serves the exact markup, eviction under `maxEntries: 1` sweeps the files of the bodies the document let go, and a body under the threshold still inlines.
- `extract-article.spec.ts`: a caption-only figure is counted AND its caption survives; a figure with a real image is not counted.
- The client-side "too large to cache" note and its test were removed with the mechanism.
