/**
 * The `canvas` skill: the mechanics the three canvas tools' descriptions
 * leave out (2026-09-30 slimming) — card kinds, fields, the type grammar and
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
  'How to use the canvas tools (canvas_read, canvas_write, canvas_propose_type): card kinds and fields, comments, '
  + 'manuscripts and their revision protocol, and the category type grammar. Load before writing to the canvas.'

/** The skill body. */
export const CANVAS_SKILL_CONTENT = `# canvas — working on the open canvas

The canvas is the user's board of cards, grouped by category, plus the manuscripts written from them. All three
tools act on the canvas open in the right sidebar's Canvas tab; with none open they say so — ask the user to open
one, never guess. Tool answers are in Chinese.

## Reading — canvas_read

- No arguments: the category catalog (id, name, card count, fields when typed), the card list (id, category,
  status, title) and the manuscripts (id, title, version).
- \`kind\`: that category's type — the user's brief (with sketches and pasted images attached when you can see
  images), the adopted field definition, any proposal awaiting the user, the revision log, a few sample cards —
  followed by its card list.
- \`manuscriptId\`: the manuscript's full body, its current version, and the cards it used / left out.
- Archived cards are counted, not listed, unless \`includeArchived\`. When a title is not enough, ask the user to
  quote the card.

## Cards — canvas_write op=card

- A card lands as **proposed**; only the user's ✓ keeps it (✗ archives it). Sources, questions, shared
  understandings, counter-examples and examples all go here — never paste card text into your reply as if it were
  on the board.
- A genre canvas may write its cards with its own tool (a 长篇小说 canvas: \`novel_write\`); canvas_write op=card
  refuses there and names that tool — use it.
- \`kind\` is a category id. Built-ins: \`fragment\` (inspiration), \`question\`, \`grounding\` (a shared understanding
  — propose only; it counts once the user restates it), \`reference\` (always with \`source\`), \`document\`. Canvases
  often carry renamed or user-made categories (ids like \`cat_…\`): when the user names a category, read the catalog
  for its id instead of filing it under \`fragment\`.
- \`text\`: small and concrete. For a typed category (the catalog lists its fields), put structured values in
  \`fields\` by key and prose in \`text\`; either may be omitted, not both. A \`ref\` field takes card ids or a card's
  exact name. A value that breaks the definition is reported field by field.
- \`source\`: \`{ type: url | file | paste, ref, title? }\` — ref is the url, an absolute path, or a note on the paste.
- \`comment\`: one line on why, attached to the card as your comment.

## Comments — canvas_write op=comment

\`cardId\` + \`text\`. Name one hidden assumption or tension and end on one pointed question. Commenting on a question
card moves it from open to exploring.

## Manuscripts — canvas_write op=manuscript

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
