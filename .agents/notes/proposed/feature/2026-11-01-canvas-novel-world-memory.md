# Agent Note: The long novel as a world memory — settings, a story-time timeline, and planning as retrieval

Status: proposed

## Problem

The person used the long-novel canvas on a real book (《潜梦者》, 5 chapters, 41 cards) and found (2026-11-01):

- **设定 is a pile of cards that do not connect.** 29 of 41 cards are 世界 cards, 20 of them 「规则」. A creature (鹿蜀) is filed as a rule, several 原则 cards are really world rules, and factions (睡眠公司, 断环) exist only inside rule text. No card points at another, so the person cannot see the world they designed.
- **规划 is rarely used and reads badly.** The outline proposal is one long paragraph per volume; the page holds the first tab although the person opens it once per book.
- **确认计划 seems to do nothing.** It stamps `planConfirmedAt`, but the agent only writes when the person also says so in the conversation.
- **The chapter plan has no focus, and 「信息差 c2」 is unreadable.** `infoGaps[].who` was stored as the model typed it (a ref such as `c2`) and the page did not resolve refs.
- **The write brief does not fit.** `renderWriteBrief` puts every 世界 card into 「硬约束」: about 4,900 characters of world cards plus 1,200 of 原则 against a budget of about 2,000. When it overflows, foreshadows and recaps are cut, never settings. Undecided 工作稿 settings are presented as 「违反即返工」.
- **There is no way to write yourself** except registering a finished file as 用户原稿 through the agent.

## Proposal

Organize the novel as memory, borrowing the standard split:

| Memory | In the book | Changes |
|---|---|---|
| Semantic | 世界观: 体系 / 地点 / 势力 / 物种与道具 | Slowly, confirmed by the person |
| Episodic | Timeline · 已发生: events in story time, with cause and consequence | Every reconciled chapter |
| Prospective | Timeline · 将发生: preset events, character intentions, consequences, reveals, promises | Opened, advanced, released per chapter |
| Autobiographical | Each character's 处境, 当前打算, 相信的事 (with source: 亲历 / 听说 / 推测), 怎么看别人, 瞒着别人的 | Every reconciled chapter |
| Procedural | 写作原则 | Rarely |

A character stores only what they believe. 「误以为」 and 「不知道」 are never stored: planning computes them by comparing beliefs against the truths in the working set. The card's 知道的事 / 不知道的事 fields merge into 相信的事.

### Tension and tiers

Each future event carries tension, after Lewin's tension systems, the Zeigarnik and Ovsiankina effects, the goal-gradient hypothesis, expectancy × value, and Steel's temporal motivation theory:

`tension = V × E × (1 + 0.25·Z) ÷ (1 + k·D) × satiation`

- **V**, value: set by the agent when it creates the event, editable, +0.1 when an idea is bound to it.
- **E**, readiness: the share of the event's preconditions that reconciliation has ticked (each tick records its chapter).
- **D**, distance to the event's window in chapters (no window counts as 4).
- **Z**, chapters since the event was last touched.
- **S**, times advanced in the last 4 chapters; satiation multiplies by 0.35 at 3 or more.
- **k**, pace: one value per book, fixed for now.

Tiers are checked in order: 饱和 (S ≥ 3) → 搁置 (a precondition unmet) → 临近 (D < 3) → 积压 (Z ≥ 3) → 就绪. The D, Z and S explanation lines are templated from the journals at read time and never stored.

### Planning is retrieval

1. The previous chapter's ending, always.
2. **Recall is a tool** (a `novel_read` mode). The engine ranks every future event and returns up to 8 one-line candidates: events marked 优先推进 first; events marked 本章屏蔽 removed before the agent sees them; every 临近 event; then by tension. Apart from the POV character, one character may appear in at most 2 candidates. 饱和 and 搁置 events stay out and are listed by name only.
3. The agent picks 1 main line and 1–2 side lines; the plan records them as 「本章推进」. 本章屏蔽 clears once the plan is registered.
4. A second read expands only the picked events: involved characters' memory and the belief comparison, the cause chain, settings reached along card links, in-scene relations, and bound ideas verbatim.
5. Reconciliation checks 「本章推进」: advanced, released, or planned and missed.

The write brief becomes three layers: always (premise, theme, tone, principles, ~400), this chapter (the expansion, ~1,500), and an index of every other setting by name (~300) that the agent can look up with `canvas_read`.

### Surfaces

- **Tabs** become 章节 · 设定 · 时间轴 · 灵感. 规划 folds into 章节: volumes head the chapter list as segments with a progress bar. The one-page outline moves to 设定 · 总览. 故事 retires: per-card chapter links move into each card's 「出现在」, and the chapter × card table becomes the timeline's 按章节 view.
- **设定**: 总览 (premise, world layers, 写作原则), 世界观 with nested places and card links plus computed backlinks, 人物, 关系 (a graph scrubbed by chapter). Foreshadows become reveal events whose detail is a ladder of 「读者此刻知道」 rungs ending in the truth.
- **时间轴**: 已发生 by story time, with time as a free label and order as position; finished volumes fold into one summary line each. 将发生 is grouped 按优先级 with the formula shown. An event the text realizes moves to 已发生 with its chapter; an intention that fails moves there marked 落空.
- **章节**: 下一章候选 with 优先推进 / 本章屏蔽; 按计划开写; in-place editing of the chapter file (the phone included); 「新建一章，自己写」 as 用户原稿. Changing less than 5% of a reconciled chapter keeps it 已对账 with a 「对账后改过 N 字」 note.
- **灵感**: 记录灵感 only stores. 「排进时间轴」 sends one message to the conversation, the agent proposes in that turn, and it writes after the person agrees. 手动绑定 offers candidates by the names the idea mentions, with no model call. States are 待写入 and 已写入第 N 章; ideas can be deleted.
- **Setting changes**: the chapters whose reconciliation used the setting are marked 待检查; in the next conversation turn the agent delegates a subagent to check them and marks 与设定不符 with a quote.

