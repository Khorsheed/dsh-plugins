# Agent Note: video and audio entries in the reader

Status: implemented

## Problem

The reader read articles only. Videos (YouTube, Bilibili) and audio (podcast feeds, Xiaoyuzhou) were either fetched as web pages — a watch page "extracted" into junk — or not reachable at all, and none of the reader's reading tools (notes, discussing them, quiz-me, canvas sync, the model's `reader_read`) could work on them. This is V1 of `proposals/active/2026-10-20-reader-video-audio.md`: platform captions, a player, timed notes; local transcription is V2 (`2026-10-20-transcribe-engine.md`).

## Decision

- **The transcript is the body.** Captions are parsed (YouTube json3 / rolling VTT, SRT, Bilibili JSON — `src/captions.ts`), merged into paragraphs (punctuated: a sentence end once ≥ 15 s, a 2.5 s pause, or 60 s; unpunctuated — YouTube's automatic captions carry no punctuation at all — a 0.7 s pause once ≥ 15 s, or 35 s), and rendered as `<p data-t="seconds">`. Notes, highlights, translation, the ¶ snapshot and `reader_read` all work on it unchanged; the snapshot prefixes `[mm:ss]`.
- **Kind per item, never per source.** `media.ts` decides from a feed enclosure (RSS `<enclosure>`, Atom `link rel=enclosure`, iTunes duration / artwork), a recognized link (YouTube / Bilibili video, Xiaoyuzhou episode), or a saved link's synthetic page. A page with prose stays an article even when it embeds a video.
- **Media links become sources the reader already understands.** A single video or episode is a `link` source whose payload is a synthetic page (`media-host.ts`) carrying `<meta name="dsh-reader:media">`; a YouTube channel and a Xiaoyuzhou podcast page are turned into RSS on every fetch. Nothing downstream knows a new source kind.
- **yt-dlp is the plugin's own.** Measured 2026-10-20: the machine's 2023 yt-dlp, and the 2025 build pip can still install on its Python 3.9, both fail on YouTube (captions need the current extractor, a PO-token-free client and a JavaScript runtime). The reader keeps the official STANDALONE release under `<state>/bin/` (fetched with curl — which honors the deployment's proxy environment, unlike Node's fetch — and `-U` after two weeks), hands it Node as the JS runtime, and only ever asks for metadata, captions and flat listings with `--skip-download`. `ytdlpPath` overrides it.
- **Captions on open, kept.** Opening a video reads its stored transcript, else `mediaTranscript` fetches the original-language track (uploaded first, then the `-orig` automatic track — the translated auto tracks are what trip YouTube's 429), stores it without a TTL, and remembers a caption-less video in `media.json`. Audio shows its shownotes until V2. The article paths (fetch, backfill, persist) never run for a media entry, and the backfill skips media URLs host-side too.
- **The player.** YouTube's embed in a frame of the plugin's own (`allow-scripts allow-same-origin allow-presentation`, strict-origin referrer — the article body's strict sandbox breaks it), driven over postMessage: `seekTo` / `playVideo`, and `infoDelivery` reports the current time about four times a second (measured), which marks the playing paragraph (`data-now`) and follows it; a hand scroll pauses following for 6 s. Bilibili's external player has no control channel and reports nothing (measured), so a seek reloads it with `t` and there is no following. Audio is the native element. Positions are remembered per entry in `localStorage`; the 字幕 switch (per entry) hides the transcript.
- **Time chips without text.** Each paragraph gets a `<button data-reader-ts data-label>` whose label is CSS `content: attr(data-label)` — a selection, and so a note's excerpt, never contains the time, and `translate.ts` skips it (`data-reader-no-translate`).
- **Notes carry their moment.** `ReaderNoteAnchor.time` is the paragraph's start; ▶ on a note plays from it; the discussion draft and `reader_read` show `[mm:ss]`.

## Alternatives considered

**YouTube's own channel feed (`feeds/videos.xml?channel_id=`).** The channel page still advertises it, but it answers 404 (measured on three tries); a yt-dlp flat listing with `youtubetab:approximate_date` replaces it.

**Bilibili uploader subscriptions.** The space listing is rejected (`352`) without a login, as are most captions; deferred until a cookie setting is worth its weight.

**Downloading the video or audio to play it locally.** Rejected: the platform players play it, and nothing but captions and metadata is ever fetched; audio is downloaded only by V2's transcription, and deleted after.

**A source kind per platform.** Rejected: synthetic pages and synthesized RSS keep every existing path (refresh, dedupe, recent, notes) working unchanged.

## Consequences

- A video with captions is readable, searchable, notable and discussable like an article; one without captions (and all audio) waits for V2.
- One more binary (~35 MB) and two state files (`media.json`, `bin/`) under the reader's state root; the first caption fetch on a machine pays the download.
- Bilibili videos jump by reloading the player and are not followed; uploader subscriptions are not supported.
- Unpunctuated automatic captions read as ~30 s blocks that can split a sentence.
