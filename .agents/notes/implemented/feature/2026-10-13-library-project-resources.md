# Agent Note: Library project resources — light link entries on the shelf (project-paths M1)

Status: implemented

## Problem

The library only accepted registered books: a whole table of contents, verified on the web, just to point the learner at one article or one repo. The scenarios the project-paths proposal (`proposals/active/2026-10-13-library-project-paths.md`) answers — "teach me LLM + embodied AI from scratch" — have no single textbook: the materials are repos, simulators, tutorials, hardware. Those need a shelf entry, not a book.

## Decision

A RESOURCE is a light link entry on a project's shelf, beside the books: `{ id, title, url, kind: article|video|repo|tool|course|hardware, note?, addedBy: coach|learner, createdAt }` — no contents, no roadmap, never quizzed (what the coach references BY CHAPTER is still registered as a book). One entry per url per project.

- **Store** (`packages/library/src/store.ts`): `projects/<id>/resources.jsonl`, appended on add; removal rewrites the ledger without the line — a resource has no status machine, so there is no tombstone to keep (contrast cards' `deleted`). `normalizeResource` requires id/title/url and defaults a drifted kind to `article` and addedBy to `coach` (the normalizeBook precedent), so a forward-written row still reads.
- **Service** (`service.ts`): `addResource` / `removeResource` / `listResources`, in the assertAlive + readProjectOrRefusal + mutate shape. Add validates the url (`^https?://`), the kind enum and a non-empty title, and refuses a same-url duplicate with `exists` (the message teaches remove-and-re-add). The add ledgers `resource.added` carrying only the entry id — `LibraryEvent`'s existing fields suffice, and the row's `at` is all the pane's latestActivity poll needs to refresh.
- **Remote** (`remote.ts`): the three verbs under the `library` namespace, one-line delegations.
- **Tools** (`tool-definition.ts`): `library_read · resources` lists the shelf; `library_write · resource` carries `op: add|remove` (add: `{ title, url, kind, note? }`, addedBy defaulting to coach; remove: `{ id }`). Refusals keep teaching the correct call.
- **Sidebar** (`client/views/home.tsx`): the project page gains a 「资源 · N」 section under the shelf — compact rows (a kind tile, the title opens the url via window.open, the one-line note), an empty state, and the add affordance splits into 加书 / 加链接 (a second header action plus the section's own button). 加链接 primes the conversation exactly like 加书: the learner pastes the url, the coach opens it on the web and fills title / kind / note.

## Alternatives considered

- **Register everything as a book**: rejected in the proposal — a repo or a robotic-arm kit has no contents to verify; registration's weight (a web-checked toc) buys nothing for a whole-of-work reference.
- **A read/unread status machine on resources**: the M1 line is deliberately a ledger, not a second quiz axis; referencing resources from roadmap nodes is M2's covers.
- **getProject returns resources**: rejected — the project summary stays cheap; the shelf section reads its own verb, exactly like pages and cards.
- **A sidebar remove gesture**: removal stays a coach action in the conversation, so the pane consumes `listResources` only and ships no delete affordance.

## Consequences

- A project now holds a no-textbook scenario's materials; books keep their monopoly on chapter-level referencing.
- `resources.jsonl` joins the per-project directory; nothing migrates (an absent file reads as an empty shelf).
- `resource.added` extends the event vocabulary additively; older builds reading a newer ledger skip the unknown type (normalizeEvent drops it).

## Testing

`store.spec.ts` (append / read / remove, torn-line tolerance, normalize floors), `service.spec.ts` (url / kind / title validation, duplicate refusal, the event ledger, not-found), `tool.spec.ts` (the bound-session round-trip, payload teaching errors, the updated what-list pins), `capabilities-dispose.spec.ts` (the three verbs join the dispose enumeration). `pnpm --filter @khorsheed/dsh-library build && test` green; `pnpm check:panels --package packages/library` clean.
