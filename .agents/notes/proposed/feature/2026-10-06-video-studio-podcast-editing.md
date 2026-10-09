# Agent Note: Video studio — transcript-first podcast and conversation editing

Status: proposed

## Problem

The user and their friends record casual chats, podcasts and conversations, and want to edit them inside dsh: talk about the cut in the conversation, adjust details in a right-sidebar panel, and export an episode. How they record shapes the whole design:

- **One mixed recording.** A group sits around one recorder or phone. Everyone is in the same audio file, so the editor has to work out who is speaking. A second device often films the table.
- **Long, talky material.** A raw session runs about 70 minutes and the episode should be about 50. Most of the work is removing filler words, long pauses, repeats and off-topic stretches. Fine frame-level editing is rare.
- **A recurring show.** The same people record week after week with the same intro music, loudness target and subtitle style, plus the occasional guest.
- **Audio and video matter equally.** Each episode ships as a podcast audio file and a full video, and later as vertical clips.

No package in this repo handles media. An interaction prototype went through six rounds with the user on 2026-10-06. It lives in the local, git-ignored `proposals/prototypes/video-studio-podcast.html`. This note records the decisions from those rounds and the first implementation slice.

## Proposal

### Shape: one package and one preset row

- **New package `@khorsheed/dsh-video-studio`** (`packages/video-studio`) has three faces:
  - **Host half:** a deployment-level project store, the media toolchain (ffmpeg, the speech models) and a background job queue. The browser panel reaches all of it through a Typert Remote (`videoStudio.*`).
  - **`./tool` subpath entry:** the model tools and a `video-studio` skill. This is the folded-companion pattern that worktrees and room use; there is no separate `*-tool` package.
  - **Browser half:** a page-type right-sidebar tab, 「剪辑」, built on `@khorsheed/dsh-client-ui-panel-kit`.
- **New preset row `dsh-video` (剪辑模式) in `@khorsheed/dsh-presets`.** It grants the `./tool` row and carries the editing guidance. The panel is a deployment-level workspace, like the canvas space, so it gets no session-preset self-hide. Its mode visibility is the install layer (docs/plugin-visibility.md).

### Nouns

- **Show (节目):** a recurring series. It owns the show settings: intro, outro and bed music, loudness target, subtitle style, shownotes format, editing habits (pause handling, filler list, per-speaker pause thresholds) and the **voiceprint list**. "Not part of a show" is a valid choice and falls back to the global defaults.
- **Project (工程):** one episode. A new project **copies** its show's settings, so later edits to the show affect only projects created afterwards. A project is deployment-level, not session-bound: a session opens one project at a time, and one project can be edited across many sessions.
- **Settings layers:** global → show → project. Later layers win. The panel's 设置 tab shows the effective value of every key and where it came from (沿用节目 / 这期改过 / 全局). A project override can be saved as the show default or reset to it.
- **Library (素材库):** a global folder of music and sound effects that all shows share. Show settings reference files in it by name.

### Edit model: cuts over the reference recording's time

The project's single source of truth is `project.json`. Every edit is a range over the **reference recording's own timeline**, so editing is non-destructive and nothing is re-encoded until export.

```ts
interface Project {
  id: string; showId: string | null; name: string; createdAt: string;
  settings: Settings;                        // snapshot taken at creation
  overrides: (keyof Settings)[];             // keys this project changed
  sources: Source[];                         // the recording, the video, music; paths only, files stay in place
  speakers: Speaker[];                       // origin: {kind:'diarization'} | {kind:'track', sourceId}  (multitrack hook)
  transcript: Segment[];                     // {id, speakerId, start, end, tokens:[{text, start, end, kind:'word'|'filler'}]}
  edits: Edit[];                             // {id, kind:'cut'|'shorten'|'gain', start, end, value?, origin:'user'|'agent', state:'proposed'|'applied'|'rejected', group}
  chapters: Chapter[];                       // M2
  events: PanelEvent[];                      // panel-side changes, read by the model on its next turn
}
```

- **Output time** is the reference timeline minus every applied cut and shortening. All exports and timestamps (shownotes, SRT) derive it mechanically. The model never computes them in its head.
- **A long pause** becomes a `shorten` edit to 0.6 s (user decision), not a cut.
- **Proposals are edits in state `proposed`.** Each one belongs to a `group` (one ✓/✗ unit). The panel draws them dashed and violet. Applying or rejecting a group is one call and is reversible.
- **Panel edits append to `events`.** The tools hand the model the events since its last read, so it does not overwrite what the user changed by hand.
- **Mixed recordings can't drop one voice.** A cut removes a time range from everyone. Separating overlapping speech needs a speech-separation model, deferred to M3. `speakers[].origin` is the hook for future multitrack input (one track per person, recognised by track). That path is planned but not built.

