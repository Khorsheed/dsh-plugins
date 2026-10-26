# @khorsheed/dsh-file-preview

English | [中文](README.md)

Every file the agent touched, on one page: what changed, what it looks like now — and you can fix it right there.

After a long stretch of agent work, finding out which files it touched and what they became meant digging through folders and reading diffs yourself. With Session products installed, every file this session read, wrote or edited sits on one page in the right sidebar; open one and you see the rendered document, and can step back through each change the agent made. What you get is a list that grows with the session — and when something is off, you edit it and save on the spot.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview1.png" width="640" alt="The Session products page: the file list and a rendered Markdown preview">

## What it does

- **Every file it touched, on one page**: click "Session products" in the right sidebar's guide page; the files this session touched are listed by latest activity and searchable — files the agent wrote from the command line count too.
- **Opens in a readable form**: Markdown shows as a document, JSON as a foldable tree, CSV as a table, code with highlighting, images as images — local images and links inside a document show and open too; a web page with scripts asks first, then runs them in an isolated sandbox.
- **Step back through every change**: switch to "Changes" and page back through each write and edit the agent made to the file.
- **A small card after every turn**: each turn in the conversation ends with an "N products" card listing the files it changed and the lines added and removed; click to open one.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview2.png" width="640" alt="A file's change history: step back and forth through each diff">

- **Spot it, fix it**: click "Edit", change the text, watch "Preview" follow along, and save with ⌘S or "Save". If the agent changed the file while you were editing, you're told and choose "Overwrite anyway" or "Discard and reload"; switch to another file and back, and your unsaved draft is still there.
- **One click back to your tools**: "Copy path", "Show in folder" and "Open in IDE" work when the page is open on the host machine.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview3.png" width="640" alt="The Session products page: every file the session wrote at a glance">

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click install:

```
@khorsheed/dsh-file-preview
```

It also comes with 基础体验 (the basic suite, `@khorsheed/dsh-basic`). Once installed, open "Session products" from the right sidebar's guide page in any session, or click an "N products" card in the conversation.

## Known limitations

- It lists only the files the current session touched; to browse any folder on your machine, use the Files plugin.
- On a phone it is view-only; images, non-UTF-8 files and very large files can't be edited either.
- Files it can't display, such as PDFs and archives, open in DSH's built-in preview instead.

## Compatibility

Requires DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (the host service that reads and writes files), `src/client/index.ts` (the sidebar page and the turn cards). From the command line: `dsh plugin --profile web add @khorsheed/dsh-file-preview`.
- Service methods, configuration, the read-only surface for server-side callers, compatibility details and internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/file-preview/docs/reference.en.md).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — issues and contributions go there; changes are in [CHANGELOG.md](CHANGELOG.md).
