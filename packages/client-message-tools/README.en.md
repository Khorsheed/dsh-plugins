# @khorsheed/dsh-client-message-tools

English | [中文](README.md)

Take back or rewrite what you already sent — and a withdrawal really makes the model forget, it doesn't just hide the message on screen.

Said something too fast, or the conversation went off course? Until now you could only send another message to patch it up, and the detour stayed in the model's memory. With Message Tools, every message you send gets a small row of buttons: want to say it differently, hit edit, change it and resend, and the model answers the new text; want it unsaid, hit withdraw, and the model no longer sees that message or anything after it — while the original text goes back into your composer for you to fix and send again.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions1.png" width="560" alt="copy, edit, and withdraw action buttons under a user message">

## What it does

- **Edit and get a fresh answer**: hit edit and the message turns into an input box in place — you can switch the model too; "Save and resend" and the model answers again from there. Edited messages can be edited again.
- **Withdraw means forgotten**: the message and everything after it leave the model's context; the conversation keeps only a "Withdrawn N messages" line you can expand to read the original.
- **Your words come back to the composer**: the withdrawn text lands back in the input box for you to rework — it is never sent for you.
- **Changed your mind? Put it back**: "Restore to the end of the conversation" brings the withdrawn content back, as it was, at the end.
- **Long messages fold up**: a pasted wall of text folds to about ten lines; "Show all" opens it. The newest message always stays open.
- **Mentioned sessions read at a glance**: when you @ another session in a message, the bubble shows a small tag with that session's title instead of a raw link.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions2.png" width="560" alt="in-place editing: the message becomes an input with a model picker; saving re-sends it as a new message, and the edited original leaves the model context">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions3.png" width="560" alt="the confirmation dialog before withdrawing, explaining that the message and everything after it will be hidden from the model and the original text backfilled into the composer">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions4.png" width="560" alt="withdrawn content folds into an expandable divider with a restore-to-end-of-conversation button at the bottom">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions5.png" width="560" alt="restored messages return to the tail of the conversation as they were, grouped under a Restored section">

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click Install:

```
@khorsheed/dsh-basic
```

Message Tools comes with Basic Essentials. Once installed, the button row sits under every message you send, in any session.

## Known limitations

- Edit and withdraw bring back text only: images in the original message are not resent or put back in the composer — upload them again if you need them (they stay visible in the withdrawal record).
- Restore puts the content back at the end of the conversation, not in its original place; the agent's tool calls from back then are not replayed.
- Messages still waiting in the queue are not covered — edit those from the queue bar above the composer.

## Compatibility

Requires DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Per-host-line compatibility details, how edit / withdraw / restore work and what they do to the model's context: see the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/client-message-tools/docs/reference.en.md).
- You can also install it alone: enter `@khorsheed/dsh-client-message-tools` in Add plugin, or run `dsh plugin --profile web add @khorsheed/dsh-client-message-tools`, then restart.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — file issues and contributions there; changes are in [CHANGELOG.md](CHANGELOG.md).
