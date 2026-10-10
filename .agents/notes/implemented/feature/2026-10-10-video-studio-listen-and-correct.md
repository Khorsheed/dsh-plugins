# Agent Note: Video studio — listen-while-editing player, cut provenance, and transcription corrections

Status: implemented

## Problem

The M1 文稿 tab ([the video-studio proposal](../../proposed/feature/2026-10-06-video-studio-podcast-editing.md)) was a read-and-click surface: cut a phrase, accept a proposal, but never *hear* the result until export. Acceptance on the user's real 19-minute recording surfaced four gaps: there was no way to listen to the edit while cutting it; the user's own cuts and the model's accepted cuts looked identical; the transcript paged with a manual 「再显示 N 段」 button that playback would have outrun anyway; and ASR mistakes (坚顾 for 坚固, 门法 for 门阀) had no fix path — this Paraformer build accepts no custom vocabulary, so corrections have to happen after transcription.

## Decision

**The transcript is a listening surface.** A sticky player bar at the bottom of the 文稿 tab plays the reference recording two ways — 剪后 (the kept ranges back to back, a 12 ms fade at every splice) and 原声 (as recorded) — switchable mid-playback, with a scrubber that maps between output and reference time. Audio is raw 16 kHz PCM read by the host straight out of the project's cached ASR WAV (`videoStudio.audioChunk`, base64 PCM16, ≤60 s per call) and scheduled gaplessly in the browser with Web Audio (`src/client/player.ts`). The WAV is therefore **no longer deleted after transcription** — it stays in the project cache dir as the player's audio proxy, disposable and rebuilt by ffmpeg on demand. The paragraph and word being heard are highlighted (`data-playing` / `data-now`), the view scrolls to follow (a 跟随 toggle), and paging is automatic: an IntersectionObserver sentinel replaces the manual 「再显示」 button, and follow-mode pages forward so playback never outruns the render.

**Cuts carry their origin.** Applied cuts render by `edit.origin`: the user's cuts get a single strikethrough, the model's a double violet one, with a legend and filter chips (全部 / 待决 / 我剪的 / 模型剪的 / 匹配). Hovering a model cut shows its reason (filler, long pause, repeat). `scanTranscript` now counts only `cut`/`shorten` edits as coverage, so text corrections no longer suppress re-scans.

**Corrections are a first-class edit kind.** `EditKind` gains `'text'`: an edit over a token range carrying `text` (the correction) and `from` (what the tokens said). `displayTokens()` (`src/core/text.ts`) swaps corrected ranges into the displayed transcript, the SRT/ASS cues, the TXT export and the model's `video_read` view — audio and cut times are never touched. Three paths create them: drag-selecting words in the panel → 改字 (applies at once); the find bar's replace-all, whose 存进节目 option also writes the rule into the show's new `Settings.replacements` table so every later transcript gets it as applied text edits on import; and the model, whose `video_propose_edit` gains `fix_text` ([{from, to}] → one proposal group over every occurrence) and `cut_keyword` actions — model corrections stay `proposed` until the user's ✓, same as cuts.

## Alternatives considered

- **`<audio>` over a proxy file or HTTP range streaming.** Cannot play the *edit*: kept-range playback needs sample-exact gapless scheduling with fades at splices, which is exactly Web Audio's model. PCM chunks from the cached ASR WAV join sample-exactly by construction.
- **Mutating the transcript tokens.** Rejected by the proposal's non-destructive rule: everything is an edit over the original recording, so a correction is an edit kind, reversible and attributable, with the original text kept in `from`.
- **Feeding the ASR a custom vocabulary.** This Paraformer build has no such input; show-level replacement rules get the same effect for recurring names and terms, and double as a visible, deletable record in the show's settings.
- **Keeping the manual page button.** Playback follow makes manual paging a bug farm; the sentinel loads on scroll and the follow effect loads ahead of the playhead.

## Consequences

- `project.json` grows `kind:'text'` edits and `Settings.replacements`; both are additive (older builds ignore unknown kinds, missing tables read as empty). `SettingValue` widens with `Record<string, string>`.
- Each project keeps its ASR WAV (tens of MB per hour of audio) until the cache cleanup; the 30-day-after-export policy is unchanged.
- First playback of a project imported before this change pays one ffmpeg decode to rebuild the WAV.
- The panel remote surface grows four verbs (`fixText`, `replaceAll`, `cutMatches`, `audioChunk`); `audioChunk` never carries more than 60 s of PCM per call.

## Testing

`tests/core.spec.ts` covers `displayTokens` (applied only, time-span swap) and `findOccurrences` (cross-token Chinese matching, case-folding, corrected-text visibility, empty needle). Live acceptance ran on the 3197 temp instance with the real 19-minute recording: sustained 1× playback in both modes with word-level follow, auto-loading on scroll, origin filters, find (门阀 → 10 hits), replace-all with the show rule (坚顾→坚固, verified in `shows/<id>.json` and marked 原文：坚顾 in the transcript), and the tool path end-to-end in-process (`fix_text` → proposed group → ✓ → SRT cues carry the correction).
