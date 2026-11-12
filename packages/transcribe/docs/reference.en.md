# @khorsheed/dsh-transcribe — full reference

> The complete reference for plugin authors: calling the `transcribe` service, its methods, languages and models, configuration. Until 2026-10-26 this lived under "For developers" in the package README; the user-facing overview is the [README](../README.en.md).

English | [中文](reference.md)

It provides one host service, `transcribe`, with no sidebar and no tools for the agent. It may not be installed, so probe for it before use and degrade with a message when it's missing:

```ts
const transcribe = ctx.get('transcribe')        // undefined when not installed

const result = await transcribe.run(
  {
    input: { files: ['/path/episode.m4a'] },      // or { wav }: 16 kHz mono 16-bit
    language: 'auto',                             // 'zh' (default) | 'en' | 'auto'
    diarize: false,                               // or { voices, matchThreshold, numSpeakers }
    fromSec: 0,                                   // optional: resume this many seconds in; times stay absolute
    owner: '@khorsheed/dsh-reader',
    label: 'An episode',
  },
  { signal, onProgress: (p) => {}, onSegments: (segments) => {} },
)
// result.segments: [{ cluster, start, end, text, tokens: [{ text, start, end }] }]
// result.speakers: one per voice when separating (speech time, voiceprint, matched known voice)
// result.language: the dominant detected language
```

| Method | Does |
|---|---|
| `run(request, options?)` | Queues, runs and returns the result, downloading missing models first; `onSegments` fires as each stretch finishes |
| `speakers(request, options?)` | Separates speakers without transcribing (for when a transcript exists); returns at once when there's only one voice |
| `modelsFor(request)` / `missingBytes(ids)` | Which models a request needs, and how many bytes are still missing (0 = ready) |
| `prepare(ids, source?, signal?)` / `models()` | Download the missing models / read every model's install state; cancellation keeps valid partial files |
| `queue()` | The current queue, running job first |

- **One job at a time**: every caller shares one queue; aborting `signal` withdraws a queued job or stops a running one. Recognition runs in a separate child process, so a native module that fails to load fails only that job.
- **Languages**: Chinese uses Paraformer with CT-Transformer punctuation; English and auto-detect use SenseVoice. Speaker separation uses pyannote with CAM++ voiceprints, and you can pass known voiceprints to recognize people.
- **Models** download on first use into `$DSH_HOME/state/transcribe/models/` (only the ones the job needs), from Hugging Face or HF-Mirror, resumable and verified after download; models an earlier video-studio install downloaded are moved over.
- **Nothing is kept**: temporary audio is deleted when the job ends, and callers store the text themselves. It needs `ffmpeg` on this computer; without it, jobs that need decoding fail, but startup doesn't.
- **Configuration**: `stateDir`, `ffmpegPath`, `modelSource` (`auto` / `huggingface` / `hf-mirror`), `numThreads` (default 4).
- **Official speech provider**: when the 0.2.2-rc.2 composition provides `speechToText`, registers `transcribe-local` (Local Paraformer / SenseVoice) with `auto` / `zh` / `en`, preparation and cancellation. Input is the official 16 kHz mono PCM16 WAV, written under `$DSH_HOME/state/transcribe/tmp`, executed through the same `run()` queue and returned as complete text, audio seconds and inference seconds; the temporary file is removed on settlement. The official voice UI belongs to an experimental composition and is not installed by this package. Long recordings, segment callbacks and speaker separation remain on the original `transcribe` API.
