# Agent Note: a translation now follows its body

Status: implemented

## Problem

The reader reported: leave the reader (another conversation / another panel), come back, and the article is on screen but the translation is gone.

Two defects in the restore path, both about *when* it looked:

- **It read the record from a copy taken at mount.** `snapshotRef` holds `readSession()` once, on mount, so a translation turned on during the CURRENT mount was written to the page memory *after* that copy — and the restore steps compared against the copy. Any later body replacement therefore found "no record" for an entry that was, at that moment, translated.
- **It was armed once per entry, not once per body.** `restoredTranslationRef` was reset only when `openEntryId` changed. The effect that owns the segmentation lifecycle (`[openEntryId, articleHtml]`) tears the translation down whenever the body changes — correctly, since the injected spans die with the old DOM — and nothing re-applied it. So a body replaced *under* a translated article (the everyday case: a summary-only paper whose cached body had expired, so opening it shows the feed's summary, the restore translates it, and then the re-fetch lands with the real page) left the article untranslated with no way back except clicking the globe again.

Both are invisible in the "switch panel and come back" case: a fresh mount reads a fresh copy and starts from an empty DOM. They show up exactly where the reader found them: a translated article whose body moves under it.

## Decision

- **The restore steps read the page memory live** (`readSession()`), not the mount-time copy. The copy stays, because hydration is a one-shot act and re-reading it later would undo the narrowing the reader is doing right now — it is simply not what the restores consult.
- **The re-arm key is the BODY**: `restoredTranslationRef` resets on `[openEntryId, articleHtml]`. The record means "the globe is on for this entry" (it is deleted the moment the reader turns the globe off, or asks for a fresh fetch), so a rebuilt body gets its translation back automatically. This is the rule that makes the behavior stateable in one sentence instead of "on, unless something replaced the DOM".
- **One translation run at a time.** `startTranslation` now cancels whatever is in flight and restores the article to the host's markup before building its own segmentation: the reader's retry and the restore can legitimately overlap now, and two runs over one DOM would decorate it twice.

## Alternatives considered

**Re-apply the translation on a timer or a `MutationObserver`.** A polling loop that repairs the DOM is exactly the kind of machinery this pane has avoided everywhere else; the re-arm key gets the same result from the lifecycle React already tells us about.
**Detect a React-recreated element by checking `built.root.isConnected`.** Would cover a re-render that rebuilds the element without changing `articleHtml`. No such path exists in this pane (the article element appears once, inside the detail view, and a session switch unmounts the whole pane), so the check would be speculative — and the re-arm covers every path that does exist.
**Keep the translation state in the store instead of module memory.** The same staleness would appear one layer up (a store snapshot captured by a selector), and it would put a third party's text in the store the host could serialise.
**Persist the record so a reload restores the globe.** Still declined: after a reload there is no translator session to drive the record, and the translated text is not allowed on disk. See the earlier notes.

## Consequences

- "The globe is on for this entry" is now a durable property of the entry within the page: it survives panel switches, session switches, body replacements, re-fetches and re-renders, and ends only when the reader turns it off (`orig` deletes the record) or asks for a fresh fetch (`重新抓取` deliberately forgets it, because the body is about to be a different document).
- A body swap now costs a translation run. With the sentence memory that is normally free (every sentence is already remembered), and only genuinely new text goes to the translator.
- The mount-time copy and the live read are now two different things on purpose, and the comment on `snapshotRef` says so — the next person to add a restore step should reach for `readSession()`.

## Testing

`packages/dsh-reader` runs 254 tests (1 new):

- `tests/ReaderPane.client.spec.tsx`: an article is opened and translated; its body is then replaced under the reader with no gesture at all (the store action a re-fetch uses); the article must show the new text TRANSLATED. Before the fix the restore had already spent its one chance (`restoredTranslationRef`) and read a stale copy, so the assertion failed with the raw English sentence.
