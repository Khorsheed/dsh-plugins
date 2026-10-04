# Agent Note：画布体裁，以及 story-bible 并入画布成为「长篇小说」体裁

Status: proposed

## 问题

story-bible（记忆、人物、伏笔、章节、对账）和画布（卡片、带类型的分类、成稿）是为同一件事长出来的两个产品：写作者的看板。story-bible 自带的界面——右侧栏两个页签、作品条、碎片墙——重复了画布已经做得更好的部分（卡片、类型字段、卡片页、带版本守卫的成稿），观感也一直没成熟。它真正有价值的是引擎：对账的几道闸、伏笔账、按章的人物认知，以及「自动入库可撤回」这条不变式。

用户于 2026-10-04 拍板（设计页 `proposals/prototypes/canvas-story-pack.html`，story-bible 原负责人的意见写在其提问区）：

- 界面全部进画布。引擎仍是独立插件，作为画布可加载的**体裁**（创作体裁）。每个体裁带一个冷启动版本，用户自己的版本以后再做。
- 一部作品 = 一块画布。写作会话通过会话标题栏的 chip 绑定画布；会话只感知绑定的那块，侧栏可以看任意画布。
- 章节正文是工作区里的 markdown 文件（以文件为准）；普通成稿仍存在画布里。
- 没选体裁的画布体验与今天完全一致，绑定 chip 不出现。
- 不做迁移：story-bible 还在测试期，没有作品。
- story-bible 不交还原负责人：由画布负责人重建为 `@khorsheed/dsh-canvas-novel`，引擎用 `git mv` 搬过来（保留历史），旧客户端直接删掉。

## 方案

### 画布宿主侧扩展位（`@khorsheed/dsh-canvas`）

- `CanvasBoardService` 上的**体裁登记**：`registerGenre(def)` 返回撤销函数；`listGenres()` 回答装了哪些。定义带 `id`、`label`、`version`、可选的 `base`（派生自哪个版本——为「另存为我的版本」预留）、`description`、种子分类（`{ role, label, definition }`），以及授予其工具的 agent 行名（客户端据此判断会话的预设是否带这个体裁）。
- **画布字段**：`CanvasBoard.genre?: { id, version, selectedAt }` 与 `BoardCategory.role?: string`。`normalizeBoard` 保留两者（今天它会丢掉未知键）。用户改了分类名之后，体裁靠 `role` 找到「自己的」分类。
- **`selectGenre(canvasId, genreId | null)`**：补齐缺失的角色分类（幂等），记下体裁。清空体裁保留分类和卡片，只卸下体裁界面。一块画布一个体裁。
- **会话绑定**：`bindSession(session, canvasId | null)` / `boundCanvasId(sessionId)`，持久化在 `<stateRoot>/bindings.json`（重启不丢，不像今天内存里的 focus 表）。只有带体裁的画布能被绑定。画布工具的目标解析为「绑定的画布，否则侧栏聚焦的那块」。fork 继承等确认宿主的 fork 信号后再做。
- **变更事件**：cordis 上下文上的 `canvas/genre-changed` 与 `canvas/binding-changed`，体裁据此重算按会话的工具遮罩，不必轮询。
- **文件承载的成稿**：`BoardManuscript.storage?: { kind: 'workspace', workspace, path, token, externalEdits }`。读写走工作区文件，沿用同一套 `baseVersion` 契约；上次读取后 stat token 变了就算一次外部编辑（version +1、`externalEdits` +1）。删除这类成稿只注销登记，不动文件。普通成稿不受影响。

### 画布客户端扩展位

声明为画布页签注册的子 slot，用 `renderSlot` 渲染（ui-cordis `tool.view.cordis` 的做法）：

- `canvas.card.face`——按分类角色 keyed；替换该分类卡片的卡面。
- `canvas.card.section`——list；卡片页正文之后追加的区块。
- `canvas.page`——按页面种类 keyed；`CanvasPlace` 新增变体 `{ kind: 'page', page, canvasId, param? }` 路由到它（章节页、伏笔账）。
- `canvas.board.strip`——list；钉在看板下方的条（待审）。
- 装了至少一个体裁时，画布 ⋯ 菜单出现「创作体裁」。
- 会话标题栏的绑定 chip 由画布自己注册；只在预设带已登记体裁 agent 行的会话里出现，只列带体裁的画布。

### 长篇小说体裁（`@khorsheed/dsh-canvas-novel`）

