# @khorsheed/dsh-writing-suite

English | [中文](README.md)

> **Still being polished — not released yet.** This suite can't be installed from Plugins → Add plugin for now, and what follows may change.

**A full kit for writing with an agent: ideas and drafts live on a canvas, it remembers your characters and foreshadowing on a long novel, and the good articles you read turn into notes you can talk through.** One canvas per topic, with every idea pinned up as a card, and the agent's suggested cards stay only when you say yes; pick a few cards and have the agent write them up, and the draft remembers which material it used; on a novel, characters, the world and foreshadowing each get cards, you see every chapter's plan before it's written, and after a chapter you say "reconcile" and it records what happened back onto the cards; feeds and saved articles, videos and podcasts read right inside DSH, highlight a sentence to take a note, discuss it with the agent, and sync notes over as canvas cards; videos and podcasts without subtitles are transcribed on your own computer; even pages that only show their text after scripts run can have it pulled out…… It comes with "写作模式" (writing mode), installed in one go.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-writing-hero.png" width="800" alt="A writing-mode session: the chat on the left, and on the right-sidebar canvas a row of idea, character and foreshadowing cards, one of them a model suggestion waiting for your approval">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-writing-suite
```

That installs all 5 members below; restart DSH and they're ready. It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files.

Then start a new session, pick "写作模式" (writing mode), and tell the agent what you want to write. All of this only shows up in writing-mode sessions; not seeing it in other modes is expected.

## Things you can say to the agent

- "Start a canvas called *Fog Harbor* and give each of the three characters we just discussed a character card."
- "I want to write a novel. Start a novel canvas and help me settle the outline first."
- "I've read the plan for chapter three, go ahead and write it." When it's done, say "reconcile chapter 3".
- "Make this paragraph more conversational; don't touch the facts or the argument."
- "Read the article I just opened, discuss its argument with my notes in mind, and put the conclusion in my notes."
- "When would be a good point to reveal this bit of foreshadowing?"

Before it writes, the agent works out whether you want writing, analysis or an edit; an edit only changes the wording, never your facts or opinions.

## The writing suite — plugin list

| Plugin | Package name (copy to install) | What you get |
|---|---|---|
| canvas | `@khorsheed/dsh-canvas` | Idea Canvas: one canvas per topic, ideas, questions and sources pinned up as cards, pick a few for the agent to write up |
| canvas-novel | `@khorsheed/dsh-canvas-novel` | Novel Genre: a canvas genre where characters, the world and foreshadowing are cards; each chapter gets a plan first and a reconcile after |
| dsh-reader | `@khorsheed/dsh-reader` | Reader: feeds and saved articles, videos and podcasts read inside DSH; highlight a sentence to take a note, discuss with your notes |
| transcribe | `@khorsheed/dsh-transcribe` | Local Transcription: videos and podcasts without subtitles become timed text on your computer, with who said what |
| capture | `@khorsheed/dsh-capture` | Capture: for pages a plain fetch can't read, it opens them for real in the background and brings the text back |

## Features

### canvas: Idea Canvas

Writing an essay or a novel, your material ends up scattered across chat history and notes, and when you finally sit down to write you're scrolling back for each piece. The Canvas tab in the right sidebar gives every topic its own canvas: cards come as Fragment, Question, Grounding, Reference and Document, and you can rename, add or retire categories; paste in web pages, tables and images, or sketch something by hand. Cards the agent suggests in the chat land with a dashed outline; "Accept" keeps one, "Reject" moves it to the archive rather than deleting it. Switch to "Links" to drag cards into place, draw lines between them, and box related cards into a group. When you have enough, select a few and choose "Talk to the Agent" or "Have the Agent write it"; the card text goes into the chat box for you to add a line and send. The manuscript gets its own page that tracks which cards it used and which it didn't; you and the agent can both edit it, and you can save it to your workspace. Select text anywhere and pick "Save as canvas card" to collect it too.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-board.png" width="640" alt="canvas: the canvas in the right sidebar, a row of canvas tabs on top and a board filtered by category below, with fragment, question and reference cards and one dashed suggested card">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-links.png" width="640" alt="canvas: the Links view, cards drawn as nodes with lines between them, a few cards boxed into a titled group">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-manuscript.png" width="640" alt="canvas: the manuscript page, a reading column with the title and version on top and the used and unused cards listed at the bottom">

</details>

### canvas-novel: Novel Genre

The worst part of writing a novel with a model is that it forgets: characters drift out of character, foreshadowing never pays off, and every new chat means pasting the background in again. When you create a canvas, pick the "长篇小说" (novel) genre and the character, world, principle, foreshadowing and relationship cards are set up for you. Talk through the main line, the protagonist, where it ends and how long it runs, and the agent drafts a one-page outline and the volumes on the "Plan" page; nothing counts until you press "Adopt", and you can change it any time. Details you settle in the chat go straight onto cards. For each chapter it lays out the target length, plot beats, conflict, foreshadowing and who appears, and only starts writing once you open "Review and confirm the plan" and confirm; the text is a Markdown file in your workspace that any editor can open. When a chapter is done, say "reconcile chapter 3": the agent reads the text and records what the characters went through, how relationships moved and where the foreshadowing stands, and anything it isn't sure about waits for you under "to review". The "Story" page lays out, chapter by chapter, where clues were planted and revealed and how relationships rose and fell, and flags foreshadowing that's been idle too long; the "Chapters" page is a table of contents with a reader, and "Keep writing" picks up where you stopped. Next time, in a new session, what it reads from the cards is the book as it stands now.

<details open>
<summary>Screenshots (3)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-board.png" width="640" alt="canvas-novel: a novel canvas, a thin strip on top showing the current chapter and how many items wait for review, with character, world, principle and foreshadowing cards below">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-planning.png" width="640" alt="canvas-novel: the Plan page, a one-page outline and the agent's outline suggestion with Adopt / Don't adopt, and the chapter route by volume below">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-story-log.png" width="640" alt="canvas-novel: the Story page, chapters along the horizontal axis in four groups — foreshadowing, relationships, characters, world — with one clue opened on the right to show how it changed chapter by chapter">

</details>

### dsh-reader: Reader

The articles you come across sit in browser tabs, and talking them over with the agent means copy-pasting. The Reader in the right sidebar puts your feeds and any links you paste on one wall; open one and the text reads right inside DSH, and foreign-language pieces can be translated sentence by sentence with the browser's built-in translator (on a desktop browser that supports it). When a sentence is worth keeping, select it and press "Take a note" to save the excerpt with your comment; "Discuss with these notes" puts the notes into the chat box, and the conclusions you reach can be written back under the note. When you've finished, press "Let the agent quiz me": it asks you a few questions like a student who hasn't read the piece, then tells you what you didn't quite get across. "Sync to canvas" turns a note into a fragment card on your canvas. YouTube and Bilibili videos and podcasts can come in too; when a video has subtitles they become the text, and clicking a timestamp plays from there.

<details open>
<summary>Screenshots (2)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-1.png" width="640" alt="dsh-reader: the Reader wall, a stream of feed and saved-link cards, with filter, sort, translate-the-wall, refresh, settings and add in the header">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-2.png" width="640" alt="dsh-reader: the detail page with translation on, sentence by sentence, one sentence expanded to show its original">

</details>

### transcribe: Local Transcription

Most Bilibili videos and most podcasts have no subtitles. Open one in the Reader and it is transcribed into timed text on this computer: the finished parts show up first, so you can read and take notes before it's done; with several speakers it works out who is talking, colors each paragraph by speaker, and lets you rename them ("host", "guest"). The transcript stays as the text, so you can translate it, discuss it and get quizzed on it like any article. The audio never leaves your computer; the speech model downloads the first time, and you need ffmpeg installed.

<details open>
<summary>Screenshots (1)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-transcript.png" width="640" alt="transcribe: a podcast episode transcribed locally in the Reader, timestamps on the left and paragraphs colored by speaker">

</details>

### capture: Capture

Some pages only show their text once scripts have run, so a plain fetch gets an empty shell; some sites block plain fetches outright. That's when the Reader switches to a rendered fetch: a browser you never see opens the page for real, scrolls to the bottom, waits for everything to draw, and brings the text back, with script-drawn figures saved as images in place. It steps in on its own when a site blocks the plain fetch, and the detail page has a "Fetch rendered" button to try again by hand. Every run uses a fresh browser with none of your logins or cookies; the browser itself downloads the first time it's needed.

<details open>
<summary>Screenshots (1)</summary>

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-render-fetch.png" width="640" alt="capture: text brought back by a rendered fetch on the Reader detail page, with a script-drawn figure kept in the text">

</details>

## Make it yours

- **Remove a member**: open the writing suite's detail page in Settings → Plugins and switch that one off — the rest keep working. Uninstalling the suite (`dsh plugin --profile <your profile> remove @khorsheed/dsh-writing-suite`) removes its members with it.
- **Add more**: any `@khorsheed/dsh-*` plugin installs the same way — copy the package name.
- **Update**: from Settings → Plugins, or `dsh plugin --profile <your profile> update` to pull the newest versions in range.

## Other suites

The essentials are the layer everyone wants; add a suite for the scene you work in.

| Suite | Package | What it is |
|---|---|---|
| [Basic Essentials](https://github.com/Khorsheed/dsh-basic) | `@khorsheed/dsh-basic` | Everyday quality of life: edit and withdraw messages, session artifacts, background-job pills, compaction reminders, the capability catalog, mobile — recommended for everyone |
| [Dev Suite](https://github.com/Khorsheed/dsh-dev) | `@khorsheed/dsh-dev-suite` | Local coding-agent delegation, multi-agent rooms, live worktree state, quick judgements, the restart guard and the context lens — with "开发模式" (dev mode) |
| [Learning Suite](https://github.com/Khorsheed/dsh-learning) | `@khorsheed/dsh-learning-suite` | Library-style close reading, the idea canvas and the reading space — with "学习模式" (learning mode) |
| [Video Suite](https://github.com/Khorsheed/dsh-video) | `@khorsheed/dsh-video-suite` | A cutting room with speaker splitting and delete-the-word-deletes-the-audio, plus local-agent delegation — with "剪辑模式" (editing mode) |
| [Gamedev Suite](https://github.com/Khorsheed/dsh-gamedev) | `@khorsheed/dsh-gamedev-suite` | Build small games with the agent, plus local-agent delegation — with "游戏开发模式" (game dev mode) |
| [Eval Suite](https://github.com/Khorsheed/dsh-eval) | `@khorsheed/dsh-eval-suite` | Compare agents on this machine: question sets, experiments, judging and reports — with "评测模式" (eval mode) |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | — | The plugin monorepo: the capability map of every package and the development docs |

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Developing

Plugins live in [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) (single source of truth); each member's details are in its own README under [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages). Issues welcome.

## Install guide for agents

<details>
<summary><strong>Expand: whole-suite install + single-package CLI install</strong> (follow this when the user says "install this for me")</summary>

### 1. Installing the whole suite (recommended)

<!-- collection:start -->
Recommended: install it together with the basic suite (the Writing collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```
<!-- collection:end -->

Or Settings → Plugins → Add plugin, enter `@khorsheed/dsh-writing-suite`. Restart the web instance, then ask the user to **hard-refresh** (Cmd/Ctrl+Shift+R) — new interface code only loads on a hard refresh; a plain reload may keep serving the cached page. Then tell the user to start a new session in "写作模式" (writing mode) and present the feature list (the plugin table above).

### 2. Installing a single plugin

- **Dialog**: Settings → Plugins → Add plugin, enter the package name (e.g. `@khorsheed/dsh-reader`), enable as prompted.
- **CLI**: `dsh plugin --profile <profile> add <package name>`; `remove` to uninstall, `update` to upgrade.
- A member installed on its own isn't tied to writing mode and shows up in every session; the novel genre must be installed together with the canvas (`add @khorsheed/dsh-canvas @khorsheed/dsh-canvas-novel`).

</details>
