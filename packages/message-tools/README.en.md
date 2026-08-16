# message-tools

A dsh plugin that adds **edit** and **withdraw** to user messages.

The agent said something wrong? No need to restart the conversation. Edit the message in place and resend, or withdraw it — withdrawal also handles the file changes the turn triggered, and can restore them later.

## Install

Requires a dsh host:

```sh
npm install @deepseek-ai/dsh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
npx @deepseek-ai/dsh web
```

Ready to use, no config. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-message-tools
```

## What it does

**Edit**: hover any user message to reveal the edit button. The message becomes an inline input in place; resend and the model sees the edited content.

**Withdraw**: the same spot has a withdraw button. A confirmation dialog lists the file changes this turn caused (which files, lines added/removed). On confirm:
- this message and the turn's reply are hidden from the conversation
- the file changes are snapshotted (files are not deleted)
- a divider line appears in the conversation marking "N messages withdrawn"

**Withdraw undo**: restoring the withdrawn messages and file changes on the divider is planned (file snapshots are ready).

## How it works

- **Zero intrusion**: uses dsh's slot shadow mechanism (priority -1) to take over user-message rendering; official code untouched, restored on uninstall
- **Official components**: confirmation uses official `RiskConfirmation`, buttons use official `Button`, styling follows theme tokens (dark/light adapts)
- **Event persistence**: edit/withdraw append to the session log (`user/message/edited` / `user/message/withdrawn`, with `ignorable` marker)
- **File snapshot**: withdrawal stores affected file content in the session state dir for undo

## Development

```sh
git clone https://github.com/Khorsheed/dsh-client-message-tools.git
cd dsh-client-message-tools
pnpm install && pnpm run build && pnpm test
```

## Platform

Requires the dsh web host (macOS / Linux).

> Status: edit, withdraw, file snapshot implemented (14 tests). Withdraw-undo UI is the next milestone.