- `packages/story-bible` 搬到 `packages/canvas-novel`。保留并改造：`store.ts`、`types.ts`、`brief.ts`、`skill.ts`、`tools.ts`、`agent.ts`、`remote.ts`、`invariant.ts` 及其宿主测试。删除：整个 `src/client/` 及其测试，以及只有旧客户端调用、新界面用不上的 Remote 动词。
- **设定变成角色分类里的画布卡片**：人物（身份、核心欲求/缺失/创伤、外貌、声音）、世界、原则、伏笔。伏笔卡只存一手事实——问题、状态、埋设章、答案；张力、沉睡与最近活动从提及流水现算，绝不存到卡上。
- **引擎保留**画布没有形状承载的东西，以画布卡片 id 为键：人物认知、当前状态、带变化流水的关系、经历、提及、待审条目，以及以成稿 id 为键的章节记录（计划、阶段、回顾）。
- **章节计划**新增 `synopsis` 与 `beats[]`（`{ text, where?, who?, turn? }`）。对账逐条标记节拍写到与否；落空的节拍默认是弱提示，连续两章落空或带伏笔操作时才升级。
- **从已有章节开始**：把一个文件夹的章节文件认领为文件承载的成稿，先抽骨架（名册、地点、一句话梗概）作为提议，再按顺序对账第 1..N 章。第 N 章的素材只含截至第 N-1 章已有的内容。
- **技能**拆成固定的流程主干（规划 → 写作 → 对账，审阅闸）和可替换的方法段（伏笔设计、抽取规则、文风）——即将来「我的版本」的覆盖点。
- **工具按会话挂载**：只在会话绑定到本体裁的画布时出现。在按 agent 的 scope 上 `ctx.tools.restrict({ deny })`，于 `agent/created`、`tools/change`、`canvas/genre-changed`、`canvas/binding-changed` 时重算。
- `bundle-writing` 与 `scripts/check-plugin-independence.ts` 跟着改名；story-bible 对 `ui-content-preview` 的边随其阅读器一起去掉。

### 顺序

1. 画布宿主扩展位，再做客户端扩展位——没有体裁的画布零变化。
2. 搬包、拆掉旧客户端、引擎改以画布与卡片为键。
3. 章节页（文件承载正文）、带梗概与节拍的计划、审阅闸。
4. 伏笔账、人物页区块（认知、状态、关系、经历）、待审条、从已有章节开始。

每一步单独合入。第 2 到第 4 步之间长篇体裁没有完整界面；用户接受这个空档（该包不在 3080 profile 里）。

## 考虑过的替代方案

**story-bible 保留自己的界面，只与画布互链。** 一本书两块板、两套卡片模型，story-bible 的界面还得把画布走过的成熟过程再走一遍。用户否决。

**把引擎做进画布包。** 每块画布都背上小说专属的逻辑和工具，其他体裁（论文、文章）也没有扩展位可接。拆成体裁让画布保持通用。

**通过宿主的会话投影绑定。** 绑定随会话历史走、fork 自然继承，但当前宿主线上没有确认可供插件写入的会话事件通道。state 目录的表现在就能重启不丢；以后换成投影只改存储，不改 API。

**把派生的伏笔值（张力、沉睡）存到卡上。** 卡和账会漂移。卡上只放一手事实。

**迁移 story-bible 的作品。** 测试之外一部都没有。

## 验收标准

- 没有体裁的画布在任何操作后磁盘内容逐字节不变，界面不出现任何体裁元素；预设不带体裁的会话不出现绑定 chip。
- 选择长篇体裁只补一次角色分类；改分类名后体裁照常工作。
- 已绑定的写作会话，其画布工具与小说工具都作用于绑定的画布，不论侧栏显示哪块；绑定在宿主重启后仍在。
- 未绑定到长篇画布的会话里没有小说工具。
- 在外部编辑器改章节文件会让该章版本前进，模型基于旧版本的修改被拒。
- `packages/story-bible` 不再存在；没有代码路径引用 `@khorsheed/dsh-story-bible`。

## 风险

- 画布已在 3080 上线；扩展位不能让无体裁路径回退。每一步都以现有画布测试集加一条无体裁往返测试为闸。
- 文件承载的成稿会在画布 state 根之外写文件；围栏必须把它们限定在声明的工作区内，并尊重只读会话。
- 第 2 到第 4 步之间长篇体裁没有完整界面。
- 绑定的 fork 继承推迟；后续补上之前，fork 出的会话从未绑定开始。
