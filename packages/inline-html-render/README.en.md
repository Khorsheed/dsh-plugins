# @khorsheed/dsh-inline-html-render

English | [中文](README.md)

When the agent says "let me show you", it really does: the small web page it writes becomes a live, clickable card right in the conversation.

Before, an agent that wanted you to see something could only paste code for you to imagine, or write an HTML file and wait for you to open it. With Inline Cards, say "make me a card", "show me a few color schemes side by side", and it draws a card in the middle of its reply: buttons click, tabs switch, animations move — right where it is talking, and the conversation carries on below.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/inline-html-card-1.png" width="640" alt="a dsh-card block in the middle of an agent reply, rendered as a tabbed data-observation card that flows with the surrounding text">

## What it does

- **Ask to see it, and it draws it**: when you want to see an effect, a small widget, or a few options compared, the agent decides on its own to draw a card — nothing to teach it.
- **The card lives in the reply**: it sits between paragraphs, flowing with the text around it, not in a sidebar and not as an attachment to open.
- **Really interactive**: hover, click, switch tabs, charts and animations all work — it is not a screenshot.
- **3D scenes too**: to look at a 3D model or scene, the agent can write a single-file 3D page straight into the conversation.
- **Safe to look at**: the card runs in a sandbox, can't touch your page or login, and can't reach the network; its links open only in a new window or the right-sidebar browser.
- **Nothing breaks without it**: without the plugin, the same content just shows as an ordinary code block.

## Install

In DSH, open Plugins → Add plugin, enter the package name below, and click install:

```
@khorsheed/dsh-basic
```

Inline Cards come with the Basic Essentials suite. Once installed, tell the agent in any session "make me a card to show it" to try it.

## Known limits

- Cards can't go online; for something that loads web resources, open it in the file preview instead.
- When the conversation re-renders, cards reload, so anything typed into a card and its scroll position are lost.
- A card grows with its content, up to about 20000 pixels tall.

## Compatibility

Needs DSH 0.1.2-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- The card authoring protocol (the `` ```dsh-card `` block), the sandbox and capability bridge, how cards are detected on the page, and the internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/inline-html-render/docs/reference.en.md); the complete protocol is in the bundled skills `skills/inline-html-card` and `skills/3d-artifact`.
- Entry points: `src/index.ts` (registers the two skills), `src/client/renderer.ts` (swaps code blocks for cards). Standalone install: `dsh plugin --profile web add @khorsheed/dsh-inline-html-render`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
