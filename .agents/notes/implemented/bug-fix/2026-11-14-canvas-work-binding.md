# Agent Note: every canvas can be the session's bound work

Status: implemented

## Problem

The session header offered to bind a work, but both its menu and the store accepted only canvases with a genre. A plain canvas could already hold cards and manuscripts, yet it disappeared from that menu and its session target lived only in process memory. Agent-created genre canvases bound automatically, while canvases created through the sidebar only received transient focus. Clearing a genre also discarded an otherwise valid session target.

## Decision

- Every live canvas is bindable. Genre selection remains an independent capability grant: genre-owned tools still inspect the bound canvas's genre instead of treating every bound canvas as a novel.
- `canvas_open` binds both plain and genre canvases on creation or switch, and records focus as before. The sidebar's create form explicitly binds the new canvas through the same Remote before opening it. A failed bind is reported without pretending that creation failed.
- Clearing a genre no longer unbinds sessions. Deleting a canvas still removes every binding to it. Unbound sessions retain the old sidebar-focus fallback.
- The binding gate offers the chip through either the canvas agent row or an installed genre's agent row; it no longer requires a genre to exist.

## Alternatives considered

- **Keep genre-only binding and make the UI explain it.** Rejected: plain canvases support the same card and manuscript work, so the restriction contradicts the user-facing concept of a work rather than expressing a real capability boundary.
- **Bind automatically inside `createCanvas`.** Rejected: room tools deliberately separate the member whose workspace fences creation from the coordinator session whose target should move. Creation callers own the binding decision; the two user-facing creation paths now make it explicitly.
- **Replace focus entirely.** Rejected: it remains the useful fallback for an unbound session viewing a canvas, while an explicit binding now survives restarts.

## Consequences

- Existing `bindings.json` data needs no migration. Plain-canvas bindings use the same session-to-canvas mapping and become effective after the user or Agent selects the work again.
- Genre changes emit the existing genre event, so novel tool grants are revoked when appropriate without losing the session's ordinary canvas target.
- The canvas package build and all 37 test files pass, including plain-canvas binding and restart, genre clearing, both creation paths, and chip filtering.
