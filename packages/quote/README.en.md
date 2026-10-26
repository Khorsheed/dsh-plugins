# @khorsheed/dsh-quote

English | [中文](README.md)

See a line you want to ask about? Select it and quote it into the composer in one click.

To follow up on a passage from an assistant reply or a file preview, you used to copy it, switch back to the composer, paste, and then write "about what you said above…". With Quote, select any text in DSH and a small menu pops up beside it: click "Quote to current chat" and the passage lands in the composer with its source, ready for your question. It is never sent for you.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-1.png" width="640" alt="the quote action menu floating beside a selection in an assistant reply">

## What it does

- **Select and quote**: in assistant replies, file previews and reader articles, selecting text brings up the menu; selecting inside the composer leaves you alone.
- **The source comes along**: a quote from a file carries the file name, a quote from an article carries its title, so the agent knows exactly which passage you mean.
- **Your half-written message stays intact**: if the composer already has text, the quote goes after it as a new paragraph, never over it; the quote ends with a line break, so whatever you type next is your question.
- **Check what you quoted**: in the composer the quote is a small tag — click it to see the full text.
- **Easy to spot once sent**: in the sent message the quote shows as a card with its source.
- **Or just copy**: "Copy" takes the original text to the clipboard.
- **Other plugins add their own options**: with the canvas installed the menu gains "Save as canvas card"; with the reader installed, articles gain "Take a note".

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/quote-2.png" width="640" alt="the same quote menu floating over a selection in the file preview panel">

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click Install:

```
@khorsheed/dsh-basic
```

Quote comes with Basic Essentials. Once installed, open any session and select some text to try it.

## Known limitations

- Quotes are plain text: tables and code blocks become ordinary text, and a quote does not link back to its original spot.
- The quote tag in the composer is one block — you can't edit it letter by letter; Backspace removes it whole.
- Scrolling or zooming closes the menu; just select again.

## Compatibility

Requires DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- How the selection menu works, the interface other plugins use to add menu options (`ctx.quoteActions`), and how it degrades per host version: see the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/quote/docs/reference.en.md).
- You can also install it alone: enter `@khorsheed/dsh-quote` in Add plugin, or run `dsh plugin --profile web add @khorsheed/dsh-quote`, then restart. It stores no data, so uninstalling leaves nothing behind.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — file issues and contributions there; changes are in [CHANGELOG.md](CHANGELOG.md).
