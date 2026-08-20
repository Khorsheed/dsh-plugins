# Agent Note: datasets M2 — Typert Remote 数据面与 web 会话 tab

Status: implemented

[English](2026-08-19-datasets-m2-remote-tab.md) | 中文

## Problem

[datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)把 M2 排为 web 会话 tab 及其数据面：`conversation.view` 上承载会话数据集绑定与浏览的 tab，由 Typert Remote 服务供数——方法从调用方 agent 解析会话绑定，层白名单与模型工具同等强制。[M1](2026-08-19-datasets-store-m1.md) 交付了 host 三面；tab 与 Remote 通道遗留至今。

## Decision

落在同一个包内交付（`@khorsheed/dsh-datasets` 成为双 face 包：host 插件 + 浏览器 bundle），服务内核仍是唯一的逻辑所有者。

- **Remote 服务**（`src/remote.ts`）：`DatasetsRemoteService extends TypertRemoteService`，cordis 键 `datasetsRemote`（`datasets` 是内核服务），线 namespace `datasets`——浏览器调 `remote.datasets.*`。方法：`binding` / `bind` / `unbind` / `list` / `show` / `read`，每个以 `agent: Agent` 为首参，从 `agent.session` 的绑定加配置默认仓库解析 scope，再委派给 `ctx.datasets`——零复制逻辑，Remote 路径上的白名单强制与工具路径是同一份代码（单测覆盖：`remote.read` 的 `LAYER_NOT_ALLOWED`）。`bind`/`unbind` 写插件自管的绑定存储（最初与 slash 命令一样追加 `datasets/binding` session 事件——恢复毒化修复后迁移，见[下游事件 bug-fix note](../bug-fix/2026-08-20-downstream-session-events-unresumable.md)）。插件 `apply` 在 `ctx.provide('datasets', …)` 之后以 `ctx.plugin(DatasetsRemoteService, { defaultRepo })` 挂载；gateway 经服务的 `typertRemote` 绑定发现它，headless composition 构造它无害（仅标记，无 gateway）。
- **线类型即服务类型**（`src/types.ts`，`./types` export）：纯 re-export `DatasetBinding` / `DatasetSummary` / `ItemRecord` / list、show、read 结果。Remote 边界拒绝 `unknown`，因此把两个自由形态叶子在源头收紧为受约束的 `JsonObject = Record<string, JsonValue>`（`@deepseek-ai/dsh-session` 的递归 `JsonValue`，官方 Remote 服务在边界上用的同一类型）：`ItemRecord.metadata` 与 `DatasetDescriptor.raw`（及 `ShowResult.descriptor`）。这些值按构造就是 `JSON.parse` 的输出，收紧是如实的，线面没有任何重复 DTO。
- **client tab**（`src/client/`）：`conversation.view` 条目，id `datasets`，order 30，store 驱动，含绑定条（当前绑定 + 白名单，绑定/改白名单/解绑表单）、数据集 → item → 层 → 文件树与预览 pane。Remote namespace 经 `ctx.remote.$mount` 挂载、以 `ctx.get('remote.datasets')` 读回——namespace 刻意不进 `inject`（ui-file-preview 的死锁教训）。文案在 `datasets` locale namespace（zh 为准，en 镜像）。[题集级层](2026-08-20-datasets-dataset-level-layers.zh.md)落地后，树把共享层归于 item 列表之前一个安静的「共享」分组；线面增加了 list/show 结果的 `datasetLayers` 字段与可选的 `ReadQuery.item`（缺省 = 题集级读取）——增量、对象承载、由 gen-typert 重新生成。
- **预览组件选型**：官方 primitives，不用社区组件。官方 client 包没有导出完整的文件阅读器组件（ui-deliverables 只列产出文件），社区 ui-file-preview 的 `FilePreviewPane` 与其会话写入 fold（`FilePreviewEntry`/diffs）耦合——引用它会构成被禁的跨插件边且语义域错误。官方阅读体验以 `@deepseek-ai/dsh-client-ui-primitives` 的部件存在，全部是 loader 模块表解析的平台模块。活冒烟后，预览对齐了「产物」tab 的渲染方案（`bf6f785`）：其 pane 是 ui-file-preview 的私有装配，故 `src/client/preview.tsx` 用同一批官方部件复刻同一视觉族——markdown 走 `MarkdownText`（chat 同款渲染器）、JSON 走 `JsonTree`（RPC 负载面板的检视器）、其余走 `CodeBlock`，文档形态外套官方块 chrome（圆角 `--dsw-alias-markdown-code-block` 面 + 格式 banner）并配 pane 局部的预览级 markdown 字号覆盖。CSV/TSV 表格渲染刻意不移植（datasets 层文件实践中是 markdown/JSON/YAML；分隔符文件降级为高亮代码视图）。没有任何自研渲染器。
- **树的视觉语言**：数据集 → item → 层 → 文件树遵循 IDE 资源管理器（VS Code）的解剖，经两轮活截图评审定型：紧凑 24px 行、每个组级都有 chevron 展开（层也可折叠，默认展开）、每个展开组下的发丝缩进参考线（`--dsw-alias-border-l3`，对齐父行 chevron 中轴）、紧跟标题的安静计数后缀（`· N 个文件`——绝不右浮；标题放弃 flex 伸展）、数据集描述名单独占一行安静行、整行 subtle hover/选中背景且严格裁在树内容盒内。图标：层用官方 `IconFolderClose16`/`IconFolderOpen16`（层就是仓库目录）；文件叶子用最小内联 SVG 文档轮廓——官方图标集没有文件图标，自研按扩展名的图标字体性价比不合而否决（记录在此，未来官方图标集出现可替换）。item 元数据不属于资源管理器：chips 移出树、进预览 header（选中该 item 的文件时显示）。绑定条与表单用官方 `Button`/`Input` 原子件；全部样式按 docs/web-styling.md 消费 `--dsw-*` token——无硬编码颜色与字号。
- **预览区骨架**：pane 镜像产物 tab 的结构（读 ui-file-preview 源码与活实例；跨插件 import 禁令不变）：一条安静 header 行——文件图标、`item / layer/path`（13px/500）、item 元数据 chips、安静的等宽数字 commit——下压发丝线，内容置于 760px 计量列（chat 阅读宽度——全宽 banner 的 space-between 会读成空洞），首个块对 header 的上外边距收紧，官方块 chrome 读作一张贴着内容的卡片。
- **构建契约**：`scripts/gen-typert.mts` 注册 datasets（hostConfigs `tsconfig.host.json`）；包构建跑 gen-typert → `tsc -b`（solution tsconfig + host/client 项目引用，message-tools 布局）→ 经共享 `clientBundle('@khorsheed/dsh-datasets', …)` helper 的 `tsdown`。package.json 新增 `./types`、`./client`、`./typert`、`./remote`、`./src/*` exports、`dsh.client` 声明（platform web；inject 集照抄 ui-file-preview）、client bundle 与 typert 产物的 `files` 条目，以及 `zod` 依赖（生成的 remote-client 产物运行时 import 它，与 file-preview/message-tools 相同）。client 侧 peer 全部标 `peerDependenciesMeta.optional`，headless 安装保持精简。

