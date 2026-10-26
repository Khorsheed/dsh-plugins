# @khorsheed/dsh-game

English | [中文](README.md)

Make a small game with the agent: tell it what you want to play, it builds the game, you play it right there in the sidebar, and if something feels off you just say so.

Making a small game used to mean writing the code yourself, or getting a model to spit out some code and then figuring out how to run it, chasing bugs, and watching every fix break something else. With this plugin you only describe the game you want and how it feels when you play; the agent settles the gameplay and the look with you, builds the smallest version that plays, checks its own work every round, and only puts a version in the right sidebar's "Game" panel once it passes. No game-design experience needed.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-1.png" width="640" alt="The right sidebar's Game panel, Play: live v13 waiting for "Start", then sliders such as walk and sneak speed that take effect as you drag; a game-dev mode session on the left">

## What it does

- **Talk it through before building**: the name, the one-line pitch, the kinds of things in the game, the art style; it asks about each in turn, and for the style you just pick one of the samples.
- **Playable early**: it builds the smallest version you can actually play first, then improves it from how playing it feels to you.
- **Broken versions never reach you**: after every round it checks its own work and fixes what fails on the spot; only a passing version lands under "Play". Want to look before anything goes live? Turn off "Auto-deploy".
- **Tune the feel while you play**: numbers like jump height and run speed become sliders; drag them around and press "Finalize" when it feels right.
- **Change the look of anything you can see**: the hero, enemies, items, even trees, rocks and houses live under "Elements"; draw them yourself, or press "Ask the agent for a new look" and pick from three options.
- **See changes as soon as they land**: whether you edited in the panel or the agent or a Claude Code member changed files, the sidebar says "New changes are not in the game yet"; press "Check and publish" and they go into the game. Every version in "Versions" says whether you or the agent published it.
- **Go back any time**: every version stays under "Versions"; switch back to an old one, or export a single `.html` file and send it to a friend.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-2.png" width="640" alt="The Elements page: one tile per element — mountains, strange beasts, terrain, characters, buildings — each with a preview">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-3.png" width="640" alt="An element opened: the traveler's 3D model you can drag to rotate, with idle, sneak, walk and other animations, front, side and back views, then "Ask the agent to change the look" and its lore">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-4.png" width="640" alt="The Versions page: every change ships as a checked version; below live v13 the history, each with "Switch back", "Compare with v13" and "Export"">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-gamedev-suite
```

The game comes with the Game Dev Suite. Then start a new session, pick "游戏开发模式" (game dev mode), and tell the agent what kind of game you'd like to make.

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
