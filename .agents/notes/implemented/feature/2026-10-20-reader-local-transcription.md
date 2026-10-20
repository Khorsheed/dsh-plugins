# Agent Note: local transcription in the reader

Status: implemented

## Problem

V1 (`2026-10-20-reader-video-audio`) read videos through their platform captions, but most Bilibili captions need a login (measured: `352` without one) and podcasts and Xiaoyuzhou have none, so those entries could only be watched, heard and read about. The user chose local transcription over storing a Bilibili login for now (2026-10-20: "先走1，后续我们再讨论要不要在插件里做登录态的记录"). This is V2's reader half, on the engine of `2026-10-20-transcribe-engine`.

## Decision

- **Automatic on opening the detail, never on refresh** (round-4 decision). The pane opens a media entry as before: a stored transcript is the body; else a video asks for platform captions; when there are none (or for audio), `useLocalTranscript` starts a host job once per entry.
- **The host runs the job** (`src/local-transcribe.ts`): fetch the audio into `<state>/tmp/audio-*` — yt-dlp's smallest audio-only format for a video (`wa[acodec!=none]/ba/b`, the picture is never downloaded), curl for an audio URL (curl honors the deployment's proxy environment) — then the engine's `run` with `language: 'zh'` for Bilibili and Xiaoyuzhou (Paraformer, the models video-studio already had) and `auto` elsewhere (SenseVoice), no speaker separation (V3). The temporary directory is removed when the job ends.
- **What is done reads at once.** The engine streams its ≤ 25 s stretches; the host re-cuts them into sentences (across stretch boundaries) and merges them with the same `mergeCues` platform captions use, so the browser's 1.5 s poll replaces the body with the transcript so far. Paragraphs carry `data-src="local"`, which the 来源 line reads (来源：本机转写) — no second record needed.
- **Leaving withdraws only a queued job** (the prototype's rule): a job still fetching or queued is aborted; a running one finishes and is stored (`storeEntryBody` with `keep`, and `media.json` records `local`), so reopening later shows it. The 字幕 switch and 取消 stop it outright; 重新转写 starts again.
- **One confirmation for the first model download.** `start` answers `needs-models` with the byte count until called with `confirmModels`; the engine then downloads and runs in the same job.
- **No code edge to the engine.** The reader restates the four-method interface it calls and probes `ctx.get('transcribe')` per start; without the engine the line says the item has no captions and names the plugin. The mode packs that carry the reader (learning, writing) carry the engine as a member.

## Alternatives considered

**Reading the browser's Bilibili cookies, or a login setting.** Deferred by the user; local transcription covers caption-less videos without holding a credential.

**Pushing progress to the browser.** Rejected for now: the reader has no event channel to the pane, and a 1.5 s poll of an in-memory status is cheap; the poll stops when the job does.

**Keeping the shownotes beside an audio transcript.** Not done: the transcript replaces the body, as captions do for videos; the prototype's open question (keep a 简介 tab) stays open.

## Consequences

- A job lives in host memory: a restart drops a running job (reopening the entry starts it again); a finished transcript survives as the stored body.
- Bilibili's per-video language is assumed Chinese; an English Bilibili video gets Paraformer's output until a language hint exists.