### Media pipeline

| Step | How | Notes |
|---|---|---|
| Probe | `ffprobe` | duration, streams, sample rate |
| Align video to recording | ffmpeg decodes both to mono 8 kHz; cross-correlate the first 3 min in JS | no clap needed |
| Proxy and peaks | ffmpeg → mono 16 kHz WAV (ASR input) + low-bitrate preview + JSON waveform peaks | kept under the project dir; cleaned 30 days after export |
| Diarization | `sherpa-onnx-node` offline speaker diarization (pyannote segmentation + 3D-Speaker CAM++ embeddings) | native prebuilt addon, no Python |
| Voiceprint match | the same CAM++ extractor; cosine match against the show's stored embeddings | new voices go to the user for naming |
| Transcription | `sherpa-onnx-node` offline Paraformer (zh, int8) on each diarized segment | FunASR's Paraformer weights in ONNX form |
| Filler, pause, repeat scan | rules over tokens and gaps: filler list from settings, per-speaker pause thresholds, adjacent duplicate n-grams | output is a proposal group |
| Loudness | ffmpeg `loudnorm`, two passes | −16 LUFS podcast, −14 video |
| Denoise | light/medium: ffmpeg `afftdn`. Strong: DeepFilterNet3 `deep-filter` binary (8.5 MB model) | M2. `afftdn` because `arnndn` needs ffmpeg ≥ 4.3 |
| Export | ffmpeg filtergraph built from the kept ranges (`atrim`/`trim` + `concat`), subtitles burned with `subtitles=` from a generated ASS file | MP3 with ID3 chapters, MP4, SRT, TXT |

**Models download on first use** into `$DSH_HOME/state/video-studio/models/` from the pinned sherpa-onnx GitHub release assets, with a sha256 check: Paraformer int8 ≈ 237 MB, CAM++ ≈ 28 MB, segmentation ≈ 6 MB. Global settings list each one with its size and state. While offline, or before the download finishes, transcription is unavailable but the rest of the panel still works.

**ffmpeg is found, not bundled.** The host looks for `ffmpeg` and `ffprobe` on PATH, or at a path set in global settings. If either is missing, import and export show a designed "install ffmpeg" state and the plugin still boots.

**Jobs.** Probing, proxies, diarization, transcription and export run as host jobs. Heavy jobs run one at a time, are persisted to the project, and are re-queued after a restart. The panel polls `videoStudio.jobs` for progress. Jobs are idempotent per input hash.

### Storage

```
$DSH_HOME/state/video-studio/
  shows/<showId>.json                 # settings + voiceprint index
  voiceprints/<showId>/<id>.f32       # CAM++ embeddings, local only
  projects/<projectId>/project.json
  projects/<projectId>/cache/         # proxies, peaks, ASR wav (disposable)
  models/                             # downloaded ONNX models
  settings.json                       # global layer: library dir, export dir, ffmpeg path, ASR engine
```

Voiceprints never leave the machine (user decision). The library and the default export directory are user folders, by default `~/Podcast/素材库/` and `~/Podcast/<show>/<episode>/`.

### Model tools (`./tool` entry, tagged with `setToolOrigin`)

| Tool | Purpose |
|---|---|
| `video_project` | list shows and projects; create a project (from a show template); open one for this session |
| `video_import` | add host-path sources; starts the probe, align, proxy and diarize/ASR jobs |
| `video_read` | read the project: sources, speakers, transcript window, edits, events since last read, output duration |
| `video_scan` | run the filler, pause and repeat scan with the current thresholds and return a proposal group |
| `video_propose_edit` | propose cuts, shortenings or gains, or speaker renames and merges, as one group |
| `video_render` | queue exports (audio, video, subtitles and text) and report their progress |

The session-to-project binding lives in the host store, keyed by session id. The tools read it, and the panel follows the active session's project when the panel opens.

### Panel (M1 tabs)

素材 (sources, speaker naming with ▶ sample playback, voiceprint matches, the job list) · 文稿 (transcript rough cut: click to cut or restore, filler and pause chips, proposal outlines) · 导出 · 设置 (three layers, voiceprint list with in-place delete confirm, model list). A project list grouped by show, with ＋新建工程, is the landing view when no project is open. One adaptive layout, compact under `@container dsh-panel (max-width: 560px)`. 在访达中打开 is hidden when `browserOnHost()` is false.

### Phases

