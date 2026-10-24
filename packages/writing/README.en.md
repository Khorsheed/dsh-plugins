# @khorsheed/dsh-writing-suite

English | [中文](README.md)

A mode for writing with an agent: ideas and drafts live on a canvas, it remembers your characters and foreshadowing on a long novel, and the good articles you read turn into notes you can talk through.

Writing a novel with a model used to mean characters, foreshadowing and chapter plans scattered over several documents, and pasting the background in again every time you opened a new chat; a good article could only be copy-pasted in. In writing mode you just talk ideas through and ask for drafts, and the agent records ideas, characters and foreshadowing as cards on the canvas in the right sidebar, putting its suggestions out for your approval first; a chapter only counts once you've reviewed it. Next time, the background is all on the board, so you pick up where you left off.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-writing-hero.png" width="640" alt="A writing-mode session: the chat on the left, and on the right-sidebar canvas a row of idea, character and foreshadowing cards, one of them a model suggestion waiting for your approval">

## Things you can say to the agent

- "Start a canvas called *Fog Harbor* and give each of the three characters we just discussed a character card."
- "Write chapter three from the chapter plan, and let me review it first."
- "Make this paragraph more conversational; don't touch the facts or the argument."
- "Read the article I just opened, discuss its argument with my notes in mind, and put the conclusion in my notes."
- "When would be a good point to reveal this bit of foreshadowing?"

## What's inside

- **Idea Canvas**: one canvas per topic, with ideas, questions, agreements, sources and drafts as cards; a card the agent suggests stays only when you press ✓.
- **Novel Genre**: set a canvas to the novel genre and characters, the world and foreshadowing each get their own cards, every pair of characters gets a relationship card, and chapters go in only after you review them.
- **Reader**: subscribe to feeds or save articles and read them inside DSH; highlight a sentence to take a note, discuss it with the agent, and turn notes into cards on the canvas.
- **Local Transcription**: videos and podcasts without subtitles are turned into text on your own computer, ready to read in the Reader.
- **Capture**: pages that only show their content after scripts run can still have their text pulled out.

Before it writes, the agent works out whether you want writing, analysis or an edit; an edit only changes the wording, never your facts or opinions.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-writing-suite
```

It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files. Then start a new session, pick "写作模式" (writing mode), and tell the agent what you want to write.

All of this only shows up in writing-mode sessions; not seeing it in other modes is expected.

## Known limitations

- Local transcription needs ffmpeg on your computer, and the speech model downloads the first time you transcribe.
- Translation in the Reader uses the browser's built-in translator, so you need a desktop browser that supports it.

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## For developers

Command-line install (same result as above):

<!-- collection:start -->
Recommended: install it together with the basic suite (the Writing collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```
<!-- collection:end -->

- This package has no features of its own; it installs writing mode and the members above together. Uninstalling (`dsh plugin --profile web remove @khorsheed/dsh-writing-suite`) removes them together too; to turn off just one, switch it off on the suite's detail page.
- Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
