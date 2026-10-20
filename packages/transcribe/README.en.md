# @khorsheed/dsh-transcribe

English | [中文](README.md)

Turns long recordings into **timed, optionally speaker-separated** text on this machine. It is a host service, `transcribe`, that other plugins call in code — video-studio's speaker separation and transcription, and the inspiration space's caption-less videos and podcasts, both run on it. It has no panel and no model-facing tool of its own.

## Features

- **Chinese and English** — Chinese goes through Paraformer + CT-Transformer punctuation (finer per-character timing); English and auto-detected speech go through SenseVoice (punctuated and cased on its own, detecting zh / en / ja / ko / yue). Both give per-token timestamps.
- **Optional speaker separation** — pyannote segmentation + CAM++ voiceprint clustering, then over-split speakers merged back on their voiceprints; known voices can be passed in to be recognized.
- **Cuts at pauses** — without speaker separation, Silero VAD finds the speech and chunks are cut in the longest pauses (25 s at most); where a cut falls in almost no pause, the period the recognizer invented there is removed, so one sentence is not split in two.
- **Streams as it goes** — a job advances stretch by stretch, and each finished stretch reaches the caller through `onSegments`, so a long recording does not wait for its end.
- **One at a time, queued, cancellable** — every consumer shares one queue; aborting the `AbortSignal` withdraws a queued job or stops a running one. Recognition runs in a child process, off the host's event loop.
- **Models download on first use** — from Hugging Face or the HF-Mirror China mirror (auto probes for the fastest reachable source), resumable, verified against pinned byte sizes and sha256 hashes. Only the models a job needs are fetched.
- **Keeps no transcripts** — the temporary decoded WAV is deleted when the job ends; the text is the caller's to keep.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-transcribe
```

The package declares `dsh.bundle`, so add merges its `cordis.patch.yml` row (loader row id `transcribe`) into the profile. Needs `ffmpeg` on the host (on PATH, or set `ffmpegPath` in the plugin config).

```sh
dsh plugin --profile web remove @khorsheed/dsh-transcribe
```

## Service API

```ts
const transcribe = ctx.get('transcribe')   // undefined when not installed: the caller says so and degrades

const ids = transcribe.modelsFor({ language: 'en' })     // the models this request needs
await transcribe.missingBytes(ids)                         // bytes still to download (0 = ready)

const result = await transcribe.run(
  {
    input: { files: ['/path/episode.m4a'] },   // or { wav } — already 16 kHz mono 16-bit
    language: 'auto',                          // 'zh' (default) | 'en' | 'auto'
    diarize: false,                            // or { voices, matchThreshold, numSpeakers }
    owner: '@khorsheed/dsh-reader',
    label: 'An episode',
  },
  {
    signal,                                    // withdraw / stop
    onProgress: (p) => {},                     // { stage, progress: 0–1, ahead? }
    onSegments: (segments) => {},              // stretches just finished
  },
)
// result.segments: [{ cluster, start, end, text, tokens: [{ text, start, end }] }]
// result.speakers: one per cluster when separating (speech time, voiceprint, matched known voice)
// result.language: SenseVoice's dominant detected language
```

| Method | Does |
|---|---|
| `modelsFor(request)` | The model ids a request needs |
| `models()` | Every model's install state (re-read from disk) |
| `missingBytes(ids)` | Bytes these models still need |
| `prepare(ids, source?)` | Download the missing ones; check `models()` for failures after |
| `run(request, options?)` | Queue, run, return the result; downloads missing models first |
| `queue()` | The queue, running job first |

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `stateDir` | `$DSH_HOME/state/transcribe` | Where models and temporary files live |
| `ffmpegPath` | found automatically | A specific ffmpeg |
| `modelSource` | `auto` | `auto` / `huggingface` / `hf-mirror` |
| `numThreads` | `4` | Threads per recognizer |

## Models

| Model | For | Size |
|---|---|---|
| Paraformer Chinese (int8) | Chinese ASR | 243 MB |
| CT-Transformer (int8) | Chinese punctuation | 80 MB |
| SenseVoice 2024-07-17 (int8) | English and auto language | 240 MB |
| Silero VAD v4 | Cutting at real pauses without speaker separation | 2 MB |
| pyannote segmentation 3.0 | Speaker separation | 6 MB |
| CAM++ | Voiceprints | 28 MB |

Models live under `$DSH_HOME/state/transcribe/models/`. Models an earlier video-studio downloaded to `$DSH_HOME/state/video-studio/models/` are moved over on first use, never re-downloaded.

## Compatibility

- **Host**: `>=0.1.5-rc.1`, verified on 0.2.1-rc.1. Host service only — no browser half, no model tool — composed at the profile root.
- **Native dependency**: `sherpa-onnx-node` ships prebuilt per-platform addons (about 34 MB on darwin-arm64). Recognition runs in a child process, so an addon that fails to load fails that job only, never boot.
- **ffmpeg**: when missing, jobs that need decoding fail; jobs handed a WAV still run; boot is unaffected.
- **Consumer probing**: video-studio and the inspiration space call `ctx.get('transcribe')` whenever they need it and each degrade with a message when it is absent — its absence never fails a boot.
