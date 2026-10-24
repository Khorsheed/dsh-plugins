# @khorsheed/dsh-transcribe

English | [中文](README.md)

Turns long recordings into timed text on this computer, and can tell who is speaking.

You don't need to install this yourself: it comes with the Writing, Learning and Video Editing suites. The studio's speaker separation and transcription, and the transcripts the inspiration space makes for videos and podcasts without subtitles, all run on it. The rest of this page is for plugin authors.

## Compatibility

Needs DSH 0.1.5 or later; verified on 0.2.1.

## For developers

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
| `prepare(ids, source?)` / `models()` | Download the missing models / read every model's install state |
| `queue()` | The current queue, running job first |

- **One job at a time**: every caller shares one queue; aborting `signal` withdraws a queued job or stops a running one. Recognition runs in a separate child process, so a native module that fails to load fails only that job.
- **Languages**: Chinese uses Paraformer with CT-Transformer punctuation; English and auto-detect use SenseVoice. Speaker separation uses pyannote with CAM++ voiceprints, and you can pass known voiceprints to recognize people.
- **Models** download on first use into `$DSH_HOME/state/transcribe/models/` (only the ones the job needs), from Hugging Face or HF-Mirror, resumable and verified after download; models an earlier video-studio install downloaded are moved over.
- **Nothing is kept**: temporary audio is deleted when the job ends, and callers store the text themselves. It needs `ffmpeg` on this computer; without it, jobs that need decoding fail, but startup doesn't.
- **Configuration**: `stateDir`, `ffmpegPath`, `modelSource` (`auto` / `huggingface` / `hf-mirror`), `numThreads` (default 4).
- Standalone install: `dsh plugin --profile web add @khorsheed/dsh-transcribe`. Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
