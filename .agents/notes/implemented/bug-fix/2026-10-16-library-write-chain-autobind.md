# Agent Note: Library — writes bind the session as they land; a book id resolves its project

Status: implemented

## Problem

A live onboarding session (2026-10-16, relayed by the learner) hit every seam of the write chain: an unbound `write·book` refused for want of `project`, so the coach bound by hand and re-sent; an acceptance list on a quiz station was refused with only the goals exit named; a draft meant for the project landed on the book because the coach passed `book` out of habit; and the whole chain — create the project → register the book with its id → bind the session → draft — was order-sensitive with nothing stringing it.

## Decision

- **Auto-bind on successful writes** (`autoBind`, tool layer): creating or editing a project, registering a book, drafting a roadmap, composing a quiz, adding a shelf link — each binds the session to what it touched, when the session is unbound, or bound to the same project without a book (registering the book upgrades it). A session bound to another project, or already holding a book, is never touched.
- **A book id resolves its project**: `projectOf` falls back to `service.findBookOwner` — once a book exists, no call in the chain needs the project spelled out.
- **The draft result says where it landed**: `write·roadmap` returns a `scopeNote` naming the book's path or the project's own — the derived scope is confirmed in the result, not left to be discovered in the sidebar.
- **The acceptance-misplacement refusal names both exits**: `kind: "practice"` (the lines are judged one verdict each) vs `goals` (descriptive expectations while a quiz gates the station).

## Alternatives considered

- **Implicit project creation on an unbound book write**: rejected — a project is a named learner decision; the refusal keeps teaching, and auto-bind makes the taught path shorter.
- **Coercing kind to practice when acceptance arrives**: rejected — the intent is ambiguous (a quiz station with descriptive criteria vs a hands-on station); the refusal names both exits instead of guessing.

## Consequences

- The onboarding chain is three calls with zero id-passing: create → register → draft.
- `write·binding` / `binding: null` still override; auto-bind never overwrites an existing binding (the same-project book upgrade aside).

## Testing

tool.spec.ts (+3): create → register → draft with no id passing while the binding upgrades at each step; a book id resolving its project for an unbound session; the acceptance refusal naming both exits. 130/130 green.
