# Agent Note: Canvases and cards have a true delete

Status: implemented

## Problem

Since M1 the canvas space only archived. That followed the v1 pad's rule ([inspiration canvas](2026-09-13-inspiration-canvas.md): "there is no delete", because `ctx.fs` has no delete method). For the canvas the rule stopped making sense. A canvas is not a file in the user's workspace. It is a directory under the plugin's own state root, so "delete it in your file manager" asked people to find `$DSH_HOME/state/canvas/<id>/` by hand. Test canvases and cards made by mistake piled up in the archive well with no way out. In the 2026-09-27 review the user chose true delete over archive-only.

## Decision

**Two new Remote verbs, both agent-first like every mutating verb.**

- `deleteCanvas` removes a whole canvas.
- `deleteCard` removes one card together with every link to or from it. It is an ordinary version-guarded `canvas.json` rewrite through `mutate`, so a stale write re-applies once, the same as every other board mutation. A card's position lives on the card, so nothing else is left behind.

**Deleting a canvas removes the plugin's own state directory with node's `rm -r`.** `ctx.fs` still has no delete primitive, so `CanvasBoardService.deleteCanvas` works in four steps:

1. It checks the session's resolved mode and refuses under `read-only`, the same fail-closed rule the fence applies to writes.
2. It confirms through `ctx.fs` that the board exists.
3. It runs `rm(canvasDir, { recursive: true, force: true })`. The id comes from `normalizeCanvasId`, so traversal is impossible.
4. It **re-reads through `ctx.fs`**. If the board is still there, it answers `io`.

The re-read is the honest part. On a deployment whose state root sits on a mount node cannot reach, `rm` "succeeds" on a path that does not exist and the delete reports failure instead of pretending. A successful delete also clears every session's focus on that canvas.

The removal function is a constructor seam (`RemoveTree`) so the specs can drive it over the in-memory filesystem.

**Delete is an operator gesture, never an agent tool.** `tools.ts` does not expose either verb. The agent can propose and archive, but it cannot destroy.

**The UI:**

- **Card:** each card's ⋯ menu (host `Menu`, on the board and the detail page) offers 归档, which stays undoable through the toast, and 删除. Delete goes through one plain confirmation `Modal`. Nobody has to type the canvas name, because the target is already unambiguous in the dialog title.
- **Canvas:** the open canvas's ⋯ menu offers 归档画布 and 删除画布…. An archived canvas is read-only, so its banner carries 永久删除… next to 恢复.
- **Strip:** after a successful delete, the client face calls `selection.forget`.
  - It drops the canvas's rows, or the card's row.
  - If the showing row went, a deleted card falls back to its own canvas's board and a deleted canvas falls to the neighbouring row, so no row is left pointing at 「找不到」.

The v1 pad is unchanged: its files live in the user's workspace and it still has no delete.

## Alternatives considered

**Keep archive-only.** This was the existing behaviour. It lost because the canvas lives in plugin state, not in the user's files, so there is no user-facing place to delete it and the archive well only grows.

**Soft delete (a tombstone flag that hides even from the archive well).** Rejected: it is archive with a worse name. The bytes stay, and a second hidden tier needs its own restore story.

**Ask the host for an `fs.remove` seam first.** This is the correct long-term shape, but it goes through the upstream-change pipeline, and the state root is the plugin's own directory, not a fenced workspace path. The `rm` call is confined to `canvasDir(normalizeCanvasId(id))`, and the read-back makes the gap visible. When the host ships a delete primitive, the store switches to it and drops the seam.

**Type-the-name confirmation.** The user rejected it as too heavy for a notes tool, and a plain dialog is enough.

**An agent `canvas_delete_card` tool.** Rejected: destruction stays with people. An agent that wants something gone can archive it, and archive is undoable.

## Consequences

- **Pasted images are not reclaimed.** Deleting a card or a canvas drops only the `attachment://` pointers. The pixels stay in the host's content-addressed attachment store, because that store has no delete API. The README's Known Limitations says so.
- **Delete is irreversible.** There is no undo toast for it, unlike archive. The confirmation dialog is the only guard, and it says 无法恢复.
- **A state root on an unreachable mount cannot be deleted from.** The store reports `io` there rather than claiming success.
- The v1 pad's "no delete" consequence in the [inspiration canvas](2026-09-13-inspiration-canvas.md) note still holds for pad files. This note supersedes it only for the canvas space.

## Testing

- `tests/board.spec.ts`:
  - `deleteCanvas` removes the directory, clears focus and leaves the other canvas listed.
  - It rejects a missing canvas and an invalid id.
  - It reports `io` when the removal throws and when the file survives the removal.
  - It is denied under read-only.
  - `deleteCard` drops the card and exactly the links that touch it, and reports a missing card.
- `tests/remote.spec.ts`: both verbs forward the calling agent's session.
- `tests/strip.client.spec.tsx`: `forget` falls back to the board row, which it inserts if absent. It also leaves a non-showing row's view alone, and hands a deleted canvas's view to the neighbour or to empty.
- `tests/tab.client.spec.tsx`:
  - Card ⋯ → 删除 writes only after confirmation, and cancelling writes nothing.
  - Canvas ⋯ → 删除画布… deletes the canvas.
  - The archived banner offers 永久删除… while hiding both ⋯ menus.
- `tests/detail.client.spec.tsx`: the detail ⋯ archives a kept card and then deletes it after confirmation.
