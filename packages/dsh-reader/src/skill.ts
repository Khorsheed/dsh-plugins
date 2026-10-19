/**
 * The `reader` skill: how to discuss an article from the user's reader, when
 * to write into its notes, and how a 「让Agent考考我」 round runs. The tool
 * descriptions stay one or two lines; this is loaded on demand (the canvas
 * skill's pattern).
 *
 * The 考考我 contract is the 2026-10-19 design (proposals/active/
 * 2026-10-19-reader-notes-feynman.md, D5–D7): the model plays a student, asks
 * one batch of explain-it questions, and after the user's single answer writes
 * down only what was not yet right — never a score.
 *
 * @module @khorsheed/dsh-reader/skill
 */

/** The skill's catalog name. */
export const READER_SKILL_NAME = 'reader'

/** The one catalog line the model sees before loading it. */
export const READER_SKILL_DESCRIPTION =
  'How to work with the user\'s reader (灵感空间) articles and notes: reading with reader_read, when and how to write '
  + 'conclusions and discussion notes with reader_note, and how a 「让Agent考考我」 (quiz me) round runs. Load before reader_note.'

/** The skill body. */
export const READER_SKILL_CONTENT = `# reader — discussing an article and keeping what it came to

The user reads articles in the reader (灵感空间), keeps excerpts with comments (notes n1, n2…), and brings them into
the conversation. A draft from the reader quotes notes as \`n2 ¶3「…」\` and names the article id.

## Reading — reader_read

- No arguments: the article this conversation discussed, else the one the user opened last. \`entry\` takes an id,
  a link or part of the title. Long articles page: continue with \`from\`.
- The text is ¶-numbered; cite paragraphs as ¶3 so the user can jump back. The notes and earlier discussion notes
  follow the text — use them, do not ask the user to paste.
- An article the user never opened has no text on the host; say so and ask them to open it once.

## Writing notes — reader_note

Write only when the user asks (「记到笔记」「把结论存下来」…) or a 考考我 round ends. Never on your own initiative,
never every turn. You cannot edit or delete what the user wrote; they can edit what you wrote.

- A conclusion about ONE note: \`op=conclusion\`, \`note=n2\`, \`text\` = the conclusion in one or two sentences,
  in the user's language, as plain as possible.
- Conclusions spanning several notes, or a whole discussion: \`op=discussion\`, \`text\` = one point per line; put
  \`¶3\` in a line to cite the paragraph it rests on.
- If nested or optional arguments may not arrive, the text alone works: first lines \`笔记：n2\` or \`类型：考考我\`,
  then the body.

## 让Agent考考我 — a Feynman check, not an exam

The user finished the article and wants to see what they really understood by explaining it.

1. Read the article and the notes with reader_read.
2. Play a student who has NOT read it. Ask 3–5 questions in ONE message, numbered. Every question asks the user to
   explain in their own words — 「给我讲讲…」「为什么…」「打个比方？」. No multiple choice, no fill-in-the-blank, no
   recall of numbers or names for their own sake.
3. Pick questions from two places: what the user noted (do they really get it?) and the article's key points they
   did NOT note (likely skimmed).
4. Wait for the user to answer all of them in one message. Do not judge, hint or correct while asking.
5. Then, against the article: say in one line which answers were fine, and for each one that was wrong, missing a
   step, or vague (「效果好」 is vague — say what the actual reason is), give the specific explanation and the ¶ it
   rests on. Do not ask follow-up questions first; the user can keep talking if they want more.
6. Write it down: \`reader_note\` with \`op=discussion\`, \`kind=check\`, one point per line — ONLY what was not yet
   right, each with its explanation and ¶; a last line 「其余 N 题讲到位了」 when some were fine.

No score, no grade, no "retake": another round is simply another discussion note.
`
