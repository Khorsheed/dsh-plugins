# Agent Note: speakers in local transcripts

Status: implemented

## Problem

A local transcript of an interview ran both voices together: nothing said who spoke, and a paragraph could hold the end of one person's answer and the next person's question. The engine could already diarize (video-studio uses it), but measured 2026-10-20 on the 115-minute NYU interview (BV1omhd6iEQQ) a diarized transcription took 1205 s against 150 s without — too slow to make the reader wait for. User decisions the same day: show the transcript first and add the speakers afterwards; run it automatically; find a cheap way to skip one-voice recordings.

## Decision

- **Transcript first, speakers after.** The local job stores the transcript as before, then — on the audio still at hand — asks the engine's new `speakers()` (who spoke when, no recognition) and re-stores the transcript cut by speaker. The source line says 正在区分说话人… meanwhile; leaving lets it finish.
- **A one-voice probe before any diarization.** The engine embeds 24 windows (≤ 8 s each, from speech of at least 3 s, spread evenly over the recording; the transcript's own stretches are the speech regions, so no VAD runs) with CAM++ and groups them greedily at cosine 0.5. One group: a single voice, done. Measured: a 40-minute monologue's windows scored ≥ 0.65 against each other, the interview's host and guest 0.27–0.40; the probe takes under a second.
- **Several voices: voiceprint clustering, not pyannote.** First shipped with pyannote + CAM++; measured on the same interview the speakers pass then took 23 minutes (a 3.2-hour video ran past 40 and was lost to an unrelated restart). Now the speech segments' CAM++ prints (≤ 8 s from each segment's middle) are merged agglomeratively at cosine 0.7, voices under 5% of the speech dropped, every 1.5 s window (0.75 s hop) takes its nearest voice, and a majority over ±5 windows smooths it. Measured: 201 s for the 115-minute interview (while another job shared the CPU), 98% agreement with pyannote, and the turn changes land on the sentence (4:06, 6:56) where pyannote was half a sentence late; a 40-minute monologue stays one voice. video-studio's 分人与转写 keeps pyannote.
- **Words take their speaker's turn**, the turn covering each token's middle (else the nearest); a run of one voice shorter than 2.5 s is folded into the voice before it (diarizer wobble at boundaries would otherwise split sentences). A paragraph never crosses a change of voice; each carries `data-spk` (index in order of appearance).
- **Showing it.** A hairline in the speaker's colour on every paragraph; the speaker's name opens the paragraph where the voice changes (CSS content, so selections and translation never take it); a legend above the tabs names the speakers — click to rename, kept per entry in `media.json` (`names`), surviving a re-transcription that finds the same number of voices. The snapshot the agent reads is `[mm:ss] 嘉宾：…`.

## Alternatives considered

**pyannote for the speakers pass.** Shipped first; replaced the same day for its cost (above).

**Diarize in the same pass as the transcription.** Rejected: 8× slower before the reader can read anything.

**A button to start it.** The user chose automatic; the probe makes the automatic pass cheap where it would be wasted.

## Consequences

- Platform-caption videos get no speakers (their audio is never fetched).
- A guest who speaks only briefly can fall between the probe's windows and be missed; the transcript then stays one voice.
- The speakers pass holds the audio file (temporary) until it ends.
