# Agent Note：story-bible M3——客户端界面（两 tab、一张 Remote、host 侧补动词）

Status: implemented

## 问题

M1 把记忆核心以无头形态交付了：整个创作环（focus → 幽灵卡 → 规划 → 写作 → 审过 → 对账）都能用工具驱动，但操作者没有界面可以「看见」——方案 §6 承诺右栏两个 tab（五视图的灵感碎片、章节阅读），验收标准是「mockup v7 全部交互真实可用；多作品切换隔离正确」。M3 要回答 M1 留下的三个实现问题：一个包的两个 tab type 怎么注册；M1 动词集止步的地方视图层读什么；以及界面如何得知主会话自己的写入（agent 经 story_* 工具改同一个 store，没有任何通知）。

## 决定

### 两个 tab type、两个注册 id、零运行时开关

本包在右栏注册表上注册两个页型 type：`story-fragments` 用包自己的 id（identity 三角的 client 端），`story-reader` 用 `@khorsheed/dsh-story-bible/reader`——tab 注册表要求每个 type 的 `id` 唯一，一个 kind 的 body 按它 definition 的 id 注册进 keyed 的 `sidebar.right.pane.tab` 槽（经宿主 tab-registry 源码核实，不是猜测）。模式可见性按 docs/plugin-visibility.md 的跨会话分支：作品 store 是部署级内容，所以**没有**运行时开关——安装层决定；agent 行（工具/轻指引/skill）照旧随 cordis preset 授予，不动。M3 交付的两行 `tool.call.toolview` 在 F1 后续撤回（用户实测觉得时间线里的定制卡突兀）：时间线回到宿主通用行，可操作入口全部收敛到 sidebar（plan 卡、待审队列）加会话头 chip。`src/client/rows.ts`、`toolview/` 与其测试已删。

### 视图层：一个共享 shell、按视图取切片、轮询 + 触碰

两个 tab 挂同一条作品条（注册表下拉 = focusWork、readWork 现算计数的行、带注册工作区选择的内联新建表单）和同一个 `useWorkShell` hook：注册表/focus/info 一处取，所有变更在落库成功后触碰共享 store。每个视图在挂载时与 store 的 `rev` 变动时各自重取自己的 story Remote 切片。主会话的 agent 经 story_* 工具写入时没有任何通知，所以可见的 tab 以 5 秒节拍触碰 store（canvas BOARD_POLL 先例）——轮询加触碰，不发明 action 元数据通道；方案的「工具结果 action 元数据」刷新契约由工具行的门（「去确认」/「去处理」导航到对应界面）加这个节拍实现。章节正文经 ui-content-preview 内核渲染（源码面内联，`ContentPane` 配本包自己的字典——PREVIEW_KEYS 解析测试钉住契约）；规划中的章显示大纲草案视图（采纳的墙上灵感 + plan），而不是一片空白正文。

### M1 止步的 host 动词（独立 commit，20bfa8c9）

mockup 的手势需要 M1 没有提供的五个动词，全部按同一套围栏版本守卫的 store 风格补齐，而不是在 client 里绕道：

- `patchMemory`——设定集的字段编辑走工具契约早已写明的 derives_from 修订协议（旧条归档、新条当头）；
- `confirmChapterPlan`——plan 卡的 ✓ 需要一个持久事实（ChapterRecord 上的 `planConfirmedAt`）；
- `foreshadowExit`——世界记忆卡的三出口（登记揭晓/弃置/转设定）合为一个动词，让「转设定」原子地建规则并把伏笔揭晓进去；
- `listMentions`——章节点轨读 mentions.jsonl；
- `retractExperience`——对账导入的经历现在带 `e<n>` id 和「自动·可撤销」标，撤销手势按 id 删一行（流水对系统仍然 append-only；用户的撤销是唯一特许例外）。

### 场景/物品两板如实空着

方案 §6 的设定集列了五板（世界观/人物/场景/物品/创作原则），但 §2 的 kind 轴（世界/人物/章节/伏笔点子/原则）没有任何值会归档进场景或物品。与其在 client 里发明一套打标约定，不如让两板带空态渲染，并把这条缝记录在这里：要么 kind 轴在后续里程碑加 场景/物品 值（schema 决定），要么两板并入世界观。chip 行保持五板宽度，缝合上时布局不动。

## 考虑过的其他方案

**一个 tab type 内部切换。** 少一次注册，但两个界面身份不同（一个是阅读器，一个是工作台），guide 只会有一个入口，工具行也无法按 kind 用 openTab 分别抵达。两个 kind 也正是 mockup 自 v1 以来的形态。

**preset 可见性自隐藏（会话绑定分支）。** 可见性文档自己的规则就否决了：会话-preset 判据对跨会话内容无定义——2026-09-16 的 canvas 自隐藏事故正是这样把一个界面永远藏掉。

**chip 红点带实时待审计数。** 需要一个按会话 focus 轮询的 apply 级轮询器——为一个标签付出的管道不值。队列头部自己带计数；真要补，M4 维护层一起做。

**在 client 里绕过 M1 缺的动词**（比如把记忆编辑实现成浏览器侧删一条建一条）。那会丢掉不变量承诺的 derives_from 轨迹（LLM 写的一切都可见可撤），还会把修订协议劈成两份实现。host 侧补动词是更小也更诚实的改动。

## 后果

- 完整旅程可以在 link 开发实例里跑通：新建作品 → 灵感落卡/采纳/归档 → 规划 → 写作 → 审过 → 对账 → 待审处理 → 多作品切换，全部打真实 store。
- 落卡/登记类答案是短事实行（降噪规则：界面自己显示，模型不代为通知）；只有决策点（plan 确认、待审、计划落空）说话。
- `docs/packages.md` 的 story-bible 行有了 web 列；`scripts/check-plugin-independence.ts` 的 ALLOWED_EDGES 增加 story-bible → ui-content-preview 源码面边（local-files / worktrees 先例）。
- 59 个 client+host spec 钉住：五视图同源渲染、幽灵卡流程、待审队列、plan/审过状态机、作品条、行解析、store 与 PREVIEW_KEYS 字典契约。
- 已知遗留：「在编辑器打开」优先 open-in-app 的 IDE 探测（只接受目录——宿主路由拒绝文件），兜底官方文档预览；场景/物品两板在 kind 轴缝合之前按设计为空。
