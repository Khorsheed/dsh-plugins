# Agent Note: deleting a game project from the panel

Status: implemented

## Problem

A game project could be created and switched to, never removed: the registry row stayed in the switcher forever, sessions stayed bound to it, and its folder stayed in the workspace. The user asked for a way to delete a project completely from the UI.

## Decision

Each project card in the switcher has a delete affordance (always visible — touch has no hover). It flips the card into an inline confirmation with two actions:

- **Move to trash** (`deleteProject(…, 'trash')`): the registry row and every session binding to the project are removed, and the project folder moves to the system trash (`src/trash.ts`): a rename into `~/.Trash` on macOS, the freedesktop trash with a `.trashinfo` restore record on Linux. Complete, yet recoverable.
- **Remove from list only** (`'forget'`): the row and bindings go; the folder stays, and `game_open path` can register it again.

Guards, all checked before anything changes: the folder must still hold this project's own `game.json` (`not-a-project` otherwise — a registry row pointing at a folder that now holds something else is never trashed), it must not be the calling session's workspace itself (`is-workspace`), and a read-only session may do neither (`denied`). A failed move (another platform, or a folder on a different volume than the trash) answers `trash-failed` with the reason and changes nothing, and the card offers "remove from list only" instead. Deletion is panel-only: the model has no tool for it.

## Alternatives considered

**Delete the folder outright.** "Completely" is met either way, but a project holds the user's code, assets and design writing; one wrong click would be unrecoverable. The trash keeps the delete complete from the plugin's and the workspace's point of view while leaving the user a way back.

**macOS Finder via AppleScript (with "put back").** It can prompt for automation permission from the host process mid-click, and a background host cannot answer it. A rename into `~/.Trash` needs no permission.

**A model-facing delete tool.** Destructive and rarely wanted from a conversation; the user does it in the panel, where the confirmation is.

## Consequences

- On a platform without a supported trash (Windows) only "remove from list only" succeeds; the folder is left for the user.
- macOS trash entries do not carry "put back" metadata; the folder keeps its name (time-stamped on a clash) and can be dragged back.

## Testing

`tests/store.spec.ts` covers forget (folder kept, row and binding gone), every guard (`not-a-project`, `is-workspace`, a failed move leaving the row in place), and trash (folder moved, every binding removed, a second delete answering `not-found`). `tests/trash.spec.ts` covers the macOS rename with name de-duplication, the Linux files/info layout with the restore path, and the refusal elsewhere leaving the folder untouched.
