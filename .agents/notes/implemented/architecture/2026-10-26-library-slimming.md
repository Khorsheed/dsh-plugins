# Agent Note: Library — a slim tool surface and a journey-only prompt

Status: implemented

## Problem

The 10-26 Blender session measured what the library costs every request: its ten tool definitions were 23,850 characters, 65% of all 25 tools in the session (the host's longest, `bash`, is 2,277). Its prompt section was 2,795 of a 5,665-character system prompt, and its results came back as indented JSON (a single `library_read · roadmap` returned 7,300 characters). The coach also broke the journey: it wrote 讲义 and started teaching before the learner adopted the path, partly because a refusal literally said "teach in the conversation meanwhile". The user asked whether the length itself was making weaker models (inkling:free, deepseek-flash) follow the letter instead of the intent.

## Decision

Decided with the user over the proposals `proposals/prototypes/library-journey.html` and `library-slimming.html`:

- **The prompt holds only the journey**: who does what, in what order, and where to stop (before adoption: no 讲义, no teaching, no quiz; a station starts only when the learner says so; after 讲义 are written, say so in one line and wait). Format rules moved into the tools; rare rules are left to refusals. 2,795 → 1,208 characters.
- **Schemas advertise one canonical shape.** The tolerant parsing stays in execute. Big lists keep two branches: the typed list, plus the same list as JSON text, so a stringified payload still passes host validation. The `{ items }` wrapper branch, alias fields and per-field essays are gone from the wire. Small loose fields (goals, acceptance, options, toc, tocSource) are `type: 'json'` with a one-line shape hint.
- **Fields the server can infer are no longer asked for.** Question ids are numbered; target and evidence follow from quote, pageId, url and the textbook. A verdict needs task, pass and why (criterion, evidence and by are filled from it). A station's gate follows from whether it has acceptance lines. A chat card weakens and takes the project's mark kind.
- **`library_resource` → `library_textbook`.** It handles textbooks only; ops are add | update | move | remove, and create still parses. Links are no longer advertised (kind, short, isbn and extras are hidden but still parse), so a call without an explicit link kind is a textbook and gets the textbook's refusal, never "a link takes title, url".
- **`op` and `what` are plain strings, not enums**, so old spellings (`create`, `books`) still reach execute. `what` is optional: a read that forgot it reads what its arguments point at.
- **Results are compact JSON and carry the next step.** A draft says to describe it in two lines and stop until adoption. Written 讲义 say to tell the learner and wait. A passed sitting says to name the next station and ask. `library_read · roadmap` returns stations without their 讲义 text.
- **A budget test** (`tests/size.spec.ts`) caps the ten definitions at 12,000 characters and the prompt at 1,250. Measured after this change: 10,735 and 1,208.

## Alternatives considered

- **Merging tools** (binding into project, grading into quiz): rejected. A tool with several modes is the problem being removed; ten short tools beat seven polymorphic ones.
- **Dropping the JSON-text branch**: rejected. Weak models still stringify nested payloads, and without the branch host validation refuses them with an opaque message before the tool can teach.

## Consequences

- Sessions that remember `library_resource` from their history get "no such tool" once, then use `library_textbook`; stored data is unchanged.
- The sidebar's "add a link" draft still works through the hidden kind.
- 讲义 storage, the lesson page and the path redesign follow in batches 2 and 3.

## Testing

188/188 green. New: the size budget; the draft's stop instruction and inferred gate; a compact path read without 讲义 text and a read without `what`; numbered question ids and a why-only verdict; add / update ops. Older assertions were updated where the wording changed on purpose.
