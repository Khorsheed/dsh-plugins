# Agent Note: Video studio — listen-while-editing player, cut provenance, and transcription corrections

Status: implemented

## Problem

The M1 文稿 tab ([the video-studio proposal](../../proposed/feature/2026-10-06-video-studio-podcast-editing.md)) was a read-and-click surface: cut a phrase, accept a proposal, but never *hear* the result until export. Acceptance on the user's real 19-minute recording surfaced four gaps: there was no way to listen to the edit while cutting it; the user's own cuts and the model's accepted cuts looked identical; the transcript paged with a manual 「再显示 N 段」 button that playback would have outrun anyway; and ASR mistakes (坚顾 for 坚固, 门法 for 门阀) had no fix path — this Paraformer build accepts no custom vocabulary, so corrections have to happen after transcription.

## Decision

**The transcript is a listening surface.** A sticky player bar at the bottom of the 文稿 tab plays the reference recording two ways — 剪后 (the kept ranges back to back, a 12 ms fade at every splice) and 原声 (as recorded) — switchable mid-playback, with a scrubber that maps between output and reference time. Audio is raw 16 kHz PCM read by the host straight out of the project's cached ASR WAV (`videoStudio.audioChunk`, base64 PCM16, ≤60 s per call) and scheduled gaplessly in the browser with Web Audio (`src/client/player.ts`). The WAV is therefore **no longer deleted after transcription** — it stays in the project cache dir as the player's audio proxy, disposable and rebuilt by ffmpeg on demand. The paragraph and word being heard are highlighted (`data-playing` / `data-now`), the view scrolls to follow (a 跟随 toggle), and paging is automatic: an IntersectionObserver sentinel replaces the manual 「再显示」 button, and follow-mode pages forward so playback never outruns the render.

**Cuts carry their origin.** Applied cuts render by `edit.origin`: the user's cuts get a single strikethrough, the model's a double violet one, with a legend and filter chips (全部 / 待确认 / 我剪的 / 模型剪的). Hovering a model cut shows its reason (filler, long pause, repeat). `scanTranscript` now counts only `cut`/`shorten` edits as coverage, so text corrections no longer suppress re-scans.

**Corrections are a first-class edit kind.** `EditKind` gains `'text'`: an edit over a token range carrying `text` (the correction) and `from` (what the tokens said). `displayTokens()` (`src/core/text.ts`) swaps corrected ranges into the displayed transcript, the SRT/ASS cues, the TXT export and the model's `video_read` view — audio and cut times are never touched. Two paths create them: the panel — drag-selecting words pops a vertical menu anchored at the selection (▶ play from here / 剪掉 / 恢复 when the selection overlaps a cut / 改字…), where 改字… opens the find bar pre-filled with the selection and aimed at that occurrence, and the bar's 替换当前 / 全部替换 apply at once; and the model, whose `video_propose_edit` gains `fix_text` ([{from, to}] → one proposal group over every occurrence) and `cut_keyword` actions — model corrections stay `proposed` until the user's ✓, same as cuts. (The horizontal bubble's inline edit form, the 找同款 button, and the show-level `Settings.replacements` auto-apply added here were later reworked or removed — see [the find-nav note](2026-10-18-video-studio-find-nav.md).)

## Alternatives considered

- **`<audio>` over a proxy file or HTTP range streaming.** Cannot play the *edit*: kept-range playback needs sample-exact gapless scheduling with fades at splices, which is exactly Web Audio's model. PCM chunks from the cached ASR WAV join sample-exactly by construction.
- **Mutating the transcript tokens.** Rejected by the proposal's non-destructive rule: everything is an edit over the original recording, so a correction is an edit kind, reversible and attributable, with the original text kept in `from`.
- **Feeding the ASR a custom vocabulary.** This Paraformer build has no such input; find-and-replace after transcription covers recurring names and terms. (The show-level replacement rules once cited here were later removed as invisible, unmanaged state — see [the find-nav note](2026-10-18-video-studio-find-nav.md).)
- **Keeping the manual page button.** Playback follow makes manual paging a bug farm; the sentinel loads on scroll and the follow effect loads ahead of the playhead.

## Consequences

- `project.json` grows `kind:'text'` edits — additive (older builds ignore unknown kinds). `SettingValue` widens with `Record<string, string>`. (`Settings.replacements`, added here, was later removed by [the find-nav note](2026-10-18-video-studio-find-nav.md); `SettingValue` keeps the widened member.)
- Each project keeps its ASR WAV (tens of MB per hour of audio) until the cache cleanup; the 30-day-after-export policy is unchanged.
- First playback of a project imported before this change pays one ffmpeg decode to rebuild the WAV.
- The panel remote surface grows four verbs (`fixText`, `replaceAll`, `cutMatches`, `audioChunk`); `audioChunk` never carries more than 60 s of PCM per call.

## Testing

`tests/core.spec.ts` covers `displayTokens` (applied only, time-span swap) and `findOccurrences` (cross-token Chinese matching, case-folding, corrected-text visibility, empty needle). Live acceptance ran on the 3197 temp instance with the real 19-minute recording: sustained 1× playback in both modes with word-level follow, auto-loading on scroll, origin filters, find (门阀 → 10 hits), replace-all with the show rule (坚顾→坚固, verified in `shows/<id>.json` and marked 原文：坚顾 in the transcript; the show-rule path was later removed by [the find-nav note](2026-10-18-video-studio-find-nav.md)), and the tool path end-to-end in-process (`fix_text` → proposed group → ✓ → SRT cues carry the correction). The selection bubble, 找同款 → find-bar handoff and the renamed filters were exercised live in the same pass.
