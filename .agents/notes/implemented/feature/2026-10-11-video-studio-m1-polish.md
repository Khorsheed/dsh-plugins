# Agent Note: Video studio M1 polish — final transcript view, bed music, cache sweep, multi-leg recordings

Status: implemented

## Problem

Four gaps surfaced once the panel was used on real material, each small in scope but load-bearing for the workflow. (1) The transcript showed every cut as struck-through text forever — after 200 cuts the page was more scar tissue than script, and there was no way to read the episode as it would ship. (2) The show settings carried `bedMusic` but no export ever mixed it. (3) `cleanupDays: 30` existed in the global config with nothing reading it — caches grew forever, which got worse once the ASR WAV became the panel player's audio source. (4) Recorders get paused and resumed: one session arrived as several files, and the model only understood one reference recording per project.

## Decision

**Two transcript views, clean by default.** The 文稿 tab opens on 成片 (final): applied cuts are gone, timecodes are output time, clicking a phrase plays from it, and only the proposals still awaiting a decision stay visible (dashed). The 原始 (source) view keeps the full review surface — struck cuts with origin styles, the origin filters, the legend, pause badges, click-to-restore. The switch sits in the stats row; the player's 剪后/原声 axis stays independent so the main loop (watch the source marks, hear the edit) survives. A cut made in the clean view makes text vanish, so it comes with a 6-second undo toast. Search and replace target the episode as it ships: `findOccurrences` skips applied cuts unless the caller passes `includeRemoved` (the source view does, so a cut phrase stays findable for restore).

**Bed music is real.** Exports mix `bedMusic` under the whole episode (MP3 and MP4): the input loops (`-stream_loop -1`, new `loopInputs` on the export runner), is trimmed to length, sits at a fixed 0.16 gain, and is ducked by the voice via `sidechaincompress` with the body as the key. Intro/outro durations now count toward progress and the bed length. A missing bed file is skipped, never fatal.

**The sweep exists.** `sweepCaches()` runs once at boot: a project cache (ASR/proxy WAV, peaks, embeddings, filter scripts — all rebuildable) is deleted `cleanupDays` after its last successful export. `project.json` is never touched.

**Continuous multi-leg recordings.** Import with 连续录制 (or `video_import` with `continuous: true`) butt-joins the batch's recordings in path order into one logical reference: `project.referenceParts = [{sourceId, startSec}]`, and the edit timeline is the joint axis. The ASR WAV is written from the legs concatenated (formats normalised per leg first), so transcription, diarization, the player and `audioChunk` are unchanged. Each leg aligns to the video separately (the wall-clock pause is not on the joint axis), stored as `source.partOffsets`; `mapFramesToVideo` splits kept ranges at seams and snaps each piece to the frame grid with its leg's offset. The transcript draws a dashed seam divider (「第 N 段 · 继续录制」) before the first paragraph crossing each seam — including a paragraph that straddles it, since the join can sit mid-sentence. Setting or changing legs is locked once a transcript exists.

## Alternatives considered

- **One mode switch for both eyes and ears.** Rejected: the main loop is "see the marks, hear the edit" (source view + 剪后 playback), and proofreading is "source view + 原声". Coupling view and playback mode kills both.
- **A bottom action bar for selections (shipped briefly).** Replaced by the floating bubble glued to the selection — the bar was far from the words and duplicated the player's sticky slot.
- **Virtual per-file timelines for legs.** Everything downstream (edits, player, subtitles) would map per leg forever. Joining once at import keeps one axis; the price is the seam handling above.
- **ffmpeg's implicit split for reusing a graph label.** It silently drops later concat legs — a 6:00 episode exported as 117 s. The joined reference is now split with an explicit `asplit` whenever several kept ranges consume it, and a test pins the graph shape.
- **Bed volume as a setting.** Deferred: fixed 0.16 + ducking covers the default; the 声音 tab (M2) is the place for per-episode control.

## Consequences

- `Project` gains `referenceParts?`, `Source` gains `partOffsets?`, `EditKind` had already gained `'text'`; all additive, older builds read the files fine. `snapToFrames` is gone in favour of `mapFramesToVideo` (its test was ported).
- The typert analyzer rejects public service methods with unannotated defaulted parameters (`now = Date.now()` needs `now: number = ...`) — it fails gen-typert before tsc runs.
- Build-hygiene lesson, twice in one session: piping the build into `grep -c` reported "0 errors" while gen-typert was crashing, and `tsc -b`'s incremental cache let an undefined name through. The package gate is now: full build with a checked exit code, plus `tsc -p tsconfig.host.json --noEmit && tsc -p tsconfig.client.json --noEmit` when the cache is suspect.

## Testing

`tests/core.spec.ts` (19): `mapFramesToVideo` frame-grid snap and seam split with per-leg video offsets, the audioGraph bed mix and explicit asplit, the sweep's keep/delete matrix, plus the earlier text-correction and timeline suites. Live on 3197 with a real recording cut into two legs (m4a 32 kHz + wav 48 kHz): continuous import with leg badges, joined transcription up to the 6:00 joint end, the seam divider, playback across the seam, and an MP3 export measuring exactly the kept length (297.161 s = 360 − 62.84 cut).