### No silent model calls

The plugin never calls a model in the background. Every model-backed step happens in a visible conversation turn, as a tool call or a delegated subagent, so `context-lens` shows it. Tension, tiers, recall ranking, explanation lines and idea candidates are computation.

### Migration

Existing cards convert automatically:

- 世界 · 规则 cards on one theme become sub-entries of one 体系.
- 地点 cards gain a parent.
- 道具 cards and mis-filed creatures go to 物种与道具.
- 历史 cards become timeline events.
- Factions named in rule text are proposed as 势力 cards.
- 写法 原则 cards go to 写作原则; 原则 cards that are really settings go to 体系; the book's thesis and ending go to the outline.

The run happens once, in the conversation, and ends with a 整理结果 the person reviews. The skill and the extract schema change so new cards follow the categories.

### Batches

1. **按计划开写** and the 信息差 handle fix. **Implemented in this change**:
   - The confirm button reads 按计划开写. It confirms, then sends 「第 N 章计划确认，按计划开写。」 as the person's message through the conversation input's `submit`. A draft the person is typing is never sent: the line is appended to it instead.
   - `resolvePlan` resolves `infoGaps[].who` to a card.
   - The chapter Remote also maps a character's ref (c2) to its name, so plans stored before the fix read correctly.
2. 世界观 categories, card links, migration, and the three-layer brief. **The brief's settings layer is implemented ahead of the rest**:
   - The plan gains 用到的设定 (`uses`), resolved to cards on registration and editable in the plan's text form.
   - `gatherBrief({ for })` carries in full the plan's `uses`, the settings the last two chapters' 对账 recorded (`ChapterRecord.settings`), and every setting whose name the plan mentions (the plan brief also scans the latest two recaps and the previous tail). Other settings go by name only.
   - Settings whose text says 工作稿 / 待定 / 未决 / 暂定 / 待调整 carry 「未定：别在正文里写死」.
   - A caller without `for` gets the old all-in-full brief.

   **The shelves, links and migration are implemented too** (genre `novel@5`):
   - New categories 体系 / 地点 / 势力 / 物种与道具 (roles `system` / `place` / `faction` / `item`) replace 世界 in the genre. The engine reads all four as settings (EntryRole `world`, with `RuleView.sort`), so the brief, 对账 and refs are unchanged. 原则 is labelled 写作原则.
   - Link fields are `ref` fields whose `refKind` names a category role: `parent` on every shelf, `base` on 势力, `faction` / `home` on 人物. The canvas now matches a ref field's `refKind` against a category's id or its role (`refResolverOf`, the field picker). Writes resolve links by ref or name, and an unresolved link is dropped and reported.
   - `canvas_read` lines and card details show the shelf, 属于 and the backlinks (下属 / 以此为据点 / 相关人物). The card page gains a 关联 block from the `card` Remote's `links`, with chips that open the card or the chapter.
   - 整理设定 is `novel_write(what=organize)`. `phase=preview` stores `organize.json` with the default moves (old 世界 cards by 类型) plus the agent's moves and new entries, and answers the 整理结果. `phase=apply` needs a later user message (the plan-confirm guard). It first triggers the canvas genre catch-up, then creates entries, refiles cards with their fields carried over, sets parents, and switches off an emptied old 世界 category.
   - Still to do in batch 2: the 设定 · 总览 page and the place tree. The board still lists categories as the canvas draws them.
3. Timeline, future events, tension, the recall tool, and the five-part character memory.
4. In-place chapter editing and the 灵感 tab.

The agreed prototypes are local, under `proposals/` (gitignored): `proposals/prototypes/canvas-novel-world-memory.html` (v3, the reference) and `canvas-novel-world-codex.html` (v2: 设定 layout, card links, the second-book example).

## Alternatives considered

- **One numeric priority score shown to the person.** Rejected: unexplainable. The person sees tiers named after the dominant component, with the formula one click away.
- **Storing 误以为 / 不知道 on the character.** Rejected: they are the author's view. A character only believes things.
- **A separate 「未了之事」 pool beside the timeline.** Rejected in favour of future events: the person mostly discusses what happens next, and intentions, consequences, reveals and promises are all events.
- **Calendars and story-time arithmetic.** Rejected: order is primary and time is a label, so precision can vary freely, as can differing time flow between worlds.
- **Letting the model decide where an idea belongs right after it is saved.** Rejected: that would be a silent background call.
- **Letting the agent pick from every future event.** Rejected: recall is a tool so hundreds of events never reach the model.

## Acceptance criteria

- On 《潜梦者》 the write brief for chapter 6 fits its budget, carries only the settings reached from the picked events, and lists the rest by name.
- The 设定 tab shows four 世界观 groups with nested places and backlinks; no 世界 · 规则 card is left unconverted without the person's say.
- The timeline orders events by story time; a realized future event moves to 已发生 with its chapter.
- Recall returns at most 8 candidates, never a 本章屏蔽 event, always every 临近 event.
- 按计划开写 sends exactly one message and never sends a half-typed draft.
- No model call happens outside a conversation turn.

## Risks

- Reconciliation must extract more (events, belief changes, precondition ticks). Evidence quotes stay mandatory, but a shallow extraction degrades planning quietly.
- Automatic migration can misfile; the 整理结果 review is the safety net.
- Expansion along card links can miss a setting a chapter needs but no link reaches; the name index keeps it reachable.
- Retiring 规划 and 故事 moves surfaces the person already knows.
