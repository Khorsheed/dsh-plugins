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
- **The novel's nested arguments have text forms too** (`packages/canvas-novel/src/text-forms.ts`). Later in the same session, `novel_write` arrived as `{"what":"outline"}` six times over. `content` is the one free-text argument that arrives, so:
  - an outline can be written there as `键：值` lines: 一句话主线, 核心冲突, 主角, 成长弧线, 主题, 类型与基调, 结局方向, 篇幅 on one line, one 「卷一：标题｜约N章｜要完成：…｜卷末：…」 line per volume, 「第N章：…」 sketches, and 理由;
  - a chapter call whose `content` opens on 「梗概：」 is a plan, never a manuscript body: 走向 / 伏笔 / 出场 / 信息差 are a key line followed by `- …` items.
  The empty-outline answer names this form.
- **Relation cards from one string.** A text-form 双方 arrives as one string. `refTokensOf` splits it on commas, 、, slashes, × or spaces, and also reads a JSON-array string. A character matches by name past its asides (「江眠」 finds 「江眠（提议名，可换）」, through the store's `bareName`), and so does a stage (「死党（好友以上）」). The write's failure now names the problem: how many of 双方 were recognized plus the roster, the seven types, an unrecognized stage, and the required fields of a new card. It used to be one 「字段不全或不合法」 for everything, and the model cycled through ten shapes of `pair`.
- **The plan's confirm stays reachable.** Two things hid it in the same session.
  - First, `novel_write(chapter=1)` on an empty work answered 「没有第 1 章」 in red, which read as a failed confirm. Asking for the next chapter number now creates it.
  - Second, when the turn ended, the host folded the tool calls, plan card included, under 「已调用工具」, so the reply's 「点一下确认计划」 had no button in sight. The `novel_write` row now opens the chapter page in the right sidebar once, when it watched a plan land awaiting confirmation. That page's ✓ 确认计划 does not fold away. A row mounted from history only offers its door. The tool's answer tells the model the confirm is on that page.
- **An outline proposal gets the same door.** Its answer used to render as a plain line, so after the turn folded there was no way to the 规划 page, where 采用 lives. The row now reads `已提交大纲提议（画布 …）` as an outline card: it shows whether the proposal still waits and offers 「去规划页采用 →」. Like a plan, the card opens the page once when it watched the call land, because 规划 is now also registered as a canvas page (`novel:plan`, `PLAN_PAGE`). The chapter answer is matched on any line: a body that attached a workspace prefixes a note, and the plan card had silently become a plain line.
- **`kind` reaches a genre hook as the model wrote it.** This honors the hook contract ("the model's arguments, untouched"). The canvas's own path uses the resolved category id, so a category name now works there too.
- **An empty card call gets an answer that changes the next call.** Instead of a bare 「要给 kind」, it names the text-only form and says the arguments probably did not arrive. The kind error lists the valid categories and the same hint, and the genre hook's 「按字段写」 error points at the text-line form.
- **The `canvas` skill** says: when `kind`/`fields` do not arrive, switch to the text form, and never resend the same arguments.

## Alternatives considered

**Accepting `fields` / `plan` as JSON strings.** We tried this and dropped it: the host validates arguments against the schema before `execute`, and rejects a string where the schema says object. The code would never run.

**A separate flat-parameter card tool.** Rejected: it would undo the 2026-09-30 slimming, and `canvas_write`'s own `text` already is a flat string.

**Fixing it at the provider.** It is not ours to change; the user can switch models. This fallback keeps the canvas usable on any provider that delivers at least flat strings.

## Consequences

- On providers like this, a card lands from `op` + `text` alone, and the second call after a failure has a form that works.
- `novel_write`'s `volumes`/`sketches` lists and the plan's lists ride the text forms; a model that cannot write either form still cannot plan.
- Tests: `tests/tools.spec.ts` covers parsing the category and fields from text, the title as the name, prose on an untyped card, the empty-call answer followed by a text-only card landing, and a patch or comment routed by a 编号 line or a title; `canvas-novel/tests/text-forms.spec.ts` covers the outline and plan text forms through `novel_write` and relation 双方 from one string.
