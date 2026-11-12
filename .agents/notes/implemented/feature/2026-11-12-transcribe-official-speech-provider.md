# Agent Note: expose the local transcription engine as an official speech provider

Status: implemented

English | [中文](2026-11-12-transcribe-official-speech-provider.zh.md)

## Problem

Host 0.2.2-rc.2 has a provider-neutral short-recording API and an experimental voice-input composition. The community `transcribe` service already owns Chinese Paraformer, multilingual SenseVoice, long-media decoding, speaker separation and a global serial queue. Reimplementing recognition for voice input would duplicate models and allow two native workers to run at once; replacing the service would discard its long-audio responsibilities.

## Decision

Register `transcribe-local` only when `speechToText` exists. The provider accepts the official `auto`, `zh` and `en` language hints, validates canonical 16 kHz mono PCM16 WAV input, writes it under the existing service's `tmp` directory and calls the same `modelsFor`, `models`, `prepare` and `run` methods. The returned text, audio duration and measured inference duration follow the official result contract; the temporary WAV is removed on every settlement. The official registry owns provider withdrawal and joining accepted work, and the provider disposes preparation with its registration.

Preparation offers the existing Hugging Face and HF-Mirror choices. It checks all models needed by the advertised languages, joins repeated requests and rejects a source change during active work. Cancellation now propagates through `TranscribeService.prepare`, `ModelManager.ensure`, source probing, HTTP fetch, the output stream and retry delays. Valid partial files remain resumable; cancellation does not masquerade as a completed install.

Older hosts and compositions without the experimental registry keep the original `transcribe` service without a hard dependency on the speech UI. Long files, ffmpeg, segment callbacks, speakers and the original queue API are unchanged. The experimental UI is not added to production by this change.

## Alternatives considered

**Call the native worker directly from a second provider.** Rejected: it would duplicate model management and break the one-job-at-a-time guarantee.

**Pass any WAV emitted by ffmpeg directly to the official API.** Rejected: ordinary ffmpeg output can contain a LIST metadata chunk. The official API deliberately requires canonical WAV; acceptance generates a standards-compliant PCM header rather than weakening that contract.

**Report cancellation without stopping a download.** Rejected: preparation cancellation must settle the underlying network/file work, not just change the visible state.

## Consequences

A real short Chinese recording generated locally was transcribed through the official registry as `你好，这是本地语音识别测试。`; it lasted 3.25525 seconds, inference took 2.518890542 seconds and the temporary directory was empty afterward. An attempted SenseVoice download failed with `fetch failed` and remained visibly uninstalled, so no English-model success is claimed. Chinese Paraformer, punctuation and VAD were already present and passed real native execution.

Package build and all 4 test files / 35 tests pass. Tests cover official registration and disposal, real WAV delegation, invalid input, cancellation state, and a local HTTP response-stream cancellation preserving its partial file. This change does not imply production deployment or publication.

## Related

- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Official-capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
