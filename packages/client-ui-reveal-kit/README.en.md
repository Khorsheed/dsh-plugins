# @khorsheed/dsh-client-ui-reveal-kit

English | [中文](README.md)

When the agent finishes something, or wants you to look at a particular place, the plugin's panel goes there on its own — but leaves you alone while you are busy in it. You never install it separately: plugins such as Game already build it in.

## What it is

A build-time shared source library (unpublished, `private: true`), the same shape as the panel base `@khorsheed/dsh-client-ui-panel-kit`: plugins depend on it with `workspace:*` and import its sources directly, so it is inlined into each plugin's own `lib/client.js`. It registers nothing.

It provides:

- **`RevealController`**: decides between going there and only showing a notice. It only shows a notice while you are in the middle of something (playing back, play-testing), within 20 s of a click or key press in the panel, or while you look at another item. It does not open a closed panel in a window narrower than 820 px. Each browser has one switch, on by default. Every decision leaves a `[reveal:plugin] …` line in the browser console, so "why did it not jump" has an answer. The agent's requests are acted on once each, by sequence number, and an old request found on a reload is ignored.
- **`visiblePoll`**: polls only while the page is visible, and session events can nudge it early. A plugin's host cannot push to the page, and a room member's work raises no event on the main session, so the page has to look for itself.
- **`RevealNoticeBar`**: a held-back jump becomes a notice at the top of the panel, with 去看看 (go) and 不用了 (not now).

```ts
import { RevealController, RevealNoticeBar, visiblePoll } from '@khorsheed/dsh-client-ui-reveal-kit/src/client/index.ts'
```

The caller passes every visible word; colors come only from the host's `--dsw-alias-*` variables.

## The host half (each plugin writes its own)

A plugin's host build compiles only its own sources, so this half is a convention rather than shared code. It takes about a dozen lines:

1. Register the plugin's own tool, named with its prefix (such as `game_show`). Its parameters are places in the plugin's panel, plus a `note` saying what to look at.
2. The tool keeps requests in memory: the latest `{ seq, target, note, at }` per project (or book, or edit), with `seq` increasing.
3. The Remote that the page already polls returns that request too, and the page calls `controller.request(project, seq, target, text, fresh)`.

The game plugin is the first adopter: `requestShow` and `liveVersion` in `packages/game/src/store.ts`, `game_show` in `src/tools.ts`, and `src/client/autonav.ts`.

## Compatibility

Requires DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- The host has no native channel yet for the agent to ask the UI to show something (a server push). Once it has one, the `visiblePoll` layer switches to it and the plugins' tools stay as they are. Registered in [docs/upstream-seam-registry.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/upstream-seam-registry.md).