## Alternatives considered

- **拆一个独立的 `@khorsheed/dsh-client-ui-datasets` 伴侣包（file-preview/ui-file-preview 式拆分）**——否决：那对拆分存在是因为 host 半可被其他 UI 独立消费；datasets tab 是 Remote 的唯一消费方，单包让身份三角、绑定语义与线类型保持在一个可评审单元内。双 face 单包先例是 message-tools。
- **自由形态线叶子用 JSON 字符串编码（`metadataJson`、`descriptorJson`）**——否决：线格式看似有损、每个消费方都要 parse；把叶子类型收紧为 `JsonObject` 是精确的，与官方边界词汇一致，代价只是 `JSON.parse` 处的两个 cast。
- **所有 Remote 方法用请求对象参数（message-tools 形态）**——读取侧最初否决（改用可选位置参数 `list(agent, dataset?, commit?)`，调用点更简洁），**活实例冒烟后采纳**：生成器接受可选位置参数，但网关 client 代理按调用方实传个数转发并强制精确 arity（`client api: datasets/list expected 3 argument(s), got 2`），省略尾部可选参是类型系统诱导的运行时失败。`list`/`show` 改收 `ListRequest`/`ShowRequest` 对象（对象内可选字段在线上方真正可选）；`read` 保持服务内核的 `ReadQuery` 对象。
- **经新的特许边复用 ui-file-preview 的预览 pane**——否决：pane 的 props 要求会话写入 fold 的 entry 形状；datasets 文件是没有 turn/step/diff 词汇的 git 对象，所谓「复用」会变成 import 背后的重实现。

## Consequences

- Remote 线词汇从真实服务类型生成：tab 与工具之间未来的任何漂移在生成期失败，而不是运行时。
- **精确 arity 是网关不变量，不是类型层的**：Remote client 调用必须传满每个声明过的位置参数（任何可选项都进请求对象）。单测 bench 是 stub namespace 的，只有活实例冒烟能抓到 arity 失配——tab 的首次冒烟正好抓到一个。
- `ItemRecord.metadata` / `DatasetDescriptor.raw` 现在是 `JsonObject`——纯类型层收紧（运行时值不变）；写 `Record<string, unknown>` 的消费方照常编译（JsonObject 可赋给它）。
- 对 `scripts/gen-typert.mts` 的修改必然落在 `packages/datasets/` 之外：生成器的共享类型元数据要求单批次全集运行，包必须注册进中央列表（该文件头部注释记录了原因）。
- tab 经 RPC 读整个文件、无字节上限（工具语义）；README 的 Known Limitations 把大文件消费方指向 `worktree_path`。
- 相对提案草图的偏离：没有 descriptor 透传 pane，也没有「引用进对话」按钮——草图的树/预览/绑定条均已交付；引用按钮需要 input-machine 接缝决策，提案留白，tab 没有它也成立。

## Testing

`packages/datasets/tests/`——9 个文件 55 测试（M1 的 39 个保持绿）。新增：`remote.spec.ts`（bind/unbind 事件往返、list/show 白名单过滤、`remote.read` 的 `LAYER_NOT_ALLOWED` 与 git 对象直读、NO_REPO fail-loud 与配置默认回退、数据集白名单遮蔽），在裸 cordis context 里跑真实服务内核加 fake 存活会话；`apply.client.spec.ts`（message-timeline bench 形态：Remote 挂载、条目 id/order、注入面的动词到 namespace 绑定、重复挂载降级、拆卸回收）；`DatasetsView.client.spec.tsx`（未绑定空态、绑定后树展开、选中驱动预览（markdown 经官方 `MarkdownText` 渲染）、绑定表单提交解析、解绑、读错展示）。

## Cross-references

- [datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)——本实现（M2）的设计。
- [datasets store M1](2026-08-19-datasets-store-m1.md)——本里程碑所前置的 host 三面与服务内核。
