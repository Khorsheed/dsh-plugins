# Agent Note: canvas_write cards survive providers that drop nested arguments

Status: implemented

## Problem

In the 3080 session 「三层世界科幻故事共创讨论」 (model `kimi-coding/k3`, 2026-10-08), the agent created the canvas with `canvas_open` and then called `canvas_write` fifteen times. Each call arrived as `{"op":"card","text":"","title":""}`, while its reasoning held the full card: kind, fields and comment. The tool answered 「要给 kind」 every time, and the host's repeat-call guard fired twice. The model finally gave up and pasted the ten cards into its reply.

Other sessions isolate the cause:

- A session on an openrouter model wrote 15 cards with `kind`/`fields`/`comment` intact.
- A second `k3-256k` session shows the same `op`/`text`/`title`-only calls.

The schema the host sent was correct (checked in the session's request header). pi-ai drives kimi-coding through the plain Anthropic Messages API, with no schema rewrite. So the arguments are lost between that model/endpoint and the host, outside this repo. The one thing that reliably arrived is the flat strings, and `text` sometimes carried real content.

## Decision

- **A card can be written in `text` alone.** `cardArgsOf` (`packages/canvas/src/tools.ts`) makes the arguments whole before either path (the genre hook or the canvas's own path) sees them:
  - a `分类：…` / `kind:` line names the category, by name or id;
  - `字段名：值` lines fill the category's typed fields, matched by label or key;
  - the remaining lines are the body;
  - a `title` names a new card whose name field is empty.
  
  Lines are consumed only when they match a field of the category's definition, so prose with colons on an untyped card is left alone.
- **Patches, comments and archives name their card the same way.** In the same session, editing w7 then failed: `cardId` did not arrive either. The model tried `title: "w7"`, a `编号：w7` line, and a full rewrite. The rewrite was refused as a namesake, with advice to use `cardId`, which is exactly what could not arrive. Now:
  - a `编号：w7` line (also `卡片` / `cardId` / `id` / `ref`) names the card to patch, and the other lines fill only the fields that change, read against that card's category;
  - a `title` that resolves to an existing card does the same;
  - `op=comment` and `op=archive` take the same line;
  - the namesake refusal in canvas-novel names the 编号 form.
- **`kind` reaches a genre hook as the model wrote it.** This honors the hook contract ("the model's arguments, untouched"). The canvas's own path uses the resolved category id, so a category name now works there too.
- **An empty card call gets an answer that changes the next call.** Instead of a bare 「要给 kind」, it names the text-only form and says the arguments probably did not arrive. The kind error lists the valid categories and the same hint, and the genre hook's 「按字段写」 error points at the text-line form.
- **The `canvas` skill** says: when `kind`/`fields` do not arrive, switch to the text form, and never resend the same arguments.

## Alternatives considered

**Accepting `fields` / `plan` as JSON strings.** We tried this and dropped it: the host validates arguments against the schema before `execute`, and rejects a string where the schema says object. The code would never run.

**A separate flat-parameter card tool.** Rejected: it would undo the 2026-09-30 slimming, and `canvas_write`'s own `text` already is a flat string.

**Fixing it at the provider.** It is not ours to change; the user can switch models. This fallback keeps the canvas usable on any provider that delivers at least flat strings.

## Consequences

- On providers like this, a card lands from `op` + `text` alone, and the second call after a failure has a form that works.
- `novel_write`'s nested `plan`/`sheet`/`volumes` have no such fallback yet. On a provider that drops objects, chapter plans would fail the same way. If that shows up, it needs a text form too (or a schema-level union, if the host grows one).
- Tests: `tests/tools.spec.ts` covers parsing the category and fields from text, the title as the name, prose on an untyped card, the empty-call answer followed by a text-only card landing, and a patch or comment routed by a 编号 line or a title.
