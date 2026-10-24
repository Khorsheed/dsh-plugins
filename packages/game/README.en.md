# @khorsheed/dsh-game

English | [中文](README.md)

Make a small game with the agent: tell it what you want to play, it builds the game, you play it right there in the sidebar, and if something feels off you just say so.

Making a small game used to mean writing the code yourself, or getting a model to spit out some code and then figuring out how to run it, chasing bugs, and watching every fix break something else. With this plugin you only describe the game you want and how it feels when you play; the agent settles the gameplay and the look with you, builds the smallest version that plays, checks its own work every round, and only puts a version in the right sidebar's "Game" panel once it passes. No game-design experience needed.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-workbench.png" width="640" alt="The agent changing the game in the session on the left; the right sidebar's Game panel playing the latest version, with parameter sliders below">

## What it does

- **Talk it through before building**: the name, the one-line pitch, the kinds of things in the game, the art style; it asks about each in turn, and for the style you just pick one of the samples.
- **Playable early**: it builds the smallest version you can actually play first, then improves it from how playing it feels to you.
- **Broken versions never reach you**: after every round it checks its own work and fixes what fails on the spot; only a passing version lands under "Play". Want to look before anything goes live? Turn off "Auto-deploy".
- **Tune the feel while you play**: numbers like jump height and run speed become sliders; drag them around and press "Finalize" when it feels right.
- **Change the look of anything you can see**: the hero, enemies, items, even trees, rocks and houses live under "Elements"; draw them yourself, or press "Ask the agent for a new look" and pick from three options.
- **Your panel edits count too**: press "Commit as a new version" and what you changed in the panel goes into the game; the agent sees your edits and won't undo them.
- **Go back any time**: every version stays under "Versions"; switch back to an old one, or export a single `.html` file and send it to a friend.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-elements.png" width="640" alt="An element open under Elements: the look editor, three look options side by side, and the element's background below">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-versions.png" width="640" alt="Versions: the latest check's verdict and screenshot, then the live, candidate and past versions">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-gamedev-suite
```

The game comes with the Game Dev Suite. Then start a new session, pick "Game dev mode", and tell the agent what kind of game you'd like to make.

The Game panel only appears in Game-dev-mode sessions; not seeing it in other modes is expected.

## Known limitations

- Everything on screen is drawn in code, with no AI image generation, so art styles are limited to what code can draw well.
- Games can't reach the internet; every image and sound has to live inside the project.
- The per-round check uses Chrome on this computer; without Chrome it only checks the game's data and doesn't actually run it.

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (service and per-round checks), `src/client/` (sidebar), `src/agent.ts` (the agent's tools and skills); a project is just a folder in the session workspace, so copying the folder takes the whole game with it.
- You can install this package alone (`dsh plugin --profile web add @khorsheed/dsh-game`); the game tools are then available in every session.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
