# Agent Note: Chapter deletion is a previewed, recyclable operation

Status: implemented

## Problem

Users and agents could delete cards, events and ideas, but not chapters. A chapter is simultaneously a registration in `chapters.json`, a Markdown file in a mounted workspace, and contributions to timelines, people, relations, foreshadows, pending reviews, feedback and alignment. Deleting only the file leaves active memories; deleting only the registration leaves an unreferenced manuscript and eventually reuses its number. The session asking for chapters 3–6 to be removed had both reconciled chapters and duplicate planning chapters, so a plan-only shortcut was not enough.

## Decision

- Deletion has one planning/execution model. The existing `deleteNode` remains the compatibility entry for non-chapter nodes and joins chapter operations in a per-work mutation queue. Chapters use a dedicated strategy because they own files and derived memories; unrelated graph cleanup is not reused blindly.
- Chapter identity is separate from the display number. Tombstoned generations retain only a generic title, id, number, file name and operation id. Restored chapters are new generations with a fresh id. A display number can therefore be reused without inheriting alignment state, browser drafts or old memories.
- Preview persists the exact chapter records, body versions, derived rows and cascade candidates before anything changes. Agent apply requires a later user message after the preview. Changed records or body fingerprints refuse execution as `stale`; `chapter + delete=true` is rejected instead of becoming an accidental plan update.
- Applying writes tombstones first, then removes source files with version guards, rewrites derived documents, removes chapter-owned journal rows and archives eligible cascade cards. Shared events lose only the deleted contribution, and ideas lose only their written-in marker. Manual mind corrections, user history edits and manual relation-stage changes survive.
- Cleanup is idempotent and reports `cleanup-pending` separately. Reads exclude deleted generations and their contributions even before cleanup finishes, while number reuse stays blocked until retry succeeds. Abandoned previews expire after 24 hours; accepted snapshots stay indefinitely.
- Restoration writes bodies with `createIfAbsent`, supports original or next-free numbering, and restores only bodies and plans with a fresh generation id. It does not replay old journals: chapters with text become `writing` and must reconcile again. Cascade cards restore only by explicit selection. Permanent purge removes selected snapshots and deletes cascade cards only while they remain archived; session logs, external copies and backups are outside its scope.
- Remote and browser surfaces expose impact preview, apply, recycle listing with per-chapter and total sizes, selected restore/purge and empty-all. The Agent uses `what=delete` with `chapters`, `deletionId` and `phase=preview/apply/restore/purge`. Navigation returns to the chapter book rather than a deleted chapter.
- Shared cards are not rolled back speculatively. Their affected nodes are invalidated for the existing targeted alignment flow instead of rewriting history as though it were a reliable inverse patch.

## Alternatives considered

- **Delete only the Markdown file or only the registration.** Rejected: either leaves active story memory or an unowned file, and it cannot support safe restoration.
- **Extend `deleteNode` with the same rules as cards.** Rejected: chapters own different resources and need body snapshots, retryable cleanup and restoration semantics that cards do not have.
- **Permanently forbid number reuse.** Rejected: deleting trailing chapters to rewrite them should allow the next chapter to take the first freed number, with a new internal identity.
- **Restore the whole book to its exact pre-chapter state.** Rejected: later reconciliation and user edits make inverse card updates unsafe. Targeted alignment is the honest boundary.
- **Keep every preview forever.** Rejected: abandoned previews would grow state without user value. Accepted snapshots have a different retention rule and stay until restored or purged.

## Consequences

- Users and agents can delete planning or reconciled chapters in one batch, see exactly what leaves with them, and restore a specific chapter without reviving other deleted content. Original files are removed only after their snapshots exist.
- Multi-file deletion is not claimed to be atomic. Tombstones are the commit point, version guards protect each file, reads remain consistent during partial cleanup, and retry is explicit. Restore/purge after a failed operation may require resolving the reported cleanup first.
- Permanent purge is not secure erasure or deletion of every trace. It clears plugin-controlled content while retaining non-content generation and operation metadata. External copies, session history and system backups remain outside the operation.
- Editor caret and scroll restoration follows the same chapter identity as drafts. Records without an id retain the legacy numeric key; once an id exists, reusing a number cannot restore the previous generation's editing position.
- Storage, tools, Remote and client tests cover generation identity, physical deletion, derived-memory filtering, stale previews, later-message confirmation, partial restore/purge, cascade archiving, cleanup retry, empty-all and the browser interactions. The package build and all 334 tests pass, including editor-position isolation across reused chapter numbers.
