# Agent Note: Chapter recycling lives on a native canvas page

Status: implemented

## Problem

The first recyclable chapter implementation kept checkboxes permanently visible and opened the recycle bin as a modal. The directory looked like an administration table, the recycle list could not grow comfortably, and its navigation could not use the canvas's native breadcrumb. The Agent card labelled “查看回收站” nevertheless led only to the chapter directory.

## Decision

- Chapter deletion is an explicit selection mode. The ordinary directory has no checkbox column. Delete reveals selection controls and the impact-preview action; cancel or Escape restores the directory without changing its filter or reading position. The final confirmation still uses the host Modal, and completion uses the host Toast rather than opening another window.
- The recycle bin is a `canvas.page`, not a modal. The canvas owns its breadcrumb and back action. The page owns storage, batches, read-only snapshots and selection, while restore and permanent-purge confirmations remain Modals.
- `CanvasNavParams` accepts optional `page` and `param` fields, mapped to `selection.openPageTab`. Agent destinations for completed chapter deletion name `novel:chapter-recycle`, so their door reaches the same native page instead of a generic manuscript face.
- Standard actions use the host Button, Modal, Toast and existing icon set. The plugin does not draw a smaller back button or a parallel button family. Feature CSS handles only layout and semantic states.
- A dedicated read-only Remote returns one retained snapshot's body and plan. Preview and closed operations are excluded, and purged or restored chapters are missing. Derived records never cross this read interface; the recycle list remains metadata-only.

## Alternatives considered

- **Keep the recycle Modal and draw a custom back button.** Rejected: it duplicates the canvas's existing `DetailCrumbs`, makes small-screen navigation inconsistent and leaves long recycle batches cramped.
- **Show checkboxes only on hover.** Rejected: touch devices have no reliable hover, while permanent checkboxes distract from reading. An explicit mode works for both.
- **Include manuscript bodies in `chapterDeletions`.** Rejected: it enlarges every list refresh and mixes durable derived data with a read path that needs only a manuscript and plan.
- **Leave Agent destinations on the manuscript face.** Rejected: the door's label would not match its destination, and users would have to find the recycle entry again.

## Consequences

- Reading and writing remain the directory's default tasks; deletion administration appears only when requested.
- The canvas navigation contract now addresses genre-owned pages as well as cards, manuscripts, type pages and board faces. Other genre pages can use the same typed destination without new private channels.
- Snapshot reads add no mutation path and do not change deletion, restoration, cleanup or permanent-purge semantics.
- Tests cover selection-mode entry and Escape, filtered selection, host Toast navigation, native canvas back behavior, body and plan snapshots, and snapshot disappearance after purge or restore.