1. **M1 (this note's first implementation):** package skeleton and preset row; shows, projects and the three settings layers; path import; video alignment; proxies; diarization, voiceprints and transcription; the 文稿 rough cut with scan proposals; export of MP3 (loudnorm) and MP4 with burned subtitles plus SRT/TXT; the M1 tools and skill; panel tabs 素材/文稿/导出/设置.
2. **M2:** chapters and structure proposals; the 时间线 tab (speaker-expanded lanes, ducking line, drag audio onto lanes); the 声音 tab (afftdn and DeepFilterNet denoise, per-speaker segment gain, A/B preview); browser drag-upload of small library files; the Bailian Paraformer cloud engine.
3. **M3:** vertical clips, speech separation for crosstalk, multitrack input, multi-camera, FCPXML export.

## Alternatives considered

**Python FunASR.** It gives the same models and the reference pipeline, but needs a managed Python environment with torch on every host, about 1 GB more, plus a second runtime to supervise. `sherpa-onnx-node` runs the same Paraformer and CAM++ weights from a prebuilt Node addon.

**whisper.cpp, or Groq Whisper as the default engine.** Neither does speaker diarization, and for a mixed recording diarization is not optional. Whisper's Chinese punctuation and simplified/traditional output are also less reliable than Paraformer's.

**Cloud-only transcription.** The audio is private conversation among friends, and a free quota (Bailian: 10 h/month) runs out in a few episodes. Cloud stays an opt-in engine for M2.

**ffmpeg.wasm in the browser.** It is too slow and memory-bound for hour-long files, and it would put the toolchain on the phone path too. The host already has the files.

**A conventional NLE timeline as the primary surface.** Podcast editing is mostly deciding which words to keep. A transcript-first cut over source time fits that, and the timeline view (M2) is a second view of the same edits.

**Project bound to a session.** One episode is edited across several sessions, and the panel must work with no session open. Deployment-level state is the canvas precedent.

**Separate panel and tool packages.** The repo folded companion tool rows back into their cores (worktrees 0.3.0, room 0.2.0). A `./tool` subpath row keeps one package, one name and one id.

**Bundling ffmpeg.** That adds 80 MB per platform and creates a licence question. Hosts that edit media already have ffmpeg, and a missing binary degrades cleanly.

## Acceptance criteria

M1 is done when, on a temp instance and then on 3080:

- In 剪辑模式, "周五又录了一期，素材在 <dir>" leads to a model proposal to create the project from the show template. Accepting it imports the files and starts the jobs, and the panel opens on 素材.
- A 70-minute mixed recording with 3–4 speakers gets diarized, matched to stored voiceprints (new voices are flagged for naming) and transcribed. Progress is visible.
- The 文稿 tab shows speaker-coloured paragraphs. Clicking a phrase cuts or restores it, and a scan proposal outlines fillers, pauses and repeats; ✓ applies them as one group and the output duration updates.
- A panel edit appears in the model's next `video_read` as an event.
- Export writes an MP3 at −16 LUFS ±1 with ID3 chapters (when chapters exist), an MP4 with burned subtitles whose cuts match the transcript, and an SRT whose timestamps follow output time.
- The 设置 tab shows the three layers with sources. "存为节目默认" and "恢复为节目默认" work, and deleting a voiceprint asks for confirmation in place.
- With ffmpeg missing or the models not yet downloaded, the plugin boots and the panel shows the designed missing state.
- `pnpm check:plugins`, `pnpm check:panels --package packages/video-studio`, `pnpm --filter @khorsheed/dsh-video-studio test`, and the presets tests all pass.

## Risks

- **A native addon inside a plugin.** `sherpa-onnx-node` ships per-platform optional packages (darwin-arm64 ≈ 34 MB). pack-dist and the tarball install path must carry the right one, or the addon must load lazily and degrade. This gets verified first, on the 3080 tarball path, before the rest of M1 builds on it.
- **Far-field diarization accuracy.** A recorder on a table gives uneven levels and room echo. Merge, split and per-sentence speaker reassignment are in M1 because errors are certain.
- **Old ffmpeg on hosts.** This machine has 4.2.2 (anaconda), so the filters chosen must exist in 4.2. A minimum version check reports what is missing.
- **Disk.** Proxies and ASR WAVs take a few hundred MB per episode. A 30-day cleanup after export is the default, and cleanup never touches sources.
- **Long jobs across restarts.** Jobs are idempotent and keyed by input hash. A crash mid-job means a re-run, never a corrupt project, because `project.json` is written atomically.
- **Given up for now:** removing one voice from overlapping speech, multitrack input, and cloud ASR. Each is deferred and has a hook in the data model.
