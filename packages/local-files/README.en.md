# @khorsheed/dsh-local-files

English | [中文](README.md)

Browse any folder on your machine from the right sidebar — open a file to read it, and fix it right there.

To glance at an assets folder next to the workspace or a data file outside the repo, you used to switch to the system file manager, and then got raw source you had to read through. With Files installed, the right sidebar can browse any folder on your machine: it starts at the current session's working directory and can move anywhere else; open a file and web pages, documents and tables are already rendered. What you get is your local files, searchable and editable, without leaving the conversation.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-files-1.png" width="260" alt="The start page's entry card: Files, opening the session's working directory by default">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-files-3.png" width="560" alt="The Files page: the repo's file tree on the left, a README.md open on the right with its images shown in the preview, and edit, reload and show-in-folder in the title row">

## What it does

- **Browse wherever you like**: it opens at the current session's working directory; "Choose workspace" moves to another folder and is remembered next time, and "Back to original workspace" brings you back. Files outside the repo, untracked or ignored, all show up.
- **Find files by name**: click the magnifier above the tree and type a file or folder name; matches open up along with the folders they sit in.
- **Opens in a readable form**: web pages, Markdown, JSON and CSV are rendered, images are shown, local images and links inside a document show and open too, and you can search inside the content; when the file changed on disk, "Reload" brings in the latest.
- **Spot it, fix it**: click "Edit", change the text, watch "Preview" follow along, and save with ⌘S or "Save". If the agent changed the file while you were editing, you're told and choose "Overwrite anyway" or "Discard and reload"; switch to another file and back, and your unsaved draft is still there.
- **One click back to your tools**: "Open this folder", "Show in folder" and "Open in IDE" work when the page is open on the host machine.
- **Works on a phone too**: in a narrow panel the list and the file detail take turns on screen, and the path folds into one tappable breadcrumb.

## Install

In DSH, open Plugins → Add plugin, enter the package name below and click install:

```
@khorsheed/dsh-local-files
```

It also comes with 基础体验 (the basic suite, `@khorsheed/dsh-basic`). Once installed, click the "Files" card on the start page or the right sidebar's guide page. It replaces DSH's own "Workspace files" card, which comes back if you uninstall.

## Known limitations

- It can't create, rename or delete files; on a phone it is view-only, and images, non-UTF-8 files and very large files can't be edited either.
- Text shows up to 2 MB at a time and is cut off beyond that; images over 2 MB aren't shown.
- It can reach every file the host machine's user can read — keep that in mind when several people share one DSH.

## Compatibility

Requires DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (the host service that reads and writes local files), `src/client/index.ts` (the sidebar page). From the command line: `dsh plugin --profile web add @khorsheed/dsh-local-files`.
- Service methods, read windows, compatibility details and internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-files/docs/reference.en.md).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) — issues and contributions go there; changes are in [CHANGELOG.md](CHANGELOG.md).
