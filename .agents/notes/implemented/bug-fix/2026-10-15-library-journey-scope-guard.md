# Agent Note: Library — a project path parked on a single book is refused toward the book (journey scope guard)

Status: implemented

## Problem

The two journeys diverged in the wild: asked to plan one book inside the 数学 project, the coach drafted the PROJECT's path with every station covering only 《普林斯顿微积分读本》 — a book route parked on the project, leaving the book itself route-less and the learner facing two half-journeys. `validateRoadmapShape` already enforced the one direction (a book's own path covers that book only) but not the mirror, and the prompt's "paths beyond one book" prose had no teeth.

## Decision

- `validateRoadmapShape` gains the mirror guard: on a project-scope draft (no `bookId`), when every cover of every node is a book cover naming the same single book, refuse with a teaching message that names the book and says to resend with `book: <id>`. A second book, or any non-book cover (resource / url / topic), keeps it a genuine project path.
- `LIBRARY_PROMPT`'s paths rule states the mirror explicitly: a route whose every station covers the same single book IS that book's path — pass `book`, never park it on the project.

## Alternatives considered

- **Prompt-only guidance**: rejected — the prose rule already existed and the model still parked the route; a mechanical refusal is the correction that cannot be missed.
- **Allow and render as the book's path**: rejected — two scopes holding the same journey would fork progress and quiz ledgers.

## Consequences

- The material-book evidence-gate fixture moves onto the book's own path (where a lone book's stations belong); the gate's behavior itself is unchanged.
- Misfiled paths already adopted are not rewritten: the learner asks the coach to re-draft on the book, and the next genuine project draft replaces the parked one.

## Testing

`service.spec.ts` (+1: all-single-book project draft refused toward the book; the same book plus a topic station passes). `tool.spec.ts` (the cover-alias test now drafts a genuine two-source project path). `pnpm --filter @khorsheed/dsh-library test` 111/111 green.
