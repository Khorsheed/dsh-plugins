# @khorsheed/dsh-library

English | [中文](README.md)

Let an agent be your reading coach: it plans your pace, takes your notes, writes your quizzes, and keeps after you until every wrong answer is fixed.

The hard part of teaching yourself a book is that nobody keeps you on track: you plan the pace, copy the notes, write the questions, and the ones you got wrong are forgotten by next time. With the library, tell the coach which book you're reading and it drafts a study path first; snap a page as you read and your highlights and margin notes become cards; take a short quiz after each chapter, and the questions you missed stay around until you get them right.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-1.png" width="560" alt="A learning-mode session: the coach's grading table on the left; on the right, the Library's Today page with your projects, today's retakes and recent changes">

## What it does

- **Say what you're reading and start**: the title and edition are enough; no need to upload the book. Or just name a field ("calculus from zero, pick the textbook for me") and it picks the topics and textbooks for your level.
- **It drafts the path, you say yes**: it plans a study path from the table of contents; nothing counts until you press "Adopt as this textbook’s path". Then follow it station by station, or jump to whichever station interests you first.
- **Snap a page, get your notes**: photograph the page you're on and your highlights and margin notes turn into cards; no copying by hand.
- **Finish a chapter, take a quiz**: questions come from what you highlighted, asked about, and got wrong; multiple choice and fill-in are marked on the spot, the coach marks the open questions.
- **Wrong answers don't get dropped**: missed questions go to "To retake", and a topic only counts as learned once you get them right.
- **A review list every day**: the Today page lists the questions to retake and the cards due, so you know what to do the moment you open it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-2.png" width="560" alt="A textbook's path page: a 14-station study path with stations passed and points mastered at the top, and Retake 7 and Continue on the current station">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-3.png" width="560" alt="A retake paper: the missed questions one by one, each with an answer box and Submit, Approach and Broken buttons">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-learning-suite
```

The library comes with the Learning Suite. Then start a new session, pick "学习模式" (learning mode), and tell the coach what you want to read.

The library only appears in "学习模式" (learning mode) sessions. Its tools only make sense in learning mode, so they are handed only to learning mode sessions and other modes don't get tools and buttons they can't use. That is also why it should be installed with its suite rather than on its own — installed alone it doesn't show up.

## Known limitations

- It doesn't read ebook files (EPUB, PDF); it records the title and table of contents only.
- Photos you take are sent into the session as a message, and the coach reads them there.

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (service and sidebar) and `src/tool.ts` (the coach's model tools); each tool's usage is in its own description.
- You can install this package alone (`dsh plugin --profile web add @khorsheed/dsh-library`), but its model tools must be granted by a mode, so on its own the sidebar does not appear.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
