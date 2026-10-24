# @khorsheed/dsh-canvas-novel

English | [中文](README.md)

Write a long serial novel with the agent: by chapter one hundred it still knows who your characters are, where you left off, and which foreshadowing is still waiting to pay off.

The trouble with writing a long novel with a model is that it forgets: characters drift out of character, planted clues never get picked up, and every new conversation means pasting the background in again. The novel is a genre of the idea canvas: one book is one canvas, and its characters, world, principles and foreshadowing are cards on it. You and the agent settle the outline first, then plan and write one chapter at a time; after each chapter the agent goes back over it and records what happened on the cards. Pick it up in a new session later and what it reads from the cards is the book as it stands now.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-board.png" width="640" alt="A novel canvas: a thin strip on top with the current chapter and items to review, and below it character, world, principle and foreshadowing cards">

## What it does

- **One book, one canvas**: when you create a canvas, pick the "长篇小说" (novel) genre and the character, world, principle, foreshadowing and relationship cards are set up for you, each with ready-made fields to fill in.
- **Outline first, then write**: talk through the main line, the protagonist, where it ends and how long it runs; the agent drafts a one-page outline and the volumes on the "Plan" page, and nothing counts until you press "Adopt". You can change it any time.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-planning.png" width="640" alt="The Plan page: whole-book progress on top, the one-page outline, the agent's outline proposal in a dashed box with Adopt / Discard, and the chapter route by volume below">

- **Settled details become cards**: characters and world details you agree on in the chat are written straight onto cards; fix whatever's wrong, and there's only ever one card per character name.
- **See each chapter's plan before it's written**: the agent lays out the target length, plot beats, conflict, foreshadowing and who appears; a plan card shows up in the chat, and it only starts writing once you open "Review and confirm the plan" and confirm.
- **The text lives in your workspace**: each chapter is a Markdown file in your workspace that any editor can open.
- **Reconcile after each chapter**: say "reconcile chapter 3" in the chat and the agent reads the text and records what the characters went through, how relationships moved and where the foreshadowing stands; anything it isn't sure about waits for you under "to review".
- **The whole book at a glance**: the "Story" page lays out, chapter by chapter, where clues were planted and revealed, how relationships rose and fell and what each character went through, and flags foreshadowing that's been idle too long; the "Chapters" page is a table of contents with a reader, and "Keep writing" picks up where you stopped.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-story-log.png" width="640" alt="The story log: chapters along the top, foreshadowing, relationships, characters and world in four groups, and one foreshadow opened on the right with its current state and chapter-by-chapter history">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-writing-suite
```

The novel genre comes with the Writing Suite, along with the idea canvas. Then start a new session, pick "写作模式" (writing mode), and tell the agent "I want to write a novel; start a novel canvas".

It only appears in "写作模式" (writing mode) sessions; not seeing it in other modes is expected.

## Known limitations

- Chapter text has to be saved into a workspace attached to the canvas; if it can't be saved, the chapter isn't recorded.
- A canvas that wasn't opened from the current session is read-only, so you can't handle items to review there.
- Data from the old story-bible plugin is not carried over.

## Compatibility

Needs DSH 0.2.0-rc.2 or later; verified on 0.2.1-rc.1.

## For developers

- Entry points: `src/index.ts` (the genre and the writing engine), `src/agent.ts` (the agent's novel tools), `src/client/index.ts` (the pages inside the canvas).
- You can install it alone (`dsh plugin --profile web add @khorsheed/dsh-canvas @khorsheed/dsh-canvas-novel`), but only together with the idea canvas; without the canvas it does nothing, and doesn't fail either.
- How relationship cards are scored: [relationship criteria](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/canvas-novel/docs/relation-criteria.en.md). Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); changes: [CHANGELOG.md](CHANGELOG.md).
