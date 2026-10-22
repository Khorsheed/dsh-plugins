# Agent Note: the game panel's see → play → point → see-the-result loop

Status: implemented

## Problem

With 3D games possible ([the 3D kit](2026-10-22-game-3d-kit.md)), the panel still spoke 2D: a pick in the play area took three steps (pick → card → 「引用」) and put plain text into the draft; the candidate bar sat at the top of the tab, far from the screen it compares; nothing showed what a candidate changed; and a 3D element had no preview at all. The user's loop is "see what changed → play → point at a thing and say what you think → see the result", and every step needed a 3D answer.

## Decision

- **Pick → chip in one step (decision G5).** Clicking in 「指一下」 inserts a reference chip into the composer at once (Shift keeps picking for a second reference); the user writes and sends. The chip rides the host's `slash/input-insert-reference` scoped bail event with a headless trigger source carrying the codec (`src/client/refs.ts`, the quote plugin's pattern); the chip shows a short label and serializes to the full reference — element name and id, instance, region, position, state. Without the chip seam, or when the host declines, the same text is appended to the draft. While picking, the game is paused (the bridge's `pause` message) and the pointer shows what a click would pick (hover picks, throttled).
- **Candidate bar under the screen**, beside what it compares, with the current/candidate switch.
- **Diff rings.** `ProjectView.candidateDiff` names the elements the candidate changed and added against the live version (element-file comparison of the two snapshots); the play view sends them as the bridge's `highlight` list while playing the candidate, behind a toggle.
- **3D previews in the sandbox, not in the panel.** `Preview3D` runs the live version's own bundle (kit files and the project's `src/looks.js` registrations included) with a preview entry swapped in, so the panel never carries a second builder. `spin` is the element turntable (draggable, follows edits live); `still` renders once, posts a PNG back and is cached as an image — proposal cards, element cards in the grid and the turn card use it, lazily on scroll, at most two rendering at once (the rest show a color swatch until their turn).
- **Recipe editor.** A `parts3d` look is edited as sliders and color wells generated from the recipe itself (`Recipe3DEditor`): proportions, every part's numbers including a project part's own `extra`, palette, motions and scale. Edits save like pixel-look edits and reach the running game at once: dsh3d rebuilds every model built from that element id in place.
- **Turn card before/after.** The turn report carries a changed element's 3D look before and after (bounded JSON); the card shows both as stills.

## Alternatives considered

**Render previews with a three.js copy in the panel bundle.** It would be faster to first paint, but the panel would carry a second builder (and three.js) that can drift from the game's, and it could not see a project's own registered bodies and parts. The sandbox runs exactly what the game runs.

**Render the turn card's images on the host at turn end (headless Chrome).** The checker is warm then, but it would add disk state per turn and a second rendering path. Client stills cache in memory and only cost when a card is actually looked at.

**Keep the pick card's 「引用」 button.** It is one more step at the moment the user is forming a thought; the chip goes in where they are about to type.

## Consequences

- Each live 3D preview is its own sandbox with a WebGL context. Element cards show a still, not a live model, and stills render two at a time, so a grid of cards never nears the browser's context limit; the card's color swatch is the placeholder meanwhile, and the whole preview when there is no live version yet.
- A project's own bodies and parts must be registered in `src/looks.js` for the panel to preview them; the 3D skill says so.
- The chip serializer resolves by source name, so chips inserted while the source was unmounted would refuse to send; the face inserts chips only while the source is registered.

## Testing

`tests/refs.spec.ts` pins chip labels and texts for an entity, a bare id and the ground, and the codec round trip with refusal of a corrupt chip. `tests/store.spec.ts` pins `candidateDiff` (changed and added ids across snapshots; null without a candidate) and the turn report's 3D before/after looks. The kit's headless tests cover the runtime side (pick reference, pause, highlight, live rebuild by element).
