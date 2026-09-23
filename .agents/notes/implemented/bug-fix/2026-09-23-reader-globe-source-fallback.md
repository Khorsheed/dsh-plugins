# Agent Note: The reader's globe survives a misdetected source language (candidate chain + script-evidence veto)

Status: implemented

## Problem

The detail view's translate globe disappeared on some articles — reproducibly on arXiv papers from Chinese labs. The globe's visibility gate (`translationOffered` in `packages/dsh-reader/src/client/ReaderPane.tsx`) hides the control when the settled source is the target language (`zh`) or when the availability probe answers `unavailable`. The source was decided by the browser's LanguageDetector over a 600-character prefix sample of the stripped body (`detectSourceLanguage` in `src/client/translate.ts`). arXiv links are upgraded to the LaTeXML HTML version (`src/arxiv.ts`), whose body opens with the title and the full author block — for a paper with ~200 romanized Chinese names that sample is pinyin, not prose, and the detector can confidently answer `zh` (or another unsupported-on-device language such as `vi`). A `zh` answer trips the gate's source condition directly; any other wrong answer probes a pair the device does not have and settles on `unavailable`. Either way the globe hid over a body that translates fine.

Two facts aggravated it. The probe asked about a single source while `startTranslation` already built sessions over a `[detected, 'en']` chain — the gate was stricter than the translator it gated. And both `translationSource` and `translateAvailability` survived an entry switch, so the previous article's answer briefly decided the next article's chrome.

## Decision

The detector is a hint; the script measurement is the veto, and the probe walks the same candidate chain the translator uses. In `ReaderPane.tsx`:

- **Script-evidence veto.** `isCjk(articleHtml)` measures the whole body. When the detector's answer has primary tag `zh` while the script guess is not Chinese, the answer is distrusted and the guess stands — a pinyin author block is not a Chinese body. The probe effect's early-exit simplifies to `translationSource === TRANSLATION_TARGET`, which now implies a measured-Chinese body.
- **Source candidate chain.** The availability probe tries `[detected, guessSource]` deduplicated, each source against every `TARGET_CANDIDATES` spelling, and settles on the first answer that is not `unavailable`. Only "every candidate unavailable" hides the globe — the same chain `startTranslation` builds sessions with, so the gate is no longer stricter than the translator.
- **Per-entry reset.** The detection effect re-bases `translationSource` on the new body's script guess synchronously (the detector then refines it asynchronously), and the body-lifecycle effect resets `translateAvailability` to `null`, so a previous entry's answer neither shows nor hides the globe over a body it was never asked about.

## Alternatives considered

**Fix the sample, not the gate** (skip the author block; sample the abstract or the first long paragraph; multi-window voting). Rejected: a per-site heuristic that grows one rule per front-matter shape and only lowers the misdetection rate. The candidate chain makes a misdetection harmless for every site at once, including short posts and mixed-language pages.

**Drop the LanguageDetector and always translate from the script guess.** Rejected: the script test cannot tell German from English, and a wrong non-target source makes `Translator.create()` reject with an error that names neither language — the detector is worth keeping as the first candidate, just not as the last word.

**Fix the gate but leave the stale per-entry state.** Rejected: with the chain in place, the remaining stale window is one frame of wrong chrome, and the reset is two lines in effects that already own those lifecycles.

## Consequences

Bought: the globe no longer disappears on arXiv papers with pinyin author blocks, nor on any body whose prefix sample fools the detector. A misdetected-but-available pair (detector says `de`, truth English, `de → zh` present on the device) behaves exactly as before — that trade was already accepted by `startTranslation`'s chain. Gate and translator now share one candidate-chain idiom, matching the existing "availability() is a hint, create() for real" philosophy.

Cost: up to two availability round-trips per opened article when the detector disagrees with the script guess; and the veto overrides the detector in exactly one direction, so a genuinely Chinese body under the 20% CJK ratio would be offered an `en → zh` translation it does not need — a harmless offer, since the same-language pair would have hidden the globe anyway.

## Testing

`packages/dsh-reader` carries 424 tests. The pane spec gained a scripted `LanguageDetector` global and two cases: a confident `zh` answer over a pinyin author list keeps the globe and builds the session for `en`, and a detected source with no on-device pair (`vi`) falls back to the script guess's pair. Both cases fail on the pre-fix code (mutation-checked by reverting `ReaderPane.tsx` to HEAD).

## Related

- [The translation follows its body](../../implemented/bug-fix/2026-09-19-reader-translation-follows-its-body.md) — the restore-side record the globe's state round-trips through.
- [Reader session memory](../../implemented/feature/2026-09-19-reader-session-memory.md) — the page-wide translator-session cache the restore path consults.
