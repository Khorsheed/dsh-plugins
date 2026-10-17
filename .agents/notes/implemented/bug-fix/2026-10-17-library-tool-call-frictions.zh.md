# Agent Note: 图书馆 —— 批量教学报错、{ items } 包壳宽容、铸造 id 的容忍（来自实盘会话的调用账）

Status: implemented

## Problem

一个实盘上手会话（「新建数学项目并制定学习路线」，2026-10-16）最终完成了，但 13 次 `library_*` 调用里有 8 次是失败重试：

- `library_roadmap` 试了**六次**。`validateRoadmapShape` 遇到第一个形状错误就返回，于是每次重发 ~10 节点完整 payload 都只撞见下一个错（read 站挂 acceptance ×3 处、依赖 read 节点 ×3 次、quiz 站挂 acceptance ×1）。模型每条报错都看得懂——代价纯粹是"一个往返只报一个错"。
- `library_book` 的 `toc` 以 `{ items: [{ part, title }] }` 到达——包了一层、不匹配任何 oneOf 分支——harness 的 schema 闸在工具自己的教学报错（`arrival()`）运行**之前**就拒了："must match exactly one oneOf branch (matched 0)"。重试退回纯换行字符串，**把模型原本写好的 part 分组丢了**（结构化分支本来就支持 `part`）。
- `library_project { id: "math", … }` 与 `library_binding { book: "calculus_lifesaver_2010", … }`：模型会自造 slug id。注意不对称——`library_book` 的编辑参数叫 `bookId`，模型用对了；裸名 `id` 读起来像"给它起一个"。

## Decision

- **批量教学报错**（service.ts）：`validateRoadmapShape`、`putQuiz` 的逐题闸、`writeCards` 的逐卡检查收集**全部**问题后一次拒收——单问题的消息逐字不变；多问题的拒收是一条头部（`N shape errors — fix them all, then resend:`）加逐条项目符号（文案不变）。有级联关系的后续检查做护栏而不是堆叠（`target` 无效则跳过它的 focus/cardIds 检查；`ranges` 缺失数组是它自己的报错，不是崩溃）。
- **接受 `{ items: [...] }` 包壳**（tool-definition.ts）：`payloadList` 负责拆包，且每个 list 参数（`toc`、`extras`、`nodes`、`questions`、`marks`、`cards`）都挂上对应的 `LIST_WRAPPER_SCHEMA` oneOf 分支，让这种形状穿过 schema 校验进入 execute——真正写错的对象在那里得到工具自己的 `arrival()` 教学报错，而不是晦涩的 oneOf 拒收。
- **`library_project` 的编辑参数改名 `projectId`**（与 `library_book` 的 `bookId` 对齐；`id` 仍可从类型面之外读到，给记住了旧名的模型兜底），描述写明 id 是铸造的、调用方永远不可选。未知的 id **带** name 是伪装的创建：直接创建并在返回里带 `note` 说明（仓库 degrade-don't-explode 惯例）；未知 id **不带** name 时保留 not-found 教学报错。
- **`setBinding` 的未知书拒收教顺序**：书 id 是铸造的，且注册书会自行绑定会话——模型那次提前调用的 `library_binding` 永远不需要。

## Alternatives considered

- **自动修而不是教**（非 practice 节点上的 `acceptance` 默默挪进 `goals`、默默删掉对 read 节点的依赖）：否决——acceptance 行在 assess 时是逐字评判的，goals 是散文；默默改放模型的意图会存下它并没有表达的数据，而且什么也教不会。批量报错把教学保留下来，往返数降到五分之一。
- **调用方自选 id**（采纳 `id: "math"`）：否决——id 是事件账本和所有外键（covers、binding、quiz scope）的锚；"调用方永远不可选"正是它稳定的原因。
- **在 harness 层修 oneOf 报错**（拒收时报出各分支）：报错的对口层确实在上游——另行跟踪；包壳分支在这里先修好这一类形状。
- **大 payload 一律 `type: 'json'`**：否决——详细 schema 对组装的引导作用已被证明（会话的 nodes 第一次就形状全对，错的是语义）。

## Consequences

- 单问题 payload 的报错文案不变；多问题 payload 得到一条头部加同样的逐条行。若有调用方对多错 payload 做全文匹配会感知到——不存在这样的调用方（测试都用子串匹配）。
- 六个 list schema 各多了一条宽容分支；真正写错的对象现在能进入 execute、得到更好的报错。
- 证据基数：一个会话。fail-fast 的修复是结构性的（其代价模型不依赖单个会话），包壳和 slug 两条修的是各观察过一次的形状——值得在更多实盘运行后复查。

## Testing

`tool.spec.ts`（+4）：`projectId` 编辑（`id` 为静默别名）、未知 id 带 name 的创建返回 note、`{ items: … }` 包壳的 toc 注册后 part 保留、三处问题的草稿一次拒收列全、多错题的考卷同理。既有的单错误测试钉住逐条文案不变。`pnpm --filter @khorsheed/dsh-library build && test` 全绿。
