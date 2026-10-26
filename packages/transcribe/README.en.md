# @khorsheed/dsh-transcribe

English | [中文](README.md)

Turns long recordings into timed text on this computer, and can tell who is speaking.

A two-hour podcast or a video without subtitles: getting a transcript used to mean uploading it to an online service or typing it out yourself. Local Transcription does it on your own machine, with a timestamp on every sentence, and separates the speakers in a conversation. You don't operate it directly: when Studio separates speakers and transcribes, or Reader makes a transcript for a video or podcast without subtitles, this is what runs.

## What it does

- **Long recordings become timed text**: every sentence is marked with the second it starts and ends, so checking it against the audio is easy.
- **Tells speakers apart**: conversations and interviews are split by speaker, and voices it already knows can be recognized by name.
- **Chinese and English**: it transcribes either, or works out the language by itself.
- **Text as it goes**: each stretch appears as soon as it is done — no waiting for the whole episode.
- **Stays on your computer**: recognition runs locally and the recording is never uploaded; temporary audio is deleted when the job ends.

## Install

In DSH, open Plugins → Add plugin, enter either suite's package name below, and click install:

```
@khorsheed/dsh-learning-suite
```

```
@khorsheed/dsh-video-suite
```

Local Transcription comes with the Learning Suite and the Video Editing Suite. There is nothing to set up: it steps in by itself whenever Studio or Reader needs a transcript.

## Known limits

- The computer needs `ffmpeg`; without it, recordings that must be decoded first can't be transcribed.
- The first time a language or speaker separation is used, its speech model downloads first, which takes a while.
- One job runs at a time; the rest wait in line.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- It provides one host service, `transcribe`, with no sidebar and no tools for the agent; how to call it, its methods, languages and models, and its config fields are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/transcribe/docs/reference.en.md). Probe with `ctx.get('transcribe')` first and degrade with a message when it's missing.
- Entry points: `src/index.ts` (the service), `src/speech-worker.ts` (the recognition child process). Standalone install: `dsh plugin --profile web add @khorsheed/dsh-transcribe`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
