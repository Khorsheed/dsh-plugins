# Agent Note: The long novel as a world memory — settings, a story-time timeline, and planning as retrieval

Status: implemented

## Problem

The person used the long-novel canvas on a real book (《潜梦者》, 5 chapters, 41 cards) and found (2026-11-01):

- **设定 is a pile of cards that do not connect.** 29 of 41 cards are 世界 cards, 20 of them 「规则」. A creature is filed as a rule, several 原则 cards are world rules, and factions exist only inside rule text. No card points at another.
- **规划 is rarely used and reads badly.** Each volume's outline is one long paragraph on the first tab.
- **确认计划 seems to do nothing.** It stamps `planConfirmedAt`, but the agent writes only when the person also says so.
- **「信息差 c2」 is unreadable.** `infoGaps[].who` was stored as typed (a ref) and the page did not resolve refs.
- **The write brief does not fit.** Every 世界 card went into 「硬约束」: about 4,900 characters against a budget of about 2,000, so foreshadows and recaps were cut and drafts read as hard rules.
- **The person cannot write.** The only way was registering a finished file as 用户原稿 through the agent.

## Decision

The novel is organized as memory:

| Memory | In the book |
|---|---|
| Semantic | 世界观: 体系 / 地点 / 势力 / 物种与道具 |
| Episodic | 时间轴 · 已发生 |
| Prospective | 时间轴 · 将发生: 预设 / 打算 / 后果 / 承诺 / 揭晓 |
| Autobiographical | A character's 处境, 当前打算, 相信的事 (亲历 / 听说 / 推测), 怎么看别人, 瞒着别人的 |
| Procedural | 写作原则 |

A character stores only what they believe. 「误以为」 and 「不知道」 are never stored.

### Settings (genre `novel@5`)

- **Shelves.** The categories 体系 / 地点 / 势力 / 物种与道具 (roles `system` / `place` / `faction` / `item`) replace 世界. The engine reads all four as settings: EntryRole `world` plus `RuleView.sort`. 原则 is labelled 写作原则.
- **Links.** Every shelf has `parent`, 势力 has `base`, and 人物 has `faction` / `home`. Each is a `ref` field whose `refKind` names a category role. The canvas matches `refKind` against a category's id or its role. Writes resolve links by ref or name; an unresolved link is dropped and reported.
- **Backlinks.** `canvas_read` lines and details show the shelf, 属于 and the backlinks. The card page's 关联 block comes from the `card` Remote's `links`.
- **整理设定.** `novel_write(what=organize)` with `phase=preview` stores `organize.json` and answers the 整理结果. `phase=apply` needs a later user message. It triggers the canvas genre catch-up, creates entries, refiles cards with their fields, sets parents, and switches off an emptied 世界 category.
- **The brief's settings.** The plan has 用到的设定 (`uses`). `gatherBrief({ for })` carries in full the `uses`, the settings the last two chapters' 对账 recorded, and those whose name the plan (or, for planning, the latest recaps) mentions. Everything else goes by name. Unsettled settings carry 「未定：别在正文里写死」.

### Timeline (`timeline.ts`, `timeline.json`)

- **Events.** Each event has a story-time label (`when`), an `order` position, a status (happened / preset / planned / hidden / failed), a source, people, places, value V, a window, preconditions, causes, and touches. A foreshadow card is a derived reveal event `fs:<cardId>`.
- **Tension.** `V × E × (1 + 0.25Z) ÷ (1 + k·D) × satiation`, with k = 0.4. Tiers are checked in the order 饱和 (S ≥ 3) → 搁置 (a precondition unmet) → 临近 (D < 3) → 积压 (Z ≥ 3) → 就绪.
- **Recall.** `recall` takes preferred events first and never blocked ones, then every 临近 event, then the rest by tension, up to 8. Apart from the POV, one character fills at most two places. Pins (优先推进 / 本章屏蔽) apply only to the chapter they were set for.
- **Writes.** `novel_write(what=event)` writes events, with people and places resolved by name and `after` placing an event in story time.
- **对账.** It adds `events`, `event_progress` (advanced / happened / failed), `preconditions_met`, `beliefs` and `intents`, every row quote-gated. Beliefs and intents go to `minds.jsonl`. A realized event marks its bound ideas 已写入.

