# Agent Note: video-studio — resumable, integrity-pinned model downloads

Status: implemented

## Problem

The four speech models (~330 MB) download from the k2-fsa/sherpa-onnx GitHub Releases, which is slow and flaky from typical Chinese dev networks (observed ~58 KB/s, with SSL drops recorded in a local `download.log`). The old downloader (`src/media/models.ts`) deleted the `.part` file on any failure and restarted every retry — and every host restart — from byte zero. With no checksums pinned, a resumable design also had no way to trust spliced bytes. The voice-input bundle upstream (harness `speech-to-text-sensevoice`) has mirror-source selection but likewise no byte-level resume, and its downloader is package-private with no shared module to import.

## Decision

Byte-level resume with verified publish, all inside `models.ts`:

- `fetchWithResume(url, part, {bytes, sha256?}, onProgress)` keeps the `.part` file across failures, sends `Range: bytes=<size>-` when a partial exists, validates `Content-Range`, appends on 206, truncates on 200 (server ignored Range), and skips the request entirely when a complete leftover only needs verifying. Progress resumes from the on-disk byte count.
- Integrity is pinned per file in `MODELS`: every downloaded file carries `bytes` + `sha256`, taken from the HF repos' LFS oids and cross-checked against a known-good local install.
- Failure taxonomy drives `.part` disposal: network/stream/HTTP errors and short reads keep the partial (valid prefix, resume on retry); a sha256 mismatch or failed `tar` extraction means the complete file is bad, so `CorruptDownloadError` deletes it before the next attempt.
- Restart visibility: `refresh()` reports leftover `.part` bytes as `ModelStatus.partial`, and the panel's model list shows 未安装 · 已下载 x%，将续传. `ensure()` already runs before transcription and from the download button, so both paths resume automatically.

## Alternatives considered

- **Port the sensevoice downloader wholesale** (preparation state machine, streamed progress): rejected — video-studio is the repo's only model downloader (a shared package is premature abstraction) and the panel's existing 8–15 s overview polling is sufficient for progress. The ideas worth porting (origin probing, streaming sha256, atomic publish, failure taxonomy) were taken; the apparatus was not.
- **gh-proxy style prefix proxies as the GitHub mirror**: rejected — the only candidates are third-party relays (one tested dead from the dev network), and byte-identity to the release asset is unprovable. HuggingFace turned out to host every model byte-identically (proven by hashing the user's working install against HF LFS oids), so a trustworthy mirror exists and proxies are unnecessary.
- **Download in a detached child process so host restarts don't interrupt**: rejected — orphan-process management and progress re-attachment cost far more than resume saves.

## Mirror sources (update)

After the resume work landed, every model turned out to have a byte-identical HuggingFace home (csukuangfj official repos for three; a community re-upload for the int8 punctuation model, proven identical by hashing the user's working install against HF LFS oids). The GitHub release channel was therefore **dropped**, not kept as a third option: the HF per-file channel needs no untar step and is sha256-pinned end to end, while the GitHub paraformer archive could never be pinned (no published digest, archive bytes unreconstructable from the extracted tree). The source setting mirrors the voice-input bundle exactly — 自动选择（推荐）/ Hugging Face / HF-Mirror（国内镜像）— with `auto` as a real option rather than a hidden persisted default, because the probe runs at download time and reflects the network the machine is on *then*; a stored guess goes stale. Legacy `.tar.bz2.part` leftovers are swept on the next download run (they can never be resumed).

## Consequences

- A host restart or network drop mid-download costs nothing on the next attempt; the retry loop resumes instead of restarting, and a failed origin falls back to the next one.
- A corrupt partial is detected at verification, never silently published; every file of every model is sha256-pinned.
- `ModelStatus` gains `partial?: number` and `GlobalConfig` gains `modelSource` (both wire-compatible: additive, optional/with default; a stale persisted `github` value falls back to auto).

## Testing

`tests/models.spec.ts` (new): fresh download, Range resume with whole-file hash verification, Range-ignored truncation, request-free verification of a complete leftover, corruption vs short-read classification, `refresh()` partial reporting, source probing order, and HF per-file install with resume/reuse — against local Range-capable HTTP servers. `tests/core.spec.ts` adds a failed-job retry-reuse case. Full package suite 29/29 green; `pnpm --filter @khorsheed/dsh-video-studio build` green.
