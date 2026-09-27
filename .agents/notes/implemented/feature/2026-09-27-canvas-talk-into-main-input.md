# Agent Note: Canvas talk quotes into the main session's input

Status: implemented

## Problem

Since M2 every canvas chat gesture went to the side-chat plugin: the lens bar (seven lens buttons plus "Ask about these"), the comment "Follow up", "Compose an article" and the card page's "Compose from this card". Each opened a second agent session with its own context. In the 2026-09-27 review the user found three problems with this:

- The conversation they actually cared about was the main session, and the side chat split it in two.
- The lens row made a selection's bottom bar the busiest thing on the board.
- The cards carried controls at rest (checkbox, ⋯, an empty 💬, a pencil) that competed with the words.

The user chose one path in place of all these: put the card's words into the main session's input and let the user finish the sentence.

## Decision

**Every chat gesture quotes into the current session's conversation input.** "Talk to the Agent" and "Start writing" on a selection, the same two buttons on the card page's header, and "Follow up" beside an agent comment all write a markdown block through the host input's `setDraft`. They never send. The user reads the block, adds a line, and sends it themselves.

- **The block** (`src/client/quote.ts`) is the card's words as a blockquote, then an attribution line: canvas title · category as the board names it · card id. The id is the handle the main session's `canvas_*` tools take.
- **Bounds.** An HTML card is quoted as a pointer (its title and length), never the page. A card over 1200 characters is cut with its full length stated. Only the newest 8 comments ride along.
- **"Start writing"** is the same quote plus one writing instruction (`talk.writeText`). It is not a separate mode.
- **Merging.** `setDraft` replaces the whole draft, so the writer read-merges: what the user already typed stays, and the block goes a blank line after it. This is the rule the reader and quote packages follow.
- **Access** is structural: `sessions.scope(id).get('conversation').input.for(scope)`, validated for `getSnapshot`/`setDraft` in a try/catch. With no input the entries hide, and a refused write toasts instead of failing silently.

**The board polls while visible.** Without the side-chat turn watch, the client no longer knows when an agent turn ends. Instead the tab calls `refreshBoards()` (a shared-rev `touch()`) every 4 seconds while `document.visibilityState` is `visible`. Both board read effects keep the same object when the version is unchanged, so a quiet poll does not re-render.

**Cards got lighter.**

- The ☐ checkbox and the ⋯ show on hover or `:focus-within` only, and always under `(hover: none)`.
- The comment badge shows only when a card has comments.
- The card pencil is gone: opening the card is editing it.
- A zero-count category chip fades to half opacity unless it is active or hovered.

**The side-chat server path is retired in a follow-up commit.** The UI change landed first and can be reviewed on its own. The follow-up deletes:

- the `askAgent`/`chatStatus` verbs;
- `prompt.ts` (the system-prompt segment, the lens and compose templates, the ref builder);
- the per-`openWith` `canvasToolDefinitions`;
- the `sideChat` probe and the manifest's `dsh.references`.

The tool specs moved onto the main-session definitions. The canvas now has no edge to any other community plugin.

## Alternatives considered

**Keep side chat, drop only the lens row.** Rejected: the split conversation was the user's main complaint, not the button count.

**Send the quote straight away.** Rejected: a bare card is not a question. The draft lets the user say what they want, and nothing reaches the model before they look at it.

**A dropdown on "Talk to the Agent" to pick a target (main session / side chat / copy).** The user asked for no dropdown. Copying and side chat stay with the quote plugin's text-selection menu.

**Keep the turn watch against the main session.** The host exposes no stable turn-state surface for a plugin to watch. A version poll is cheap, visible-only, and also catches edits from another browser tab.

## Consequences

- One canvas no longer has its own persistent agent context. What the agent knows about the canvas comes from the main session's canvas tools and whatever the user quotes.
- The lenses are gone as buttons. Their intent now lives in the words the user types after the quote.
- A standing 4-second poll replaces the turn watch. Its cost is one version read per tick, and only while the tab is visible.

## Testing

- `tests/quote.spec.ts`: blockquote and attribution, HTML pointer, length cut, drawing line with the newest-comments window, card order, comment quote, draft merge.
- `tests/tab.client.spec.tsx`: selection → "Talk to the Agent" / "Start writing" quote in board order; "Follow up" quotes the comment; no empty comment badge; no pencil; the 4-second poll runs while visible and stops while hidden.
- `tests/detail.client.spec.tsx`: header talk/write buttons, follow-up quote, the refused-write toast, entries hidden without an input.
- `tests/link.client.spec.tsx`: the links face quotes a group through the same path.
- Checked on a throwaway instance with screenshots: resting board, card hover, the slim selection bar, and the quote landing in the main input with its toast.
