# Agent Note: Canvas card types — a brief, an agent-drafted definition, adopted on confirm

Status: proposed

## Problem

0.4.14 lets the agent see each canvas's own categories (`canvas_read_board`, an open `kind`). A category is still only a name, though. A 人物 card looks exactly like a 灵感 card. It has no fields, and a later agent has no idea what a character card should say. The user wants four things:

- **Different types look different.** A character has a name, a role, traits and relations; a world entry has a name, what it belongs to and a description. At the rich end, a character dashboard would draw a character's state as something visual.
- **The agent can propose a type and generate it.** Once a type is settled, other agents file cards in that shape.
- **The user can say what they want in their own way.** They can sketch it by hand, write a paragraph or paste a reference screenshot, all in the same editor cards use.
- **The flow is obvious.** The user accepted last round's direction: manual creation, agent design, proposals that need confirmation. That direction never said where a person clicks, what they see, or what happens after the click.

A survey of similar products (Sudowrite Story Bible, Novelcrafter Codex, Campfire, World Anvil, Tana) found one pattern: people own type definitions, the AI drafts and fills them, and every change is confirmed. Novelcrafter keeps field types to a few kinds (line, text, dropdown, reference) and lets each field set its AI visibility. Tana gives each field a one-line "how the AI fills this". None lets the AI silently invent or rewrite a type.

## Proposal

### Three nouns

- **Type**: a row of today's category panel (`BoardCategory`), not a new concept. A category with a **definition** is a type with a look. A category without one stays a plain note card, as today.
- **Brief**: what the user wants, written for the agent. It is a card body written in the same block editor, so words, drawings, images and a later table all work. A brief constrains no card. Only the agent reads it.
- **Definition**: a structured contract the agent drafts and the user adopts. It holds a field table (each field has a type and a one-line "how to fill"), a layout and one example card. Once adopted, every agent files cards by it, and the board renders cards from it.

### The type page: everything happens on one page

The type page is the canvas detail's third page kind, next to the card page and the manuscript page. Its crumb reads `画布 › 分类 › 人物`. There are three ways in:

1. A "设计" button on every category-panel row.
2. "设计这个类型" in the ⋯ menu of a category chip on the filter strip.
3. A hint line under the name input when a category is created: 「想让这类卡长得不一样？建好后点『设计』」.

The page has three sections, **always in this order**. Different states only change what each section holds:

```
┌─ 画布 › 分类 › 人物 ────────────────────────── ⋯ ┐
│                                                  │
│  ① 参考稿                                  [编辑] │
│  ┌────────────────────────────────────────────┐  │
│  │ 每个人物一张卡：名字、身份、性格三个词，     │  │
│  │ 和谁有关系。卡面上要能一眼看到身份。         │  │
│  │ ┌──────────┐  ┌──────────────────┐          │  │
│  │ │ 手绘草图 │  │ 贴的参考截图     │          │  │
│  │ └──────────┘  └──────────────────┘          │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ② 定义                                          │
│     （还没有定义：这类卡现在是普通便签）          │
│                                                  │
│  ③ [ 交给 Agent 设计 ]                           │
│     把参考稿和这类卡现有的几张带进对话，         │
│     你可以再补一句要求。                         │
└──────────────────────────────────────────────────┘
```

- **The brief** is written in the block editor and saved the way a card is (⌘⏎ / 保存). An empty brief can go to the agent too, which then designs from the name and the existing cards.
- **「交给 Agent 设计」** works like a manuscript's 「让 Agent 改」. It appends a quote to the main session's input: "design a card type for category 人物 (cat_…) on canvas 《X》". It does not send. The user adds a sentence and sends it. The agent reads the brief, any current definition and a few sample cards with the new `canvas_read_type`, then files a **proposal** with `canvas_propose_type`.

### The proposal: see the result on the page, then decide

When a proposal arrives, section ② becomes a comparison view:

```
┌─ 画布 › 分类 › 人物 ────────────────────────── ⋯ ┐
│  ① 参考稿（折叠）                          [展开] │
│                                                  │
│  ② Agent 的提议 · 待确认                         │
│  ┌────────── 预览 ──────────┐  字段              │
│  │ ┌──────────────────────┐ │  名字   单行  必填 │
│  │ │ 林默         退役刑警│ │  身份   单行  卡面 │
│  │ │ 冷静 · 固执 · 愧疚   │ │  性格   标签  卡面 │
│  │ │ ─────────────────── │ │  关系   引用→人物  │
│  │ │ 关系：苏晴、老周     │ │  备注   多行       │
│  │ └──────────────────────┘ │                    │
│  │ 用示例卡 ▾ / 用「林默」  │  版式：档案         │
│  └──────────────────────────┘                    │
│  Agent：身份放卡面是因为你说要一眼看到……         │
│                                                  │
│  [ 采用 ]  [ 不采用 ]   想改？在对话里接着说     │
└──────────────────────────────────────────────────┘
```

