# Agent Note: video and audio in the reader, polished

Status: implemented

## Problem

After the first day with videos (`2026-10-20-reader-video-audio`, `2026-10-20-reader-local-transcription`) the user reported: the card looked like an article; the video filled a wide sidebar and left a few lines of transcript; there was no way to translate a transcript sensibly; and nothing said that a paragraph's time was a control. Prototype: `proposals/prototypes/reader-media-polish.html` (round 1, decided the same day: Bilibili stays the external player and only seeks — option A; no summary line on media cards; one global auto-translate preference).

## Decision

- **Cards stay as tall as an article's.** The wall is an equal-height grid (meta, title two lines, summary two lines, pills). A media card with a cover puts the cover in the third column across the title and summary rows and drops the summary, so its height matches; narrow rows put it right of meta + title. YouTube uses its 16:9 `mqdefault` still; other covers load with `no-referrer` (Bilibili's image host refuses a foreign referrer).
- **The card's pill is the transcript's state**, read through a new Remote `mediaStates` (a live local job first, else the `media.json` captions record), re-read every 3 s only while a card is transcribing.
- **One control row; the times in a column.** 字幕 · 收起视频 · source/status, Bilibili's limitation behind an ⓘ. The tab is 转写稿. Transcript paragraphs carry a 72 px left padding with the time chip absolutely placed in it, a ▶ before the time and a "play from" tooltip; a one-time hint (localStorage) says the time plays.
- **The mini bar is the same frame, resized.** Scrolling past 160 px shrinks a video to an 88 px picture with the title and the time (YouTube adds play/pause and a progress line); back near the top it opens; 收起视频 pins it until ⌃. Resizing an iframe by CSS keeps it playing — nothing reloads.
- **Following stops on a hand gesture, not on any scroll.** wheel / touchmove / scroll keys stop it, and only while playback is actually advancing; 回到正在播放 resumes. Measured in the preview: shrinking the player scrolls the body, so a plain `scroll` listener stopped following by itself. The 6 s auto-resume and the 跟随 switch are gone.
- **Translation waits for the whole transcript.** While transcribing, the globe is disabled (the body is replaced every poll). 转完自动翻译 (one global localStorage preference, off by default, also in the globe menu) starts the side-by-side view when a complete transcript is shown — only when the language pair is already `available`, because building a session that must download needs a click.

## Alternatives considered

**A cover on top of the card.** Rejected in the prototype: taller than its neighbours, the grid's rows stop lining up.

**Playing Bilibili through our own player for two-way sync** (option B). Rejected by the user for now: low resolution, traffic through the host, a grey area.

## Consequences

- Without a cover a media card keeps the old shape (summary and the ▶/♪ kind pill).
- On a device without the translation model installed, auto-translate does nothing until the reader clicks the globe once.
