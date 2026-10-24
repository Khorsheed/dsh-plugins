# @khorsheed/dsh-learning-suite

English | [中文](README.md)

A mode for teaching yourself: the agent becomes your reading coach and sees you through a book or a course, keeping track of where you are, what didn't sink in, and which questions you got wrong.

Learning with an agent used to fall apart once the chat ended: which chapter you'd reached, which idea hadn't clicked, which question you missed last time, all of it explained again next time. In learning mode, say what you want to learn; the coach asks about your background first, then helps pick a textbook and plan a path. Snap a page as you read and it turns your highlights into cards; finish a chapter, take a short quiz, and the questions you missed stay until you get them right. Articles and podcasts you read can be quizzed on too, then written up in your own words as cards.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-learning-hero.png" width="640" alt="A learning-mode session: the chat with the reading coach on the left, and the Library in the right sidebar showing what to continue today, what's due for review, and each textbook's progress">

## Things you can say to the agent

- "I want to get started with linear algebra in three months. Ask about my background first, then help me pick a textbook and plan a path."
- "Here's a photo of page 3 in chapter two; turn what I highlighted into cards."
- "Give me a quiz on chapter two."
- "Quiz me on the article I read in the Reader yesterday."
- "Write the main points of this section as a canvas card in my own words, and pick holes in it."

## What's inside

- **Library**: your study desk in the right sidebar. The coach plans your path (it counts once you press "Adopt as this textbook’s path"), turns page photos into cards, and writes chapter quizzes; the Today page lists what to continue and what to review.
- **Idea Canvas**: write what you read in your own words as cards; putting it into words is how you know you've got it.
- **Reader**: subscribe to or save articles to read, take notes, discuss them with the notes at hand, and press "Let the agent quiz me" when you're done.
- **Local Transcription**: videos and podcasts without subtitles are turned into text on your own computer, ready to read.
- **Capture**: pages that only show their content after scripts run can still have their text pulled out.

The coach reads with you, not for you: it skips what you already know and slows down where you're weak. If you don't name a textbook, it picks an existing book or course, and writes one itself when nothing fits.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-learning-suite
```

It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files. Then start a new session, pick "学习模式" (learning mode), and tell the coach what you want to learn.

All of this only shows up in learning-mode sessions; not seeing it in other modes is expected (the canvas and the Reader also appear in writing mode).

## Known limitations

- It doesn't read ebook files (EPUB, PDF); the book's content comes from the photos you take.
- Local transcription needs ffmpeg on your computer, and the speech model downloads the first time you transcribe.

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## For developers

Command-line install (same result as above):

<!-- collection:start -->
Recommended: install it together with the basic suite (the Learning collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```
<!-- collection:end -->

- This package has no features of its own; it installs learning mode and the members above together. Uninstalling (`dsh plugin --profile web remove @khorsheed/dsh-learning-suite`) removes them together too; to turn off just one, switch it off on the suite's detail page.
- Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