- **The preview on the left** renders the proposal's example card by default. A dropdown swaps in an existing card of this type to show it wearing the new look; fields it has no value for read 「待填」.
- **The field table on the right** is read-only. Each row gives a name, a field type and marks such as required or on-face. Hovering a row shows the field's "how to fill".
- **Changes go through the conversation.** The agent's next draft **replaces** the current proposal. Only one proposal waits at a time, so drafts never stack.
- **Adopt** makes the definition live. If existing cards of this type have no field values yet, the page asks once:

```
┌──────────────────────────────────────────┐
│ 已采用「人物」的定义。                    │
│ 这类已有 6 张卡，字段还空着。             │
│ [ 让 Agent 回填 ]   [ 先不用 ]            │
└──────────────────────────────────────────┘
```

  「让 Agent 回填」 also appends a quote to the input. The agent calls `canvas_propose_fields` for each card. Each card then shows a "fields awaiting confirmation" mark, and the user ✓/✗s them one by one on the card page. The board's bulk selection gains 「全部采纳字段」. A card's body **stays as it is**: fields are added next to it, never carved out of it.
- **Reject** drops the proposal. The brief and any current definition stay unchanged.

### When the agent starts it

Suppose the user says in chat 「帮我把人物做成卡」 and the canvas has no 人物 category yet:

```
用户：帮我给这些角色做人物卡
  │
  ▼
Agent：canvas_read_board → 没有「人物」分类
  │
  ▼
Agent：canvas_propose_type（label: 人物，没有 kind）
  │    → 新建一个 enabled=false 的分类，带一份提议
  ▼
画布上：筛选条末尾出现一个虚线 chip「人物 · 待确认」
  │    点开就是上面那张类型页（参考稿为空，提议在）
  ▼
采用 → 分类启用 + 定义生效 → 回填的问题同上
不采用 → 这个待确认分类连同提议一起删除
```

The reply in chat only says it proposed a 人物 type on the canvas and to click the dashed chip on the filter strip. It never pastes the field table into the reply.

### After adoption: how cards look and how later agents use them

```
板上（档案版式）              卡片页
┌──────────────────┐         ┌─ 画布 › 人物 › 林默 ──────┐
│ 林默   退役刑警  │         │ 名字  林默                │
│ 冷静·固执·愧疚  │         │ 身份  退役刑警            │
└──────────────────┘         │ 性格  冷静 · 固执 · 愧疚  │
  名字 + 标记「卡面」的字段    │ 关系  [苏晴] [老周]       │
                             │ 备注  ……                  │
                             │ ───────── 正文 ────────── │
                             │ （原来的卡片正文，块编辑器）│
                             └────────────────────────────┘
```

- **On the board**: the title comes from the first required line field. Under it go at most three on-face fields.
- **On the card page**: the field form sits above the body. Fields are edited in place (line, text, dropdown, tags, reference picker). The body keeps the block editor.
- **Later agents**: `canvas_read_board` lists, after each category that has a definition, its field table with each field's hint. `canvas_propose_card` gains a `fields` argument. A missing required field or an unknown field sends the call back with the problems listed; nothing is silently dropped.

### Data shape

```ts
interface BoardCategory {
  id; label; order; enabled
  brief?: string              // the brief: the same markdown as a card body (draw:// and attachment:// lines)
  definition?: TypeDefinition // the adopted definition
  proposal?: {                // at most one at a time
    definition: TypeDefinition
    rationale: string
    renames?: Record<string, string> // old field key → new, when a definition is revised
    createdAt: number
  }
}

interface TypeDefinition {
  version: number             // +1 on every adoption
  fields: FieldDef[]
  layout: 'note' | 'profile' | 'entry'  // note / profile / entry; custom HTML templates come later
  guide?: string              // how to write this kind of card overall (for agents)
  example: Record<string, FieldValue>
}

interface FieldDef {
  key: string                 // stable id: a rename keeps the key
  label: string
  type: 'line' | 'text' | 'select' | 'tags' | 'ref' | 'number'
  options?: string[]          // select
  refKind?: string            // ref: which category's cards it may point at
  hint: string                // how to fill it, for agents and people
  required?: boolean
  face?: boolean              // shown on the card face
}

interface BoardCard { /* … */ fields?: Record<string, FieldValue>; fieldProposal?: Record<string, FieldValue> }
```

- Everything lives in `canvas.json`. An old file without these fields reads as it does today, with no migration.
- When a definition is revised, values move by `renames`. A field the new definition drops **keeps its value** on the card. The card page lists it at the bottom under 「已移除的字段」, where it can be copied out. Nothing is silently deleted.

