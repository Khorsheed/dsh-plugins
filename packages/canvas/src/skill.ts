/**
 * The `canvas` skill: the mechanics the canvas tools' descriptions
 * leave out (2026-09-30 slimming) — choosing or creating a canvas, card kinds, fields, the type grammar and
 * the manuscript revision protocol. The `./agent` entry registers it beside
 * the tools, so it exists exactly where they do; the model loads it on demand
 * instead of carrying it in every writing turn's tool catalog.
 *
 * @module @khorsheed/dsh-canvas/agent
 */

/** The skill's catalog name. */
export const CANVAS_SKILL_NAME = 'canvas'

/** The one catalog line the model sees before loading it. */
export const CANVAS_SKILL_DESCRIPTION =
  'How to use the canvas tools (canvas_open, canvas_read, canvas_write, canvas_propose_type): choosing or creating '
  + 'a canvas, card kinds and fields, comments, manuscripts and their revision protocol, and the category type grammar. '
  + 'Load before writing to the canvas.'

/** The skill body. */
export const CANVAS_SKILL_CONTENT = `# canvas — working on the open canvas

The canvas is the user's board of cards, grouped by category, plus the manuscripts written from them. canvas_read,
canvas_write and canvas_propose_type act on this session's canvas: the one it is bound to, else the one open in the
right sidebar's Canvas tab, else the one canvas_open last chose. With none they say so — pick one with canvas_open
rather than asking the user to click. Tool answers are in Chinese.

## Choosing the canvas — canvas_open

- No arguments: every canvas (id, title, card count, genre, archived), the session's current one marked, and the
  genres a new canvas can take.
- \`canvas\`: switch to that canvas by title or id. Do it when the conversation is plainly about another canvas
  than the current one; if two titles fit, ask which.
- \`create\` (+ optional \`genre\`, e.g. 长篇小说): make a new canvas and switch to it. Create only when the user
  asked for one or agreed to it ("put this on a canvas") — never on your own. Prefer an existing canvas on the same
  topic: list first. A live canvas with the same title is switched to instead of duplicated. A genre canvas binds
  the session, so the genre's own tools appear from the next step (load its skill).
- The user's right sidebar follows the switch. Then land the discussion with canvas_write: a few small cards, not
  one big one.

## Reading — canvas_read

- No arguments: the category catalog (id, name, card count, fields when typed), the card list (id, category,
  status, title) and the manuscripts (id, title, version).
- \`kind\`: that category's type — the user's brief (with sketches and pasted images attached when you can see
  images), the adopted field definition, any proposal awaiting the user, the revision log, a few sample cards —
  followed by its card list.
- \`cardId\`: that card in full — fields, body, source, comments.
- \`manuscriptId\`: the manuscript's full body, its current version, and the cards it used / left out.
- Archived cards are counted, not listed, unless \`includeArchived\`. When a title is not enough, ask the user to
  quote the card.

## Cards — canvas_write op=card

- A card lands as **proposed**; only the user's ✓ keeps it (✗ archives it). Sources, questions, shared
  understandings, counter-examples and examples all go here — never paste card text into your reply as if it were
  on the board.
- On a genre canvas (a 长篇小说 work, say) the genre's own categories follow the genre's rules: their cards land at
  once instead of as proposals, read and write with the genre's refs (\`c3\`, \`#12\`), a namesake is refused in
  favour of patching the existing card, and \`cardId\` + \`fields\` patches one. The answer says what landed. Outside
  those categories, and on every other canvas, you only propose — the user edits cards.
- \`kind\` is a category id. Built-ins: \`fragment\` (inspiration), \`question\`, \`grounding\` (a shared understanding
  — propose only; it counts once the user restates it), \`reference\` (always with \`source\`), \`document\`. Canvases
  often carry renamed or user-made categories (ids like \`cat_…\`): when the user names a category, read the catalog
  for its id instead of filing it under \`fragment\`.
- \`text\`: small and concrete. For a typed category (the catalog lists its fields), put structured values in
  \`fields\` by key and prose in \`text\`; either may be omitted, not both. A \`ref\` field takes card ids or a card's
  exact name. A value that breaks the definition is reported field by field.
- \`source\`: \`{ type: url | file | paste, ref, title? }\` — ref is the url, an absolute path, or a note on the paste.
- If a call's \`kind\` or \`fields\` does not arrive (the answer says nothing usable came through), write the card in
  \`text\` alone: first line \`分类：世界\` (the category's name or id), then one \`字段名：值\` line per field, then the body.
  To change an existing card that way, open the text with \`编号：w7\` (its ref) and write only the fields that change;
  comments and archives take the same \`编号\` line when \`cardId\` does not arrive. Never resend the same arguments —
  change the form.
- \`comment\`: one line on why, attached to the card as your comment.

## Comments — canvas_write op=comment

\`cardId\` + \`text\`. Name one hidden assumption or tension and end on one pointed question. Commenting on a question
card moves it from open to exploring.

## Archive — canvas_write op=archive

\`cardId\`: archive a card that is wrong or no longer used (the user can bring it back from 已归档). Do it at the
user's word, or for a card you just landed by mistake.

## Manuscripts — canvas_write op=manuscript

- A genre that owns the canvas's 成稿 (a 长篇小说 work: its chapters) answers op=manuscript with its own flow.
- Drafts go on the canvas as a manuscript (the user reads, edits and exports it there), not into the reply.
- New: omit \`manuscriptId\`; \`text\` is the whole body in Markdown (the first heading becomes the title, or give
  \`title\`).
- Revise: read it first with \`canvas_read\` + \`manuscriptId\`, then pass \`manuscriptId\` and \`baseVersion\` (the
  version you read); \`text\` is the whole revised body. A version conflict means someone just edited it — re-read
  and revise again, never force it.
- \`sources\`: \`{ used: [cardId…], unused: [cardId…] }\` — the cards this version used and the ones deliberately left
  out. On a revision, given replaces them whole; omitted keeps them.

## Category types — canvas_propose_type

Use when the user asks to design or adjust a kind of card ("what fields should a character card have"). Read the
category with \`canvas_read\` + \`kind\` first. The proposal does not take effect by itself: it waits on the type page
until the user previews and adopts it; proposing again replaces the pending one.

- \`kind\` to change an existing category; \`label\` (no kind) to create one.
- \`definition\`: \`{ layout, fields, example, guide? }\`
  - \`layout\`: \`note\` (default, body only) / \`profile\` (name + face fields) / \`entry\` (name + one-line summary).
  - each \`fields\` item: \`key\` (starts lowercase, a-z0-9_), \`label\`, \`type\` (\`line\` / \`text\` / \`select\` with
    \`options\` / \`tags\` / \`ref\` to other cards, optionally limited by \`refKind\` / \`number\`), \`hint\` (required,
    one sentence on what goes in it), \`required\`, \`face\` (shown on the card face, at most 3). The first required
    \`line\` field is the card's name.
  - \`example\`: one sample card's values — what the user sees in the preview.
  - \`guide\`: optional, how to write this kind of card overall.
- \`renames\`: \`{ oldKey: newKey }\`; on adoption existing cards' values move with them.
- \`rationale\`: a sentence or two on why this design. \`summary\`: what this version changes in one sentence (for a
  first version, the layout and fields). \`request\`: what the user asked for this round ("per the brief" when
  nothing was asked). Both show to the user first and go into the revision log on adoption.
`
