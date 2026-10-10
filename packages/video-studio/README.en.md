# @khorsheed/dsh-video-studio

English | [中文](README.md)

**Video studio**: edit casual chats, podcasts and conversations among friends inside dsh. The conversation decides *what* to cut, the right-sidebar 剪辑 panel handles *how*, and both edit the same project.

A group sitting around one recorder makes one mixed recording. After import the plugin separates the speakers and recognises regular members from the voiceprints stored in the show. The transcript is the editing surface: click a phrase to cut it, click again to restore it. A scan finds fillers, long pauses and repeats and offers them as one proposal that waits for your ✓. Export gives podcast audio, a full video with subtitles, an SRT and a transcript.

## Features

- **Speakers in one mixed recording**: local speaker diarization (pyannote segmentation + CAM++ embeddings) finds the voices. Members stored in the show are recognised automatically; for a new voice, press ▶ to hear a sample and name it, and the name is saved to the show for next time. Wrong splits can be merged, and any segment can be reassigned.
- **Cut by deleting words**: speaker-coloured paragraphs; click a phrase to cut, click again to restore. Cuts are kept in the original recording's time, so nothing is re-encoded before export.
- **Listen while you cut**: the transcript tab's player plays the edit as it will sound or the original take, highlighting and following the current paragraph and word. Your cuts and the model's are struck through differently and can be filtered by origin. Misheard words can be corrected by selecting them or with replace-all (optionally saved to the show for future episodes) — text and subtitles only, never the audio.
- **Proposals, not silent edits**: the model's filler/pause/repeat scan and structural suggestions arrive as dashed proposal groups that take effect only on ✓. Your own panel edits are handed to the model as events, so its next turn does not overwrite them.
- **Pauses are shortened, not cut**: long pauses default to 0.6 s, with per-speaker thresholds (a slow talker gets a higher one).
- **Automatic video alignment**: phone footage is aligned to the recording by its sound; no clap needed.
- **Show → project**: a show stores intro/outro music, loudness targets, subtitle style, editing habits and voiceprints. Each new episode copies them. The Settings tab shows every value's source across the project / show / global layers and can save a change as the show default or reset it.
- **Export**: MP3 (two-pass loudnorm, −16 LUFS by default), 1080p MP4 (burned or switchable subtitles, −14 LUFS), SRT and TXT, as background jobs with progress in the panel and the conversation.
- **Editing mode**: the `dsh-video` preset in `@khorsheed/dsh-presets` grants the `video_*` tools and the `video-studio` skill.

## Install

```bash
dsh plugin --profile web add @khorsheed/dsh-video-studio
dsh plugin --profile web add @khorsheed/dsh-presets   # editing mode (dsh-video)
```

Needs `ffmpeg` / `ffprobe` on the host (on PATH, or set in the panel under Settings → Global). The speech models (about 330 MB: Paraformer Chinese ASR, CT-Transformer punctuation, pyannote segmentation, CAM++ voiceprints) download automatically on the first transcription into `$DSH_HOME/state/video-studio/models/`, or by hand from Settings.

Uninstall:

```bash
dsh plugin --profile web remove @khorsheed/dsh-video-studio
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ⚠️ the panel and host service work (page-type right-sidebar tabs since 0.1.5), but the editing-mode preset row needs the 0.1.7-rc.1+ preset mechanism, so on 0.1.5 the panel is only usable from general sessions.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.0-rc.1): build and tests pass against the 0.2.0-rc.2 source tree.
- **Native dependency**: `sherpa-onnx-node` ships prebuilt per-platform addons (about 34 MB on darwin-arm64). Speech jobs run in a child process, so an addon that fails to load fails the transcription job only, never boot.
- **ffmpeg version**: only filters present since 4.2 are used (atrim / concat / loudnorm / afftdn). An ffmpeg without libass (the `subtitles` filter) gets a switchable subtitle track in the video instead, and the panel says so.
- **Web surface**: the right-sidebar tab is a browser surface; a headless profile gets only the host service and tools.

## Known Limitations

- **A mixed recording cannot drop one voice**: cutting a range removes everyone in it, so crosstalk and back-channel words stay by default. Speech separation comes later.
- **Mixed recordings only**: one-mic-per-person multitrack input is not built yet (the data model keeps the hook: a speaker can come from a track).
- **Import by path**: give local paths in the panel or the conversation; browser drag-and-drop upload is not built yet.
- **Previews are short clips**: ▶ in the panel plays a stretch of at most 30 s with cuts applied; the full timeline, waveforms and volume envelopes come in the next version.
- **Diarization depends on the recording**: far-away speakers, similar voices and heavy crosstalk get mis-split and need merging or reassigning in the panel.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Project record.** `$DSH_HOME/state/video-studio/projects/<id>/project.json` is the single source of truth. Sources are paths only; every edit is a range on the reference recording's timeline (`cut` / `shorten`) with a `proposed | applied | rejected` state and a proposal group. Output time is the reference timeline minus the applied cuts and shortenings, and exports, subtitles and durations are all derived from it. Writes are atomic (temp file + rename) and read-modify-write cycles are serialised per project.

**Media jobs.** Alignment, diarization+transcription and export are jobs in a host queue, run one at a time, persisted in `jobs.json` and re-queued after a restart. Diarization and ASR run in a `child_process.fork`ed worker (sherpa-onnx decoding is synchronous native work that must not hold the host's event loop): diarize the whole file → merge a speaker's adjacent turns → split long turns at their quietest point into ≤ 25 s chunks → Paraformer per chunk with token timestamps → the punctuation model adds punctuation, re-attached to the tokens → one voiceprint per voice from up to 60 s of speech, cosine-matched against the show's stored voiceprints.

**Export.** An ffmpeg filter script is generated from the kept ranges (`atrim`/`trim` + `concat`, a 20 ms fade at every splice). Audio goes through two-pass loudnorm; video applies `fps=30` once after the concat and then burns subtitles.

**Two faces.** The panel calls the host service through the `videoStudio` Typert Remote; the model calls the same service through the `./tool` entry's `video_*` tools. Panel edits are written into the project's `events`, and `video_read` hands the model every event since its last read.

</details>

## Development

```bash
pnpm --filter @khorsheed/dsh-video-studio build
pnpm --filter @khorsheed/dsh-video-studio test
# manual smoke (needs the downloaded models):
pnpm exec tsx packages/video-studio/tests/smoke/smoke-service.ts <recording> [video]
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
