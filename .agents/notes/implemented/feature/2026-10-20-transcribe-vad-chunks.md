# Agent Note: cutting recordings at real pauses

Status: implemented

## Problem

Local transcripts broke sentences apart: "…Chinese history another." / "Entity is talking to me…" landed in two paragraphs, a paragraph began with half a word ("m and the model"), and a word doubled across a cut ("psychologicalychological"). Without speaker separation the engine cut a recording into ≤ 25 s chunks at the quietest 50 ms in the middle half of each window — not necessarily a pause — and SenseVoice treats every chunk as a complete utterance, closing it with a period and capitalizing the next one. The reader merges paragraphs at sentence ends, so an invented period became a paragraph break. Reported by the user on the 115-minute NYU interview (BV1omhd6iEQQ).

## Decision

- **Cut at real pauses.** Jobs without speaker separation run Silero VAD (v4, `csukuangfj/vad`, 1.8 MB, sha256-pinned, model id `vad`) over the recording (min silence 0.25 s), then `planChunks` groups the speech into chunks of at most 25 s, cutting in the LONGEST pause that leaves a chunk of at least 8 s — a long pause is where a sentence most likely ended. Chunks keep 0.15 s of lead-in and tail. A stretch of speech with no pause longer than 25 s falls back to the quietest-point split.
- **Repair the seams that are not sentence ends.** When the pause before a chunk is under 0.35 s (or zero, a fallback cut), the previous chunk's closing period is removed and the next chunk's capital lowered (`repairSeam`; question marks and "I" are kept). A segment is therefore streamed one chunk late.
- **Space across the seam.** SenseVoice gives a chunk's first word no word-start mark, so it glued onto the previous chunk's last word ("on" + "some"); a Latin first token now gets a leading space.
- **Long run-on sentences close anyway** (reader, `cuesFromSegments`): SenseVoice punctuates English sparsely, so a "sentence" ran 90 s and made one huge paragraph; past 20 s it closes at a comma, past 30 s at a 0.4 s pause between words, and by 45 s regardless.
- **A small model downloads without asking.** The reader asks before a model download only above 20 MB, so adding the VAD to an install that has everything else does not interrupt.
- Speaker-separated jobs (video-studio) are unchanged: their chunks are the diarizer's turns.

## Measured (2026-10-20, BV1omhd6iEQQ, 115 min)

Before: the passage at 5:14–5:41 read "…history another." / "Entity is talking…" across two paragraphs, with "m and the model" and "P psychologicalychological". After: "…Chinese history, another entity is talking to me about, I don't know, baseball…" in one paragraph; no half-word starts in the passage. Whole run 150 s (audio fetch included).

## Alternatives considered

**Re-punctuating the whole English transcript with the CT-Transformer.** Rejected: it emits Chinese punctuation for English (measured earlier: "chatbots。 the ability，").

**Overlapping chunks and de-duplicating the overlap.** More robust in principle, but needs token alignment across chunks; the pause-based cut removes most of the problem at a fraction of the cost.

## Consequences

- Existing transcripts keep their old cuts until 重新转写.
- The VAD runs over the whole recording up front (fast: a 115-minute file is a few seconds).
