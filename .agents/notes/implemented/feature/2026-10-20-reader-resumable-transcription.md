# Agent Note: local transcription survives a restart

Status: implemented

## Problem

A local transcription job lived in host memory. Every `deploy:3080` restarts the instance, and several agents deploy to it in a day: on 2026-10-20 a 3.2-hour video's speakers pass, forty minutes in, was lost to another plugin's deploy, and the reader showed nothing — the entry needed 重新转写 and the whole run again.

## Decision

- **The job's temporary directory is its record.** Next to the downloaded audio, `job.json` holds what the job is (entry, URL, media, title), where the audio is, and the phase (`transcribe` until the transcript is stored, then `speakers`); `segments.json` holds the stretches transcribed so far, rewritten every 15 s and at the end of transcription.
- **A new process resumes what it finds.** At construction the reader keeps the `audio-*` directories that carry a `job.json` (directories older than a day, or without a record, are removed), waits for the `transcribe` service (it is another plugin and may be provided later; up to ten minutes), and re-queues each: with the audio present it does not download again; a `transcribe` job continues from where its saved segments end — the engine's new `fromSec` decodes from that point (`-ss` before the input) and returns absolute times; a `speakers` job reruns the speakers pass on the stored segments.
- **Shutdown keeps the record, everything else ends the job.** `dispose` aborts the running work without deleting the directory; done, failed and cancelled jobs remove it.
- Reopening the entry shows the resumed job through the existing rejoin (`2026-10-20-reader-speakers`).

## Measured

The 115-minute NYU interview killed with `kill -9` at 51% (224 segments saved, up to 62:29), then a fresh process: it resumed without downloading, transcribed from 62:29 and ran the speakers pass, 321 s in all; the paragraph across the seam reads continuously.

## Alternatives considered

**An index file listing the jobs.** Rejected: one more thing to keep in step with the directories; the directory already is the unit that lives and dies with the job.

**Resuming the speakers pass mid-way.** Not worth it: it takes minutes now (`2026-10-20-reader-speakers`).

## Consequences

- A resumed job runs even if nobody reopens the entry — the reader started it, so it finishes.
- A process killed between a segment and the next save re-transcribes at most 15 s of work.
