# @khorsheed/dsh-gamedev-suite

English | [中文](README.md)

A mode for making small games with an agent: settle the gameplay in chat, it writes the code and keeps the design notes, and you play the latest version that passed its checks right in the sidebar.

Making a small game used to mean writing the code yourself, or having a model write it and then working out how to run it, hunting bugs, and watching fixes break something else. In game dev mode, say what kind of game you want and the agent gives you two or three options for each question to pick from; once it's settled, it builds a small playable version first, you play it and say how it feels, and it improves it bit by bit. Every round is checked automatically: if something fails, it fixes it on the spot, and only a passing version reaches your sidebar. No game-design experience needed.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-gamedev-hero.png" width="640" alt="A game-dev session: this round's change card at the end of the chat, and the Game panel in the right sidebar playing the latest version">

## Things you can say to the agent

- "I want a little game about dodging meteors. Give me a few gameplay directions first."
- "The hero doesn't jump high enough. Raise it a bit and send me a new build."
- "Add an enemy that chases the player."
- "Fill in the levels chapter of the design."

## What's inside

- **Game**: the "Game" panel in the right sidebar. Play the latest version and tune the feel in "Play"; change looks and lore in "Elements", then press "Commit as a new version"; "Design" keeps what you've decided, chapter by chapter; "Versions" takes you back to any earlier one. At the end of each round, a card at the bottom of the reply lists what changed, and "View" jumps straight to it.
- **Your local coding tools** (Kimi, Codex, Claude Code, plus Local DSH Delegation, off by default): hand them part of the work when there's a lot to do.
- **Room**: bring several agents into one session to build a game together.

The agent asks at most two questions at a time, and every decision is yours. The whole game is one folder in the session's workspace, versions and play records included, so copying the folder takes it all with you.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-gamedev-suite
```

It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files. Then start a new session, pick "游戏开发模式" (game dev mode), and tell the agent what game you'd like to make.

All of this only shows up in game-dev sessions; not seeing it in other modes is expected.

## Known limitations

- Everything on screen is drawn by code; there's no AI image generation.
- The automatic checks use Chrome on your computer.
- You can't export a game or share it with others yet.

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## For developers

Command-line install (same result as above):

<!-- collection:start -->
Recommended: install it together with the basic suite (the Gamedev collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```
<!-- collection:end -->

- This package has no features of its own; it installs game dev mode and the members above together. Uninstalling (`dsh plugin --profile web remove @khorsheed/dsh-gamedev-suite`) removes them together too; to turn off just one, switch it off on the suite's detail page.
- Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
