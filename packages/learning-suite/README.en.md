# @khorsheed/dsh-learning-suite

English | [中文](README.md)

**A one-stop kit for teaching yourself: the agent becomes your reading coach and sees you through a book or a course; where you are, what you didn't get and which questions you missed — it remembers all of it for you.** Say what you want to learn: the coach first gets a sense of your background, then helps you pick textbooks and lay out a path, which only starts once you confirm. While reading, photograph a page and your underlines and margin notes become cards; after a chapter take a short quiz, and wrong answers stay until you've corrected them. The Today page lists what to continue and what to review each day. Subscribed and saved articles, videos and podcasts can be read inside DSH; select a sentence to take a note, and when you're done, one click has the agent quiz you. Videos and podcasts without subtitles are transcribed on your computer, and pages that need scripts to render can still have their text fetched. Comes with "学习模式" (learning mode), installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-1.png" width="800" alt="A learning-mode session: the coach's grading table on the left; on the right, the Library's Today page with your projects, today's retakes and recent changes">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-learning-suite
```

That installs all 4 members below; restart DSH and they're ready. It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files.

Then start a new session, pick "学习模式" (learning mode), and tell the coach what you want to learn. All of this only shows up in learning-mode sessions; not seeing it in other modes is expected.

## Things you can say to the agent

- "I want to get started with linear algebra in three months. Ask about my background first, then help me pick a textbook and plan a path."
- "Here's a photo of page 3 in chapter two; turn what I highlighted into cards."
- "Give me a quiz on chapter two."
- "What should I review today?"
- "Quiz me on the article I read in the Reader yesterday."

The coach reads with you, not for you: it skips what you already know and slows down where you're weak. If you don't name a textbook, it picks an existing book or course, and writes one itself when nothing fits.

## The learning suite — plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| library | `@khorsheed/dsh-library` | Library: a study desk in the right sidebar — study paths, notes from page photos, chapter quizzes, retakes, daily review |
| dsh-reader | `@khorsheed/dsh-reader` | Reader: feeds and saved articles, videos and podcasts read inside DSH; take notes, discuss with them, let the agent quiz you |
| transcribe | `@khorsheed/dsh-transcribe` | Local Transcription: videos and podcasts without subtitles become timed text on your computer, with who said what |
| capture | `@khorsheed/dsh-capture` | Capture: for pages a plain fetch can't read, it opens them for real in the background and brings the text back |

## Features

### library: Library

The worst part of teaching yourself from a book is that nobody keeps you on track: you plan your own pace, copy your own notes, write your own questions, and nobody reminds you of the ones you got wrong. Tell the coach which book you're reading; the title and edition are enough, no need to upload the book, or just name a field ("calculus from zero, pick the textbook for me") and it picks the topics and textbooks for your level. It drafts a study path from the table of contents, and nothing counts until you press "Adopt as this textbook’s path"; then follow it station by station, or jump to whichever station interests you first. Photograph the page you're on and your highlights and margin notes turn into cards, no copying by hand. After each chapter, take a short quiz built from what you highlighted, asked about and got wrong; multiple choice and fill-in are marked on the spot, and the coach marks the open questions. Missed questions go to "To retake", and a topic only counts as learned once you get them right. The "Today" page in the right sidebar lists the questions to retake and the cards due, so you know what to do the moment you open it.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-2.png" width="640" alt="library: a textbook's path page, a 14-station study path with stations passed and points mastered at the top, and Retake 7 and Continue on the current station">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/learning-3.png" width="640" alt="library: a retake paper, the missed questions one by one, each with an answer box and Submit, Approach and Broken buttons">

</details>

### dsh-reader: Reader

The articles, videos and podcasts you take in outside the textbook are part of learning too. The Reader in the right sidebar puts your feeds and any links you paste on one wall; open one and the text reads right inside DSH, and foreign-language pieces can be translated sentence by sentence with the browser's built-in translator (on a desktop browser that supports it). Select a sentence and press "Take a note" to save the excerpt with your comment; "Discuss with these notes" puts the notes into the chat box. When you've finished, press "Let the agent quiz me": acting as a student who hasn't read the piece, it asks a few "explain it to me" questions at once; you answer in one message, and it goes back to the text to cover only what you didn't get across, then records it as a note. No scores, and pressing it again gives you another round. YouTube and Bilibili videos and podcasts can come in too; when a video has subtitles they become the text, and clicking a timestamp plays from there.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-1.png" width="640" alt="dsh-reader: the Reader wall, a stream of feed and saved-link cards, with filter, sort, translate-the-wall, refresh, settings and add in the header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-2.png" width="640" alt="dsh-reader: the detail page with translation on, sentence by sentence, one sentence expanded to show its original">

</details>

### transcribe: Local Transcription

Lecture recordings and podcasts often have no subtitles. Open one in the Reader and it is transcribed into timed text on this computer: the finished parts show up first, so you can read and take notes before it's done; with several speakers it works out who is talking, colors each paragraph by speaker, and lets you rename them. The transcript stays as the text, so you can translate it, discuss it and get quizzed on it like any article. The audio never leaves your computer; the speech model downloads the first time, and you need ffmpeg installed.

<details open>
<summary>Screenshots (1)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-transcript.png" width="640" alt="transcribe: A Bilibili video transcribed locally in the Reader: the video on top, the transcript below split by speaker A and B, each paragraph with a timestamp that plays from there, translations under the original">

</details>

### capture: Capture

Some pages only show their text once scripts have run, so a plain fetch gets an empty shell; some sites block plain fetches outright. That's when the Reader switches to a rendered fetch: a browser you never see opens the page for real, scrolls to the bottom, waits for everything to draw, and brings the text back, with script-drawn figures saved as images in place. It steps in on its own when a site blocks the plain fetch, and the detail page has a "Fetch rendered" button to try again by hand. Every run uses a fresh browser with none of your logins or cookies; the browser itself downloads the first time it's needed.

<details open>
<summary>Screenshots (1)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-render-fetch.png" width="640" alt="capture: text brought back by a rendered fetch on the Reader detail page, with a script-drawn figure kept in the text">

</details>

## Make it yours

- **Remove a member**: open the learning suite's detail page in Settings → Plugins and switch that one off — the rest keep working. Uninstalling the suite (`dsh plugin --profile <your profile> remove @khorsheed/dsh-learning-suite`) removes its members with it.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other suites

The essentials are the layer everyone wants; add a suite for the scene you work in.

| Suite | Package | What it is |
|---|---|---|
| [Basic Essentials](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | Everyday quality of life: edit and withdraw messages, session artifacts, background-job pills, compaction reminders, the capability catalog, mobile — recommended for everyone |
| [Dev Suite](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | Local coding-agent delegation, multi-agent rooms, live worktree state, quick judgements, the restart guard and the context lens — with "开发模式" (dev mode) |
| [Video Suite](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | A cutting room with speaker splitting and delete-the-word-deletes-the-audio, plus local-agent delegation — with "剪辑模式" (editing mode) |
| [Gamedev Suite](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | Build small games with the agent, plus local-agent delegation — with "游戏开发模式" (game dev mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The plugin monorepo: the capability map of every package and the development docs |

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth); each member's details are in its own README under [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages). Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

<!-- collection:start -->
Recommended: install it together with the basic suite (the Learning collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```
<!-- collection:end -->

Or Settings → Plugins → Add plugin, enter `@khorsheed/dsh-learning-suite`. Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — new interface code only loads on a hard refresh; a plain reload may keep serving the cached page. Then tell the user to start a new session in "学习模式" (learning mode) and present the feature list (the plugin table above).

### 2. Installing a single plugin

- **Dialog**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-library`), enable as prompted.
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.
- The Reader installed on its own isn't tied to learning mode and shows up in every session; the Library needs learning mode to grant it, so on its own its sidebar never appears — install the whole suite.

</details>
