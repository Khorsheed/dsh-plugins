# Agent Note: 图书馆——站点讲义、错题区、统一叫「章节考」的关底 tab

Status: implemented

## Problem

对照学习者的文件式微积分工作流（`~/code/calculus`：每章 `notes.md` / `exercises.md` / `solutions.md` / `mistakes.md`），图书馆的每站循环有两个缺口加一处混淆：教练的讲授只活在会话滚动里（没有可重读的讲义）；答错的题喂了卡片却在站级不可见（没有错题本）；关底 tab 按节点 kind 换名字（`quiz` → 章节考、`practice` → 验收），读起来像两套仪式。设计故事板：`proposals/prototypes/library-two-journeys.html`（本地，gitignore）。

## Decision

- **A——站点讲义**：`RoadmapNode.notes?: LibraryNodeNotes`（`{ text, updatedAt, revisions }`，markdown，仅教练可写）。`library_write · notes { node, text }` → `service.putNotes` 写到**已采用**路线的节点上（书级或项目级，book 缺省逻辑与 roadmap 相同），每写一次 `revisions` 加一；`adoptRoadmap` 在重排时保住幸存站点（同 id）的讲义；`normalizeRoadmap` 容忍传递该字段；事件账本记 `node.noted`。侧栏加「讲义」tab（在 我的记录 与 章节考 之间）：元信息行（时间 · 第 N 次更新）、一个刻意极简的 markdown 渲染（标题 / 列表 / 段落 / 粗体 / 代码）、空态、「请教练写讲义 / 补讲」prime。讲授（topic）站的讲义 IS 教材——「LLM 编的教材是什么 kind」的答案：不是书架上的书（那会污染证据闸），而是讲授在每站沉淀的讲义。
- **B——错题区**：章节考 tab 列出「这一站的错题」——每张考卷取其最近一次作答（attempts 在客户端按 `quizId` join；`listAttempts` 的 `nodeId` 参数在 contract 层改可选，因为考卷作答以 `quizId` 为键），每条未通过且未作废的 verdict 映射回存储的题目（题干 + 正确答案，选择题带字母）。一个「重考错题」按钮把请求带进会话，让教练围绕同一批薄弱点出新卷。零新存储：考卷和作答账本本就齐了。
- **C——一个关底 tab**：节点视图的第三 tab 永远叫章节考。知识（quiz）站显示考卷；动手（practice）站显示验收单，改题「这一站考作品 · N 条验收标准 · 过 P% 解锁」。`acceptance` 这个 tab id 保留（路由兼容）；locale 键 `node.acceptance` 删除。

## Alternatives considered

- **讲义用完整 markdown 渲染**：否决——为教练自己写的朴素讲授引入依赖与攻击面不值得；五构造渲染器正好覆盖提示词要求教练写的东西。
- **verdict 里补存学习者答案供错题行展示**：否决——verdict 带的是 criterion/evidence 而非原答案；为一个角标扩大 wire 形状不值得，正确答案已够用。
- **tab id `acceptance` 改名 `quiz`**：否决——id 落在存储的导航状态里；要统一的只是显示名。

## Consequences

- 两条旅程（读一本书 / 领域路线）的每站循环在代码里完整同构：导读 → 学原材料 → 讲义 → 章节考（考卷或作品）→ 错题/卡片 → 解锁——故事板的论断落成现实。
- 教练提示词新增讲义纪律（讲完即写、补讲即更新；讲授站是教材、书站是注疏）。

## Testing

`service.spec.ts`（+2）：书级路径的讲义写入/重写/重排保留；项目级讲义与教学拒收（未知节点、空文本、无已采用路径）。`store.spec.ts`（+1）：normalize 保留正常讲义、丢弃破损的。`tool.spec.ts`（+1）：`library_write · notes` 走绑定缺省与 `book: null`、JSON 文本 payload、教学报错。`pnpm --filter @khorsheed/dsh-library build && test` 绿；`pnpm check:panels --package packages/library` 净。
