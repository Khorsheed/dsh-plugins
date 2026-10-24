# @khorsheed/dsh-library

English | [中文](README.md)

Let an agent be your reading coach: it plans your pace, takes your notes, writes your quizzes, and keeps after you until every wrong answer is fixed.

The hard part of teaching yourself a book is that nobody keeps you on track: you plan the pace, copy the notes, write the questions, and the ones you got wrong are forgotten by next time. With the library, tell the coach which book you're reading and it drafts a study path first; snap a page as you read and your highlights and margin notes become cards; take a short quiz after each chapter, and the questions you missed stay around until you get them right.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-today.png" width="640" alt="The Library's Today page in the right sidebar: continue studying, today's review, your projects">

## What it does

- **Say what you're reading and start**: the title and edition are enough; no need to upload the book. No book yet? Ask it to recommend one.
- **It drafts the path, you say yes**: it plans a study path from the table of contents; nothing counts until you press "Adopt as this textbook’s path".
- **Snap a page, get your notes**: photograph the page you're on and your highlights and margin notes turn into cards; no copying by hand.
- **Finish a chapter, take a quiz**: questions come from what you highlighted, asked about, and got wrong; multiple choice and fill-in are marked on the spot, the coach marks the open questions.
- **Wrong answers don't get dropped**: missed questions go to "To retake", and a topic only counts as learned once you get them right.
- **A review list every day**: the Today page lists the questions to retake and the cards due, so you know what to do the moment you open it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-quiz.png" width="640" alt="A chapter quiz: multiple choice and fill-in marked on the spot, open questions handed to the coach">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-learning-suite
```

The library comes with the Learning Suite. Then start a new session, pick "学习模式" (learning mode), and tell the coach what you want to read.

The library only appears in "学习模式" (learning mode) sessions; not seeing it in other modes is expected.

## Known limitations

- It doesn't read ebook files (EPUB, PDF); it records the title and table of contents only.
- Photos you take are sent into the session as a message, and the coach reads them there.

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (service and sidebar) and `src/tool.ts` (the coach's model tools); each tool's usage is in its own description.
- You can install this package alone (`dsh plugin --profile web add @khorsheed/dsh-library`), but its model tools must be granted by a mode, so on its own the sidebar does not appear.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
