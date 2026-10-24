# @khorsheed/dsh-canvas

English | [中文](README.md)

Lay out a canvas in the right sidebar, pin up your ideas, questions and sources one card at a time, then have the agent turn them into a draft.

Whether it's an article, a novel, or your take on a book you just finished, the material ends up scattered across chats and notes, and when it's time to write you have to dig it all back up. With the canvas, each topic gets its own board: jot every thought down as a card, and the agent suggests cards from the conversation too, which you keep or turn down. Once you have enough, link the related cards, group them, pick a few and have the agent write them up. You end up with a manuscript that remembers which material it used, and you can save it to your workspace.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-board.png" width="640" alt="The canvas in the right sidebar: a row of canvas tabs on top, a board of cards filtered by category below, with fragment, question and reference cards and one dashed suggested card">

## What it does

- **One canvas per topic**: the Canvas tab in the right sidebar has a row of tabs, one per canvas; switch away and back and you're still on the card you were reading.
- **Write down whatever comes up**: cards come as Fragment, Question, Grounding, Reference and Document, and you can rename, add or retire categories; paste in web pages, tables and images, or sketch something by hand.
- **The agent suggests, you decide**: cards the agent suggests land on the board with a dashed outline; "Accept" keeps one, "Reject" moves it to the archive rather than deleting it.
- **Link cards into groups**: switch to "Links" to drag cards into place, draw a line from one card to another, and drag out a box around the ones that belong together.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-links.png" width="640" alt="The Links view: cards drawn as nodes, lines between them, and a few cards inside a titled group box">

- **Pick some cards, have the agent write**: select cards and choose "Talk to the Agent" or "Have the Agent write it"; the card text goes into the chat box for you to add a line and send. Nothing is sent on its own.
- **The manuscript gets its own page**: it keeps track of which cards it used and which it didn't; you and the agent can both edit it, and if you both changed it at once it asks you which to keep instead of choosing for you. When it's ready, save it to your workspace.
- **Collect cards from anywhere**: select some text anywhere, pick "Save as canvas card" from the menu, and it lands on your canvas; notes from the Reader can be synced over too.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-manuscript.png" width="640" alt="A manuscript page: the text in a reading column, title and version on top, and the cards used and unused listed at the bottom">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-writing-suite
```

The canvas comes with the Writing Suite; if you'd rather use it for study notes, the Learning Suite (`@khorsheed/dsh-learning-suite`) includes it as well. Then start a new session, pick "Writing mode" (or "Learning mode"), and tell the agent "start a new canvas about …".

The canvas only appears in sessions in those two modes; not seeing it elsewhere is expected.

## Known limitations

- Images pasted into a card stay on disk even after the card is deleted.
- The pen ignores pressure; line width follows how fast you move.
- If you edit a canvas file in another editor, the page doesn't refresh; the conflict only shows up the next time you save.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.1.5-rc.1.

## For developers

- Entry points: `src/index.ts` (service), `src/client/index.ts` (the sidebar), `src/agent.ts` (the agent's canvas tools).
- You can install this package alone (`dsh plugin --profile web add @khorsheed/dsh-canvas`); the canvas tools are then open to every session. Uninstalling leaves your canvases in `$DSH_HOME/state/canvas/`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