### New tools

| Tool | What it does |
|---|---|
| `canvas_read_type(kind)` | Returns the name, the brief's text, the current definition, any pending proposal and up to three sample cards. The brief's **images and drawings reach the model as images** (see Risks). |
| `canvas_propose_type({kind?, label?, definition, rationale, renames?})` | Files a proposal. With no `kind` it creates a pending category. |
| `canvas_propose_fields(cardId, fields)` | Proposes one card's field values (for backfill); they wait for the user's confirmation. |
| `canvas_propose_card` + `fields` | Files a card by the definition. Missing or wrong fields send it back with the problems listed. |

### Phases

- **P1a**:
  - the type page: brief, definition, proposal preview, adopt/reject;
  - `canvas_read_type` and `canvas_propose_type`;
  - the three layouts;
  - the card page's field form;
  - `propose_card`'s `fields`.
- **P1b**:
  - backfill: `canvas_propose_fields`, the "fields awaiting confirmation" mark and bulk adoption;
  - the dashed chip for agent-started types.
- **P1c**: a custom HTML layout that fills a template from the fields and renders in the sandbox (the character-dashboard case).
- **Later**:
  - P2: backlinks for reference fields.
  - P3: field values that evolve by chapter, with agent-proposed updates. `FieldValue` stores only the current value for now and can later grow a "from which chapter" history.

## Alternatives considered

**Only the agent creates types.** A name is something the user can make in a second, and nobody should be blocked when the agent is unavailable or offline. No product in the survey hands type creation to the AI. What they hand over is drafting and filling.

**Let the user drag fields and build layouts (a form designer).** This is how Campfire and World Anvil work. It is complete but heavy, and the user wants to say what they want, not learn a designer. The brief plus an agent draft covers that. Small field edits (rename, delete) can later open up on the field table without changing this flow.

**Make the type page a dialog, or put it inside the category panel.** The preview needs width, the brief needs the full block editor, and a proposal needs a place the user can come back to. A dialog holds none of that and cannot stay open while the conversation runs. A third detail-page kind gets the crumb and the back path for free.

**Let a proposal take effect at once and undo it on error.** A definition changes how every card of the type looks, and it is the contract every later agent follows. Preview-then-confirm costs little; a silent change costs a lot.

**Parse fields out of the card body (the body holds lines like `名字：林默`).** This needs no new data shape, but it breaks the moment the format drifts, and every agent must take care not to break it while writing the body. Separate fields and a free body stay out of each other's way.

**Keep several proposals side by side to compare.** That brings state to manage and confusion over which one to adopt. One proposal at a time, revised in the conversation, with the chat history as the version trail.

## Acceptance criteria

- Create 人物 in the category panel and click 设计 to reach the type page. Write a paragraph in the brief, sketch a box and paste an image. All three survive a save and a reload.
- Click 「交给 Agent 设计」 and the input shows the quote. After sending, the agent calls `canvas_read_type`, **describes the sketch and the image in the brief**, then calls `canvas_propose_type`. The proposal appears on the type page, and the preview switches between the example card and existing cards.
- Say 「身份改成下拉」 in chat. The proposal is replaced, and the page still shows only one proposal.
- After adopting, existing card bodies are unchanged. Once the backfill proposals are confirmed card by card, the board faces show 身份 and 性格, and fields are editable in place on the card page.
- In a new session, ask the agent to 「加一个人物：苏晴」. Unprompted, it reads the definition and files a card by its fields. Leaving out a required field on purpose earns an answer listing the problem.
- When the agent starts a type, a dashed chip appears on the filter strip. Rejecting removes both the chip and the category.
- An old `canvas.json` reads without migration, and a category without a definition renders exactly as it does today.

## Risks

- **Can the agent see a drawing?**
  - Today a drawing is stored as strokes, and a quote only tells the agent 「附手绘 N 笔」.
  - The host's llm layer accepts image blocks in tool results, as attachment refs. What still needs checking is whether `defineTool` output can emit such a block. If it cannot, that goes through the upstream-change pipeline.
  - Until then, the fallback is to rasterize drawings into attachments when a brief is saved, for the agent to read as attachments.
  - This must be verified before P1a starts.
- **How well the model honors the field contract.**
  - Sending a card back for a missing field costs one more call.
  - Long `hint`s would crowd the tool context. So `canvas_read_board` lists only field names and types, and the full `hint`s live in `canvas_read_type`.
- **Revising a definition with cards already filed.** Field renames rely on `renames`, which the model may leave out. Old values are kept and shown under 「已移除的字段」, so the worst case is moving them by hand, never losing them.
- **What P1 gives up.**
  - The user cannot add or remove fields, or tune layout details, without the agent.
  - Three fixed layouts cannot draw a dashboard. That waits for P1c.
