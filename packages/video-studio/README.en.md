# @khorsheed/dsh-video-studio

English | [中文](README.md)

Edit casual chats, podcasts and conversations among friends inside dsh: editing the transcript edits the audio, and speakers, fillers and pauses are found for you.

A group sitting around one recorder makes one mixed recording, and cutting it used to mean hunting through a waveform in an editor, one slice at a time. Now you import the recording and the plugin separates the speakers and recognises regular members from the voiceprints stored in the show. The transcript is the editing surface: click a phrase to cut it, click again to restore it. A scan finds fillers, long pauses and repeats and offers them as one proposal that waits for your ✓. The conversation decides *what* to cut, the right-sidebar 剪辑 panel handles *how*, and both edit the same project. Export gives podcast audio, a full video with subtitles, an SRT and a transcript.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-transcript.png" width="640" alt="The transcript page of the right-sidebar 剪辑 panel: speaker-coloured paragraphs, struck-through cuts and dashed proposals, the player at the bottom">

## Features

- **Import one mixed recording**: pick a folder in the panel and tick the files, or give local paths in the panel or the conversation; legs recorded with pauses in between can be ticked as a continuous recording and join in order into one episode — transcription, editing and export never notice the seams. Phone footage is aligned to the recording by its sound; no clap needed.
- **Speakers separated, members recognised by voiceprint**: local speaker diarization finds the voices. Members stored in the show are recognised automatically; for a new voice, press ▶ to hear a sample and name it, and the name is saved to the show for next time. Wrong splits can be merged, and any segment can be reassigned.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-speakers.png" width="640" alt="Diarization result: one row per voice, recognised members named, new voices with ▶ preview and a name field">

- **Cut by deleting words**: speaker-coloured paragraphs; click a phrase to cut, click again to restore. Cuts are kept in the original recording's time, so the source file is never touched. The default Final view shows only what ships (with a 6-second undo for mistakes); switch to Source to see every struck cut, filter by origin, and restore with a click.
- **Pauses are shortened, not cut**: long pauses default to 0.6 s, with per-speaker thresholds (a slow talker gets a higher one).
- **Listen while you cut**: the bottom player plays the edit as it will sound or the original take, highlighting the current paragraph and word; your cuts and the model's are struck through differently. Misheard words can be corrected by selecting them, and the find bar replaces one hit at a time or all at once — text and subtitles only, never the audio.
- **Proposals, not silent edits**: the model's filler/pause/repeat scan, proofreading fixes and structural suggestions arrive as dashed proposal groups that take effect only on ✓; "AI 帮改" drafts a proofreading or tightening request into the conversation's composer (filled, not sent). Your own panel edits are handed to the model, so its next turn does not overwrite them.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-proposals.png" width="640" alt="A dashed proposal group in the transcript (fillers and long pauses), with ✓ accept and reject buttons">

- **Export audio, video, subtitles, transcript**: MP3 (−16 LUFS by default), 1080p MP4 (burned or switchable subtitles, −14 LUFS), SRT and TXT, with optional background music mixed in; exports run in the background with progress in the panel and the conversation. Shownotes are written for you by the agent in the conversation.
- **Show → project**: a show stores intro/outro music, loudness targets, subtitle style, editing habits and voiceprints. Each new episode copies them. The Settings page shows every value's source across the project / show / global layers and can save a change as the show default or reset it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-export.png" width="640" alt="The Export page: podcast audio, full video, subtitles and transcript ticked, the save location, export progress below">

