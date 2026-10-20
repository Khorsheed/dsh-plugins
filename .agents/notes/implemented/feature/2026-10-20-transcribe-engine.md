# Agent Note: the local transcription engine as a shared plugin

Status: implemented

## Problem

The inspiration space needs local speech recognition for videos and podcasts without captions (Bilibili's captions need a login; Xiaoyuzhou has none), and video-studio already had a working sherpa-onnx pipeline buried in its own package. Two copies of a native dependency, a model set and a CPU-heavy job runner would compete for the same machine. Step 1 of `proposals/active/2026-10-20-transcribe-engine.md`.

## Decision

- **One engine, `@khorsheed/dsh-transcribe`, providing the host service `transcribe`.** The worker (`speech-worker.ts`, `speech-worker-core.ts`, `speech-protocol.ts`, `speech.ts`) and the model manager (`models.ts`) moved over with `git mv`; video-studio keeps projects, editing, alignment, export and its panel. No browser half, no model-facing tool.
- **Consumers restate the interface they call; no code edge.** Measured: `gen-typert` only resolves sibling types for packages that ship a `./typert` face, so a type-only import of `@khorsheed/dsh-transcribe/types` from video-studio's host files fails generation with TS2307. video-studio declares a small structural `TranscribeEngine` (four methods), probes `ctx.get('transcribe')` per job, and names the package in `dsh.references` (its user-facing message names it). The panel shows a 需要「本机转写」 notice and 分人与转写 jobs fail with it when the engine is absent; editing and export are untouched.
- **`run(request, options)` with an internal queue.** One job at a time across every consumer, in order; aborting withdraws a queued job or kills the running child; `onSegments` streams finished stretches; `onProgress` reports an overall 0–1 with a stage. The engine keeps no transcripts; a temporary decoded WAV is deleted when the job ends. A caller may hand a ready 16 kHz WAV (`{ wav }`) — video-studio does, because the same file is its panel player's audio proxy.
- **Languages.** `zh` → Paraformer + CT-Transformer punctuation (the existing path, per-character timing). `en` / `auto` → SenseVoice **2024-07-17** int8. Measured 2026-10-20 with the newer 2025-09-09 int8 release: English came back upper-case, unpunctuated and tagged `yue`; 2024-07-17 cases, punctuates, tags `en`/`zh` correctly, and both return per-token timestamps (the proposal's open question), so SenseVoice's own tokens are used as is.
- **Speaker separation is optional.** Without it the recording is one turn split into ≤ 25 s chunks at the quietest point, each streamed as a segment (cluster 0); with it, the existing diarize → merge → consolidate → per-turn ASR → voiceprint path, each turn streamed.
- **Only the needed models.** `modelsFor(language, diarize)`; `ModelManager.ensure(source, ids)` chains passes instead of joining an unrelated one. The model id `asr` became `paraformer`.
- **Models move, never re-download.** On first use the engine renames whatever `$DSH_HOME/state/video-studio/models/` holds into `$DSH_HOME/state/transcribe/models/` (same disk) and removes the empty old directory.
- **Latin words keep their spaces.** Paraformer spells English as BPE pieces with no separator (`lar@@ ge lan@@ gu@@ age`); a piece that starts a Latin word now gets a leading space, and `attachPunctuation` matches across whitespace on either side.

## Alternatives considered

**Register into the official `speechToText` registry.** Rejected (proposal D4): short utterances only, no timestamps, no long jobs.

**A type-only dependency edge (the room → local-agent shape).** Rejected for now: it needs a `./typert` face on the engine or a change to the shared generator, for four method signatures.

**The engine also fetching page URLs with yt-dlp.** Deferred: the reader already manages yt-dlp and downloads the audio itself, so the engine's input stays local files.

## Consequences

- Installing video-studio without the engine leaves transcription unavailable (stated in the panel); `deploy:3080` must ship both.
- A running 3080 with the pre-move video-studio loses its models directory the first time the new engine runs on the same `$DSH_HOME` — harmless once both are deployed together.
- `sherpa-onnx-node` is now a dependency of the engine only.
