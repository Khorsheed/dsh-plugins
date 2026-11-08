# Agent Note: Chapter identity is separate from the display chapter number

Status: implemented

## Problem

A novel chapter's number `n` was also its graph identity, journal reference, alignment key and browser-draft key. Deleting a trailing chapter and later reusing its number would therefore attach old memories and drafts to a different manuscript. Moving chapter deletion onto that model would either forbid useful rewrites or corrupt new work.

## Decision

- `ChapterRecord` carries an optional durable `id`; existing rows normalize to their original `ch:<n>` identity, while newly created chapters receive a fresh `ch_<uuid>`. The field is optional only for pre-migration data and hand-built fixtures.
- `n` remains the display number and file-number input, `seq` remains the ordering key, and existing Agent and Remote chapter requests are unchanged. Chapter creation may eventually reuse a number without reusing an identity.
- Graph nodes carry the chapter number as metadata rather than parsing it from the node id. Edges, delete impact, alignment baselines and acknowledgement use the generation id; display and impact reports continue to use `n`.
- Recap events and reconciliation acknowledgement use the same identity, so acknowledging one generation cannot acknowledge another generation with the same number.
- Browser draft keys include the generation id, preventing an old draft from opening in a later chapter that reuses the number and file name.

## Alternatives considered

- **Keep numbers permanently monotonic.** Rejected: deleting trailing chapters to rewrite them would make the next chapter jump unexpectedly, and it would not address old browser drafts or stale references on its own.
- **Renumber every surviving chapter after deletion.** Rejected: it would rewrite chapter references and make existing navigation and journals ambiguous.
- **Parse chapter numbers from node ids.** Rejected: a number is a user-facing location, not a durable identity.

## Consequences

- Legacy chapter data needs no eager migration, and all existing read/write calls keep their current shape.
- New chapter ids are stable across title, plan and body edits. Different generations may share a number without sharing alignment or draft state.
- The package build and all 310 tests pass, including a graph case proving that a new-generation id preserves edges and impact reporting.
