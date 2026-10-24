# @khorsheed/dsh-basic

English | [中文](README.md)

One install brings the small things that make DSH pleasant every day: messages you can edit and withdraw, a clear view of what the agent changed, and what's running in the background.

Without it, a message sent by mistake stays as it is, you dig around to find which files the agent wrote, you can't tell whether a background task finished, and nobody warns you when the context is nearly full. With Basic Essentials, that's taken care of: you chat as usual, and it lays out the changes, tasks and progress beside you. No picking features one by one, and your plugin list gains just one "Basic Essentials" card.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/basic-mode.png" width="640" alt="A session with Basic Essentials: edit and withdraw on a message, the quote menu on selected text, session artifacts and the file list in the sidebar">

## What you can do right away

- Sent something wrong? Press "Withdraw" and the text goes back to the input box, and the model no longer sees it or anything after it. Or edit it and press "Save and resend".
- Want to look back? Click the timeline on the left of the chat to jump to anything you said.
- Want to see what the agent changed? Open a file it wrote in the sidebar and step back through each change.
- Ask the agent to "make a little clickable card": the HTML it writes shows up in the chat as a card you can use.

## What's inside

- **Message Tools**: edit or withdraw a sent message; withdrawn text leaves the model's context.
- **Message Timeline**: a timeline on the left of the chat; click to jump back to what you said.
- **Title Edit**: rename the session right next to its title.
- **Quote**: select some text, then "Quote to current chat" or "Copy".
- **Inline Cards**: HTML the agent writes appears in the chat as a card you can interact with.
- **Context Guard**: once the context reaches the share you set, a "compact" button appears by the input box.
- **Background Tasks**: background tasks and sub-agents sit above the input box, and you can stop them any time.
- **Session Artifacts**: preview the files the agent wrote or changed, change by change.
- **Local Files**: browse any folder on your computer and preview web pages, Markdown, spreadsheets and images.
- **Capability Catalog**: lists every skill and tool in this DSH and where each one came from.
- **Mobile**: works well on a phone, and connects to the iOS client.
- **Whalesong**: a whale spouts while a task runs, and a sound plays when it finishes or gets stuck.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-basic
```

No mode to pick; it works in every session. For a dedicated mode (coding, writing, learning and so on), install that suite as well, for example `@khorsheed/dsh-dev-suite`.

## Known limitations

- Uninstalling removes all twelve together; to turn off just one, switch it off on the Basic Essentials detail page.
- It brings no mode of its own; dev, writing, learning, video, game dev and eval modes come with their own suites.

## Compatibility

Needs DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Command-line install: `dsh plugin --profile web add @khorsheed/dsh-basic`; swap `add` for `remove` to uninstall.
- This package has no features of its own; it installs the twelve members above together. Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