### Planning is retrieval

- The plan brief lists the recalled candidates, one line each. `novel_read(what=events, ids)` expands chosen ones: causes, the people's minds, settings and bound ideas.
- The plan records 本章推进 (`advances`). The write brief expands those events with the person's ideas verbatim, and in-scene characters carry 现在打算 and 相信.

### Surfaces

- Tabs read 章节 · 设定 · 时间轴 · 灵感. The canvas gained a third genre face, `faces.extra`, and `faces.board`: a genre's own face in the 卡板 seat, which replaces the card wall (with its scopes and 网格 / 连线 tools) on that genre's canvases only.
- **设定** (`novel:codex`, from the `codex` Remote) follows the agreed prototype. Its parts are 总览 (the one-page outline and its proposal, the four shelves at a glance, the 待定 tray, 写作原则, the 整理设定 button), 世界观 (a tree beside the picked entry's text, links both ways and chapters), 人物 (by faction, with 此刻 / 打算 / 相信的事), 关系 (a graph scrubbed by chapter) and 伏笔 (the reader-knows ladder topped by the truth). Editing a card opens the canvas's card page.
- **章节** groups the contents by volume, with a progress bar, goal and landing. It also holds 下一章候选 with 优先推进 / 本章屏蔽, and 新建一章，自己写 (用户原稿, opening in the editor).
- **The reader edits the chapter file.** `editChapterBody` writes through the fenced path with a stale check, and the draft is kept on the device. A change under 5% of a reconciled chapter stays 已对账 and is noted as `editedAfterExtract`. The editor can keep a selection as an idea and ask the agent to continue. 按计划开写 confirms the plan, then sends 「第 N 章计划确认，按计划开写。」 through the input's `submit`; a half-typed draft is never sent.
- **时间轴** shows 已发生 by story time and 将发生 by priority, with the formula and each event's parts. 按章节 shows the old 故事 table.
- **灵感** stores ideas (`ideas.json`) without asking anything. 排进时间轴 sends a message. 手动绑定 offers events by the names an idea mentions. States are 待写入 / 已写入第 N 章, and ideas can be deleted.
- Character cards show 当前打算 and 相信的事 with their source.

### No silent model calls

Every model-backed step runs in a visible conversation turn, so `context-lens` shows it. Tension, tiers, recall, explanation lines and idea candidates are computation.

### Not done, by choice

- Pace k is fixed at 0.4, not a per-book setting.
- Card fields 知道的事 / 不知道的事 stay on the card. New memory goes to 相信的事.

## Alternatives considered

- **One numeric priority score.** Rejected as unexplainable. The person sees tiers named after the dominant component.
- **Storing 误以为 / 不知道 on the character.** Rejected: that is the author's view.
- **A separate 「未了之事」 pool.** Rejected. Intentions, consequences, reveals and promises are all future events.
- **Calendars.** Rejected. Order is primary and time is a label.
- **The model deciding where a saved idea belongs.** Rejected: it would be a silent call.
- **The agent picking from every future event.** Rejected. Recall is a tool, so hundreds of events never reach the model.

## Consequences

- **What it bought.** The write brief carries what the chapter needs, not every setting. Planning starts from what the story owes: intentions, consequences, promises, reveals. The person can steer by event and write alongside the agent.
- **More extraction.** The 对账 extracts more. Quotes stay mandatory, but a shallow extraction quietly weakens planning.
- **Migration.** Automatic migration can misfile; the 整理结果 review is the safety net.
- **Expansion can miss a setting.** Following links can miss one a chapter needs but no link reaches; the name index keeps it reachable.
- **Tabs moved.** 规划 folded into 设定 · 总览 and 章节, 故事 became 时间轴, and the card wall left novel canvases.
- **Verification.** The surfaces were checked against the prototype on screenshots of the real book's data rendered through the real components (a local harness), not only by tests.
