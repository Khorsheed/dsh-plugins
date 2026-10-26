# @khorsheed/dsh-reader

English | [中文](README.md)

Keep the articles, videos and podcasts you mean to get to on one wall, read them right in DSH, take notes, and work through them with the agent.

Papers, articles and videos you come across end up scattered across browser tabs; to talk about one with the agent you copy and paste, and once the chat is over nothing sticks. With the Reader, paste a link or subscribe to an RSS feed and a card appears under "Inspiration" in the right sidebar; open it to read, and translate a foreign-language piece in one click. Select a line that matters to make a note, discuss your notes with the agent, and finally let it quiz you on whether you can explain it — the conclusions go back into your notes.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-1.png" width="640" alt="the Inspiration wall: a card stream of subscriptions and saved links; the header row holds filter, sort, translate-the-wall, refresh, settings and add, with the search box on its own row">

## What it does

- **Paste a link and it's saved**: click "Add inspiration" and paste — a feed becomes a subscription, an article is saved on its own; subscriptions refresh daily, and a story reposted in several places keeps just one card. Links it can't fetch are saved too, with the reason.
- **Videos and podcasts read like articles**: YouTube, Bilibili, podcasts and Xiaoyuzhou all fit; subtitles become the text when there are some, otherwise it transcribes on your computer into a "Transcript", and in a conversation it tells the speakers apart. Click a timestamp to play from there.
- **Translate in one click**: sentence by sentence, click a sentence to see the original; if the machine translation isn't good enough, "✦ Let the agent polish the translation" has the agent retranslate the whole piece.
- **Select a line, take a note**: select a sentence and click "Take a note" to keep the original and your thought; noted lines are highlighted in the text, and a note jumps back to its spot.
- **Discuss with your notes**: "Discuss with these notes" puts them in the composer — send it and talk it over with the agent; ask it to record the conclusion and it goes under that note.
- **Let the agent quiz you**: after reading, "Let the agent quiz me" has it play a student who hasn't read the piece and ask you to explain it, then point out, against the original, only what you missed. No scores — click again to practice again.
- **Quote into the chat**: select text to quote it straight into the composer; with the canvas installed, a note can "Sync to canvas" as an inspiration card.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-2.png" width="640" alt="the detail view: the article rendered as text; with the globe toggle on, sentences are translated side by side and clicking one reveals its original">

## Install

In DSH, open Plugins → Add plugin, enter either suite's package name below and click Install:

```
@khorsheed/dsh-writing-suite
```

```
@khorsheed/dsh-learning-suite
```

The Reader comes with the Writing Suite or the Learning Suite, along with local transcription and Capture. Then start a new session, pick "写作模式" (writing mode) or "学习模式" (learning mode), open "Inspiration" in the right sidebar and paste your first link.

The Reader only shows up in sessions of those two modes; not seeing it in other modes is expected.

## Known limitations

- One-click translation uses the browser's built-in translator, so only desktop Chrome 138+ / Edge 148+ can translate new pieces; phones and other browsers can only view translations already made.
- PDFs have no readable text and are saved as links only; pages that need a login can't be fetched either.
- Very long articles may come back only partly; it tells you so and offers "Read the original".

## Compatibility

Requires DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Every feature in detail, the surfaces, the internals of fetching / translation / storage, degradation and where data is stored: see the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/reader/docs/reference.en.md).
- Entry points: `src/index.ts` (service and sidebar), `src/tool.ts` (model tools such as `reader_read`). You can also install it alone (`@khorsheed/dsh-reader`, or `dsh plugin --profile web add @khorsheed/dsh-reader`), in which case it shows in every session; local transcription and rendered fetch then need `@khorsheed/dsh-transcribe` and `@khorsheed/dsh-capture` installed separately.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — file issues and contributions there; changes are in [CHANGELOG.md](CHANGELOG.md).
