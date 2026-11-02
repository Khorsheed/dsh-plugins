# @khorsheed/dsh-canvas-novel

English | [中文](README.md)

> **Still being polished — not released yet.** This plugin can't be installed from Plugins → Add plugin for now, and what follows may change.

Write a long serial novel with the agent: by chapter one hundred it still knows who your characters are, where you left off, and which foreshadowing is still waiting to pay off.

The trouble with writing a long novel with a model is that it forgets: characters drift out of character, planted clues never get picked up, and every new conversation means pasting the background in again. The novel is a genre of the idea canvas: one book is one canvas, and its characters, world (systems, places, factions, creatures and items), foreshadowing, relationships and writing principles are cards on it. You and the agent settle the outline first, then plan and write one chapter at a time; after each chapter the agent goes back over it and records what happened on the cards. Pick it up in a new session later and what it reads from the cards is the book as it stands now.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-board.png" width="560" alt="A novel canvas: a thin strip on top with the current chapter and items to review, and below it character, world, principle and foreshadowing cards">

## What it does

- **One book, one canvas**: when you create a canvas, pick the "长篇小说" (novel) genre and the character, system, place, faction, creature-and-item, foreshadowing, relationship and writing-principle cards are set up for you, each with ready-made fields to fill in.
- **Settings that hang together**: a place says which larger place it sits in, a faction names its base, a character names their faction and where they usually are; open any card to see what it belongs to, what sits under it, who is tied to it and which chapters it appears in. An older book can be reorganized into the new categories by the agent in one go — it shows you the result before anything moves.
- **Outline first, then write**: talk through the main line, the protagonist, where it ends and how long it runs; the agent drafts a one-page outline and the volumes on the "Overview" page, and nothing counts until you press "Adopt". You can change it any time; below it sits a map of the whole world.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-planning.png" width="560" alt="The Plan page: whole-book progress on top, the one-page outline, the agent's outline proposal in a dashed box with Adopt / Discard, and the chapter route by volume below">

- **Settled details become cards**: characters and world details you agree on in the chat are written straight onto cards; fix whatever's wrong, and there's only ever one card per character name.
- **Decide what happens next**: the "Timeline" shows what has happened on the left, in story order, and what is to come on the right — events you have in mind, characters' intentions, consequences on their way, foreshadow reveals — grouped by priority (due, overdue, ready, saturated, on hold), each with the reason.
- **See each chapter's plan before it's written**: planning the next chapter, the agent picks the events to move from the timeline and lays out the target length, plot beats, conflict, foreshadowing and who appears; on the "Chapters" page you can prioritize an event or skip it for this chapter. Read the plan and press "Write to this plan" to start.
- **Write it yourself too**: edit a chapter's text right on the chapter page, or start a chapter of your own — on a phone as well; jot a scene or a line on the "Ideas" page, place it on the timeline, and its words come along when that event is written.
- **Import an existing novel**: press "Import a novel" on the Chapters page and choose several TXT or Markdown documents at once, or press "Import a folder" on the host machine to read a whole directory recursively. Files join in natural name or relative-path order, and standalone headings such as "第…章" and "Chapter…" become chapters automatically. Check the preview, confirm, and the text lands in the workspace while the agent reconciles every chapter.
- **The text lives in your workspace**: each chapter is a Markdown file in your workspace that any editor can open.
- **Reconcile after each chapter**: say "reconcile chapter 3" in the chat and the agent reads the text, puts what happened on the timeline, and records what the characters went through, what they now believe and intend, how relationships moved and where the foreshadowing stands.
- **The whole book at a glance**: switch the "Timeline" to "By chapter" to lay out, chapter by chapter, where clues were planted and revealed, how relationships rose and fell and what each character went through, and flags foreshadowing that's been idle too long; the "Chapters" page is a table of contents by volume with a reader, and "Keep writing" picks up where you stopped.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-story-log.png" width="560" alt="The story log: chapters along the top, foreshadowing, relationships, characters and world in four groups, and one foreshadow opened on the right with its current state and chapter-by-chapter history">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-writing-suite
```

The novel genre comes with the Writing Suite, along with the idea canvas. Then start a new session, pick "写作模式" (writing mode), and tell the agent "I want to write a novel; start a novel canvas".

It only appears in "写作模式" (writing mode) sessions; not seeing it in other modes is expected.

## Known limitations

- Chapter text has to be saved into a workspace attached to the canvas; if it can't be saved, the chapter isn't recorded.
- Save Word (.doc/.docx) files as UTF-8 TXT or Markdown first. A document with no recognizable chapter headings imports as one chapter.
- Folder import appears only on the host machine; remote pages should choose several files instead. A folder can contain up to 32 levels, 500 supported documents and 100MB in total; truncation is shown in the preview.
- A canvas that wasn't opened from the current session is read-only, so you can't handle items to review there.
- Data from the old story-bible plugin is not carried over.

## Compatibility

Needs DSH 0.2.0-rc.2 or later; verified on 0.2.1-rc.5.

## For developers

- Entry points: `src/index.ts` (the genre and the writing engine), `src/agent.ts` (the agent's novel tools), `src/client/index.ts` (the pages inside the canvas).
- You can install it alone (`dsh plugin --profile web add @khorsheed/dsh-canvas @khorsheed/dsh-canvas-novel`), but only together with the idea canvas; without the canvas it does nothing, and doesn't fail either.
- How relationship cards are scored: [relationship criteria](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/canvas-novel/docs/relation-criteria.en.md). Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); changes: [CHANGELOG.md](CHANGELOG.md).
