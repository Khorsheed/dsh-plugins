# Agent Note: session-title-edit input auto-fit and client-side length gate

Status: implemented

English | [中文](2026-08-17-session-title-edit-input-fit-and-length-gate.zh.md)

## Problem

Two gaps in the title-edit entry's editing UX. (1) The in-place input's width was pinned to the official title crumb's measured rect (`width: placement.width`), so typing a longer title clipped inside the original title's box — the box re-measured only on window resize, never on input. (2) The host `session-title` service caps any accepted title at `maxTitleBytes` (80 UTF-8 bytes by default in the base bundle) and silently truncates over-limit input in `normalizeSessionTitle` — a user typing 30 CJK characters saw the editor close as if saved while the title came back about 26 characters shorter, with no error. The README documented both as Known Limitations.

## Decision

- **Auto-fit.** The in-place input now measures a hidden mirror span that renders the exact draft at the input's font (same size/weight, `white-space: pre`) in a `useLayoutEffect` keyed on draft and placement, and sets the input's outer width to `clamp(textWidth + padding + border + caret buffer, crumbWidth, 220px)` — the floor is the crumb's original measured width (so the box never collapses while deleting), the ceiling matches the official crumb's `max-width: 220px` (so a long draft clips exactly where the crumb's ellipsis would). An input's own `scrollWidth` cannot shrink once content fits, so the mirror span is the measure. The degraded row editor stays at its fixed 220px (equal to the cap).
- **Client-side length gate.** A new `src/client/title-length.ts` mirrors the host contract: `MAX_TITLE_BYTES = 80` and `normalizedTitleByteLength()`, which applies the same cleaning the host applies before capping (ESC/CSI/control/directional sequences stripped, whitespace collapsed to single spaces, trimmed) and counts UTF-8 bytes. The editor gates on the *cleaned* length so the gate fires exactly when the host would truncate: whitespace-heavy or control-laced drafts are not falsely flagged, and a draft at the boundary passes through unchanged. An over-limit draft shows a localized warning (`hint.tooLong`, interpolating `{max}`/`{chars}`/`{bytes}`) and blocks commit — the row editor disables save, the in-place editor ignores Enter. Host rejection (`title-invalid`, which only ever means the empty-title case) is untouched.

## Alternatives considered

**Measure the input's own `scrollWidth`.** Rejected: it equals `clientWidth` once the text fits, so it can never shrink the box back down when the user deletes text.

**`field-sizing: content` CSS.** Rejected: browser support is still uneven, and the fitted result would be out of the component's control (and untestable in jsdom).

**Let the host truncate and show the shortened title as feedback.** Rejected: the title is already committed by then; the user must notice and re-edit. Blocking before commit with a hint is the only honest affordance.

**Approximate character count (e.g. 80 "characters") instead of UTF-8 bytes.** Rejected: CJK titles would be cut far earlier than the host allows and ASCII titles far later — a false gate in both directions. Byte parity with the host is the point.

**Mirror the cap only for the in-place editor.** Rejected as a non-issue: the row editor shares the same draft and commit path, so the same gate and hint apply with negligible extra surface.

## Consequences

Long drafts now widen the in-place box up to the official 220px cap (and clip/scroll beyond it exactly like the crumb's ellipsis), and over-limit titles cannot be committed silently: the editor blocks and explains in the user's locale. `MAX_TITLE_BYTES` is a hardcoded mirror of the host's production default — if the host raises `maxTitleBytes`, the constant must follow or the editor stays stricter than the host; the README flags this. The official sidebar rename dialog still truncates silently (out of scope — it is host UI, not this plugin's). Coverage: byte helpers unit-tested; the row-editor gate (hint, disabled save, Enter block, boundary at exactly 80 bytes) and the in-place auto-fit (growth, 220px clamp, crumb-width floor, in-place hint + Enter block) component-tested.
