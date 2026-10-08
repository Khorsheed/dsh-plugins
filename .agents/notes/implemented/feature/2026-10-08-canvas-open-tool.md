# Agent Note: canvas_open — the agent lists, switches to and creates canvases

Status: implemented

## Problem

The canvas tools (`canvas_read`, `canvas_write`, `canvas_propose_type`) act on "this session's canvas": the one the session is bound to (genre work), otherwise the one the right-sidebar tab last reported open. That focus lives only in memory and only the client can set it. When a discussion ended in "put this on a canvas", the agent was stuck: it could not create a canvas, and it could not pick an existing one either. Its only answer was "please open a canvas in the right sidebar", and the same happened after every restart, in every fresh session and whenever the tab was closed. The novel genre had a two-step version of the same dead end: `novel_bind` with no works told the user to create a canvas by hand and then set its genre to 长篇小说.

## Decision

`@khorsheed/dsh-canvas` ships a fourth main-session tool, `canvas_open` (`packages/canvas/src/tools.ts`), registered by the same `./agent` entry as the other three:

- **No arguments** lists every canvas (id, title, card count, genre, archived), marks the session's current target and names the genres a new canvas can take.
- **`canvas`** (title or id) switches the session to that canvas. A live canvas wins over an archived one with the same name. Two matching titles get a question back instead of a guess. An archived canvas is refused because it is read-only.
- **`create`** (+ optional **`genre`**, id or label) creates a canvas and switches to it. If a live canvas already has the same title, the tool switches to that one instead of creating a copy, and says how to get a second one deliberately. It uses the store's existing `createCanvas`, so no new write path is added and no workspace is attached (the same default as the UI create form).

"Switch" means whatever makes the other tools target that canvas:

- A genre canvas is **bound** with `bindSession`. That emits `canvas/binding-changed`, so the genre's own tools (canvas-novel's grant) show up on the next step.
- A plain canvas takes the **focus**. A binding outranks the focus, so a session bound to a different canvas is unbound first, and the answer says so.

The model gets one answer for no target in place of "ask the user to open one": use `canvas_open` to list and switch, or create once the user agrees. The `canvas:tools` prompt section and the `canvas` skill (new section "Choosing the canvas") carry the same rule. Creating only happens when the user asked for a canvas or agreed to one. That is a rule in the skill, not a confirmation gate: creating is cheap and the user can undo it by archiving or deleting the canvas.

The sidebar follows the switch. A keyed `tool.call.toolview` row for `canvas_open` (`src/client/open/`, built like the `canvas_propose_type` row) reads the canvas id from the call's own answer and offers 打开 →. **It opens the canvas automatically only when it watched the call go from running to settled.** A row that mounts already settled (a reload, scrolling back through history) only offers the button, so an old switch never pulls the sidebar away from what is open now. When the tab reads a board that is not yet in its canvas list, it adds that canvas to the top of the list so the strip can name the new canvas.

canvas-novel's `novel_bind` empty listing and its skill now point at `canvas_open(create=书名, genre=长篇小说)`, keeping the manual steps as the fallback where `canvas_open` is not mounted. This mention is text only, so it adds no package edge.

The same change pins the board's filter row: the category chips and the selection bar move out of `.boardScroll` into a non-scrolling `.boardHead` (`src/client/space/BoardView.tsx`). The category can then be switched from anywhere in a long grid. The genre face tools (scope / 网格·连线) already sat outside the scroller.

## Alternatives considered

**A `canvas_write op=create`.** Rejected: `canvas_write` means "write to the current canvas", and creating changes which canvas is current. Mixing the two in one op invites the model to create when it meant to write.

**Three tools (list / switch / create).** Rejected: the 2026-09-30 slimming cut seven tools to three because a long catalog crowds the writing preset. One door with three modes costs a single extra catalog entry.

**A `canvas` argument on every tool instead of a session target.** Rejected: every schema grows, every call has to repeat the id, and the implicit target the slimming kept goes away.

**A UI confirmation before creating.** Rejected: a canvas is reversible state (archive and delete exist) and creating one destroys nothing. A confirmation round-trip would bring back exactly the manual step this change removes. The skill rule ("only when the user asked or agreed") covers intent.

**Persisting the focus across restarts.** Not done: once the no-target answer points at `canvas_open`, a lost focus heals itself in one call.

**Always auto-opening the sidebar from the row.** Rejected: rows re-render on reload and in history. The "saw it running" check is what tells a live call from a replayed one.

## Consequences

- A discussion can end on the canvas without the user clicking anything: list → create or switch → `canvas_write` cards, with the sidebar following along.
- The catalog has four canvas tools again. The descriptions stay terse and the mechanics live in the skill.
- A plain-canvas switch can drop the session's genre binding. That is intended (the session now works on the other canvas) and is stated in the answer, but it does change the header chip.
- The auto-open check depends on the host rendering the keyed row while the call runs. On a host line that only renders settled rows, the row degrades to the 打开 → button.
- Tests: `tests/tools.spec.ts` (canvas_open: create/target, namesake, switch/ambiguous/archived, genre bind + plain unbind) and `tests/open-row.client.spec.tsx` (answer parsing, follow once when watched live, no follow on history, no button for listings or failures).
