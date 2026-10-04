# Agent Note: canvas-novel——story-bible 引擎改挂到画布和卡片上

Status: implemented

## 问题

story-bible 把一部作品存成自己的表（`memories.json`、`characters.json`、按作品的流水），还自带浏览器界面。画布体裁方案（[2026-10-04-canvas-genres-and-novel](../../proposed/architecture/2026-10-04-canvas-genres-and-novel.zh.md)）把它并进画布，成为「长篇小说」体裁：一部作品就是一张画布，设定就是卡片。方案的第 2 步——搬包、拆掉旧客户端、把引擎改挂到画布和卡片上——要做完，同时不留两份正本，也不留死代码。

## 决定

- **一个包，改名**：`@khorsheed/dsh-story-bible` → `@khorsheed/dsh-canvas-novel`（身份三角、服务 `canvasNovel`、工具 `novel_read` / `novel_write` / `novel_extract`、函数段 `novel:pointer`、skill `novel`、状态目录 `$DSH_HOME/state/novel/<画布 id>/`）。浏览器端删掉，界面长在画布的体裁接缝里。`state/story/` **不迁移**。
- **体裁注册**经 `ctx.canvasBoard` 延迟注入：体裁预置四个分类（人物 / 世界 / 原则 / 伏笔）及其字段定义。没有画布就没有体裁，每个引擎动词回答 `missing`。
- **会话绑定决定作用域**：`./agent` 入口只在会话绑到长篇小说画布期间，把三个工具注册到该 agent 自己的 scope 上；收到 `canvas/binding-changed`、`canvas/genre-changed` 时重新判定（被后来者取代的判定不落地）。没绑定的会话里工具不存在，而不是被拒绝。轻指引和 skill 仍只注册一次，未绑定时轻指引渲染空串。
- **卡片是唯一正本**。编号是显示名，和引擎注记（张力、当前态、置信度、`autoImported`）一起放在 `annotations.json` 旁挂文件里：人物 `c<n>`；世界、原则、伏笔共用一个号段（`w<n>` / `w<n>` / `#<n>`），新卡取最大值加一。流水（`experiences.jsonl`、`mentions.jsonl`）按卡 id 记。
- **幽灵卡**：`novel_write(card)` 不带 id 时提议一张卡（画布 `proposed`、`createdBy: 'agent'`），必须给该分类的主字段；采纳前不进 brief。带 id 时就地合并字段；不认识的键和选项外的取值在 `ignored` 里报回。`review` 动作：accept / discard（proposed）、archive（kept）、retract（kept 且自动入库的）。卡片从不删除。
- **对账**保留五道闸；抽取出的新设定、新伏笔、新人物落成幽灵卡，高置信度事实自动入库（可撤销）。待审队列缩到 `mention`、`experience`、`plan-missed` 三种。
- **删除**：`memories.json`、`characters.json`、旧客户端、`remote.ts`，以及读它们的所有代码路径。
- **bundle-writing** 跟着改名（授予行 `@khorsheed/dsh-canvas-novel/agent`，人设和注释改称 `novel_*`）。

## 考虑过的其他方案

**保留引擎的表，再镜像到卡片上。** 两份正本，外加随之而来的同步 bug；用户已确认卡片是正本。

**为了连续性保留 `story_*` 名字。** 仓外还没有东西依赖它们，改一半名的包比干脆断开更难读；现在改名、不迁移是用户定的。

**人物认知、秘密、关系作为引擎状态**（方案里的草图）。这些是作者手改的东西，所以做成卡片的多行字段；引擎只存它推导出来的。

**根行上用 `restrict deny` 授予工具。** 被拒的工具仍会以拒绝的形式出现；按 scope 注册让它们干脆不存在，更省也更清楚。

## 后果

- 没有体裁的画布完全不受影响：这里的一切都挂在体裁和绑定上。
- **来源接缝**：经 `putCard` 落库的卡（高置信度自动入库）在画布上是 `createdBy: 'user'`；在画布给 `putCard` 加来源参数之前，这些卡的 agent 来源只记在旁挂文件的 `autoImported` 注记里。
- **界面空档**（暂时可接受，工具能覆盖）：章节阅读页、伏笔台账页、人物分节、待审条、撤销、角标。
- 旧的 story-bible notes 作为历史保留，并链接到这里。

## Testing

全量 build 之后跑 `pnpm --filter @khorsheed/dsh-canvas-novel test`（45 个：store、tools、import、brief、agent、preset-scope）和 `pnpm --filter @khorsheed/dsh-bundle-writing test`（7 个）；`pnpm gate`。

## Related

- [方案：画布体裁与长篇小说](../../proposed/architecture/2026-10-04-canvas-genres-and-novel.zh.md)
- [story-bible M1](2026-10-04-story-bible-m1.zh.md)
- [story-bible M3 客户端](2026-10-04-story-bible-m3-client.zh.md)
- [story-bible preset 授予](2026-10-04-story-bible-preset-grant.zh.md)
- [story-bible F1 首会话修复](2026-10-04-story-bible-f1-first-session-fixes.zh.md)