Speaker separation and transcription run on the shared local transcription plugin [`@khorsheed/dsh-transcribe`](https://github.com/Khorsheed/dsh-plugins/tree/main/packages/transcribe), entirely on this machine — the recording is never uploaded.

## Install

Recommended: the video suite, together with the basic experience:

```bash
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```

Restart the instance, then pick 剪辑模式 (editing mode) in the session's mode picker: the session gets the `video_*` tools and the `video-studio` skill, and 剪辑 appears in the right sidebar.

Advanced: this package alone.

```bash
dsh plugin --profile web add @khorsheed/dsh-video-studio
```

Installed alone, the host service is there, but the `video_*` tools are granted per session by editing mode only and never reach other sessions; the 剪辑 panel self-hides per session too, appearing only where those tools are reachable (hidden in standard mode). So a standalone install needs a mode that grants `@khorsheed/dsh-video-studio/tool`. Uninstall with the matching `remove`.

**Host dependencies:**

- `ffmpeg` / `ffprobe`: on PATH, or set in the panel under Settings → Global.
- Speaker separation and transcription run on the Local Transcription plugin (`@khorsheed/dsh-transcribe`), installed alongside; without it the panel says so and editing and export still work. Its speech models (about 360 MB: Paraformer Chinese ASR, CT-Transformer punctuation, pyannote segmentation, CAM++ voiceprints) download automatically on the first transcription into `$DSH_HOME/state/transcribe/models/` (models an earlier video-studio downloaded are moved there), or by hand from Settings. The download source is selectable under Settings → Global (auto / Hugging Face / HF-Mirror China mirror; auto probes for the fastest reachable source). Downloads resume from the bytes already on disk (a restart or network drop never re-downloads them) and are verified against pinned byte sizes and sha256 hashes on completion.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ⚠️ the panel and host service work (page-type right-sidebar tabs since 0.1.5), but the editing-mode preset row needs the 0.1.7-rc.1+ preset mechanism, so on 0.1.5 the panel is only usable from general sessions.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes.
- **The transcription engine is an optional plugin**: speaker separation and transcription run on Local Transcription (the `transcribe` service), probed per job; without it the panel says so and transcription jobs fail with that message, while editing and export work. The native `sherpa-onnx-node` dependency travels with it, no longer with this plugin.
- **ffmpeg version**: only filters present since 4.2 are used (atrim / concat / loudnorm / afftdn). An ffmpeg without libass (the `subtitles` filter) gets a switchable subtitle track in the video instead, and the panel says so.
- **Web surface**: the right-sidebar tab is a browser surface; a headless profile gets only the host service and tools.

## Known Limitations

- **A mixed recording cannot drop one voice**: cutting a range removes everyone in it, so crosstalk and back-channel words stay by default. Speech separation comes later.
- **Mixed recordings only**: one-mic-per-person multitrack input is not built yet (the data model keeps the hook: a speaker can come from a track).
- **No drag-and-drop upload**: sources come from a picked folder or a local path (Choose folder shows only when the page is opened on the host machine itself); browser drag-and-drop upload is not built yet.
- **Previews are short clips**: ▶ in the panel plays a stretch of at most 30 s with cuts applied; the full timeline, waveforms and volume envelopes come in the next version.
- **Diarization depends on the recording**: far-away speakers, similar voices and heavy crosstalk get mis-split and need merging or reassigning in the panel.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Project record.** `$DSH_HOME/state/video-studio/projects/<id>/project.json` is the single source of truth. Sources are paths only; every edit is a range on the reference recording's timeline (`cut` / `shorten`) with a `proposed | applied | rejected` state and a proposal group. Output time is the reference timeline minus the applied cuts and shortenings, and exports, subtitles and durations are all derived from it. Writes are atomic (temp file + rename) and read-modify-write cycles are serialised per project.

**Media jobs.** Alignment, diarization+transcription and export are jobs in a host queue, run one at a time, persisted in `jobs.json` and re-queued after a restart. Diarization and transcription call the Local Transcription plugin's `transcribe` service (probed per job): diarize the whole file (pyannote segmentation + CAM++ embeddings) → merge a speaker's adjacent turns → split long turns at their quietest point into ≤ 25 s chunks → Paraformer per chunk with token timestamps → the punctuation model adds punctuation, re-attached to the tokens → one voiceprint per voice from up to 60 s of speech, cosine-matched against the show's stored voiceprints.

**Export.** An ffmpeg filter script is generated from the kept ranges (`atrim`/`trim` + `concat`, a 20 ms fade at every splice). Audio goes through two-pass loudnorm; video applies `fps=30` once after the concat and then burns subtitles.

**Two faces.** The panel calls the host service through the `videoStudio` Typert Remote; the model calls the same service through the `./tool` entry's (row id `video-studio-tool`) `video_*` tools, a row granted per session only by the `dsh-video` preset (剪辑模式) in `@khorsheed/dsh-video-suite` and never mounted at the profile root. Panel edits are written into the project's `events`, and `video_read` hands the model every event since its last read. The 剪辑 tab self-hides on the session's preset: it shows only in sessions whose composition holds the `@khorsheed/dsh-video-studio/tool` row, failing open when the criterion is unreadable.

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
