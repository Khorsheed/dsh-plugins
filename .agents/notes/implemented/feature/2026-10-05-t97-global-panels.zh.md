# Agent Note: 题集和实验室改为宿主全局面板，两边 Remote 不再要会话

Status: implemented

## Problem

题集登记表和实验都是部署级的对象，可原来只能在会话里的 `conversation.view` 标签页里看。会话的预设如果没授予本家族的工具行，这个标签页还会隐藏。想看登记表，得先打开（或者找到）一个预设对的会话。宿主 0.2.0 正好有为这类内容准备的机制：左侧栏的全局入口（`sidebar.panellist`）选中中央面板（`main`），插件管理和定时任务列表就是这么做的。挡路的有两件事。一是两个 Remote 的每个方法都把活的 agent（即会话）当第一个参数。二是 T96 的「核对并登记」卡片靠 DOM 锚点点标签条才能进入核对页。

## Decision

### 两个全局面板，沿用原视图

- `@khorsheed/dsh-datasets` 注册入口 `datasets`（order 30，标签「题集」），`@khorsheed/dsh-eval` 注册 `eval-lab`（order 40，标签「实验室」）。
- 每个包用同一个 id 注册一个 `sidebar.panellist` 图标和一个 `main` 面板。插件管理是 0、定时任务是 10，这两个入口排在它们之后。
- 两处注册都在注册表的结构化视图上走 `slots.inject`，因为两个包都不依赖 ui-layout 或 ui-sidebar。宿主没声明这两个槽时 inject 不会触发，既不显示入口，也不报错。
- 面板组件（各包的 `global-panel.tsx`）渲染会话标签页自己的视图（DatasetsView / LabView），用的是同一个 face 对象。`sessionId` 传空串哨兵 `''`，标签条的 owner props 传惰性值。没有新写视图。
- 可见性遵循 docs/plugin-visibility.md：内容跨会话，所以不加运行时开关。面板不看当前会话的预设，一律注册，由安装层决定哪个 profile 显示。
- 图标：datasets 用生成的 `icons.tsx`（`IconDatabaseOutlineRegular`）。eval 只支持 0.2.0，它的其他组件本来就直接从 ui-primitives 引图标，所以 `IconGaugeOutlineRegular` 也直接引。

### 去掉的会话依赖

- **datasets Remote**：所有方法都去掉了 `agent` 参数，这些方法本来就不读任何会话相关的内容。
  - 客户端改为调用 `remote.x(request)`。
  - 「添加题集」照旧开一个新的「题集整理」会话，和在标签页里一样。
  - 没有当前会话时，新会话的工作区回退到最近活跃的那个（`recentWorkspaceOf`，与 ui-workspace 的「新会话」一致）。
- **eval Remote**：除 `approve` 外的方法都去掉了 `agent`。
  - `approve` 保留，因为批准它的会话是运行的父会话，运行的 cwd 也取自它。
  - 请求类型补了会话字段：
    - 写标记的请求（retry、exportRun、reexport、finalize、humanFinal、closeRun、archiveRun）继承 `EvalCaller { session?: string }`；
    - `EvalExperimentsRequest` 加了 `session?`（`runs` 会原样带回）；
    - `EvalDraftRequest` 加了 `originSession?`。
  - `callerTag()` 把人的标记记成 `tab:<会话>`，没有会话时记成 `panel:lab`。报告只对 `tool:` 打标，所以新标签是中性的。
  - 出于同一原因，`EvalService.humanFinal` 和 `writeHumanFinal` 的参数改成 `sessionId: string | null`。
- **面板里的 LabView**（`sessionId === ''`）：
  - 列表范围固定为「全部」，范围切换隐藏。
  - 「让 Agent 组织」（新建实验）、「让 agent 处理」和送回的「这里」目标都改走新的 face 动词 `startSession(title, text)`：开一个新的评测模式会话，跳过去，把文字填进草稿但不发送，失败时退回剪贴板。送回的「这里」标签改为「新会话的输入框」。
  - 「批准并开始」在后台新建一个会话（不跳转），并在这个会话下批准。建不出会话时返回错误结果，不抛异常。
- **eval 的开会话入口**（`client/new-session.ts`）在调用时逐个探测宿主入口，缺了就降级：
  - `sessions.create`；
  - 用 `workspaces.list` 找最近的工作区；
  - `remote.agentPresets` 的 list/select：默认预设已经包含 `@khorsheed/dsh-eval/tool` 时保留，否则取第一个包含它且没坏的预设；
  - `sessions.using` 改名；
  - `uiWorkspace.openSession`；
  - 输入框 `setDraft`，会话视图挂载期间重试。

### T96 卡片改去全局面板，退役 DOM 锚点

卡片的打开动作把核对请求存到面板键 `''` 下，然后调用 `ctx.layout.selectPanel('datasets')`。没有 `layout` 服务，或者因为没人注册这个键导致 `selectPanel` 抛错时，请求改存到会话自己的键下，卡片显示一行「打开题集标签页」的提示。`switchToTab` 点标签条的做法删掉了。`selectPanel` 是公开的宿主动词，失败方式也有定义（抛错），脆弱的锚点已经没有要兜的情况了。

## Alternatives considered

**在会话方法旁边加全局版本**（比如 `runs(agent)` 旁边加 `runsAll()`）：线协议能保持兼容，但每个读方法都要有两份。大多数方法从来不读会话参数，加一份全局版本等于把一个死依赖一直带下去。最后选了直接删参数。两半在同一个包里发布，会一起升级。

**给面板一个替身会话**（比如传最近的某个真实会话 id）：面板的读取和标记会把来源说错（记成 `tab:<别人的会话>`），全新安装、一个会话都没有时还会直接失败。不采用。

**在 `selectPanel` 之后保留 DOM 锚点作第二道兜底**：`selectPanel` 失败说明面板没注册，也就是宿主没有全局面板机制。这时去点标签条，走的正是 T96 已经标出来的那条脆弱路径。只给一句提示既诚实又稳定。不采用。

**单独的图标模块，或重新生成 eval 的 `icons.tsx`**：图标生成器拒绝处理 eval，因为 eval 已经直接引 ui-primitives 的图标。eval 只支持 0.2.0，而 0.2.0 里就有 `IconGaugeOutlineRegular`。为一个图标生成一份副本纯属形式。不采用。

**像标签页一样给面板加预设门控**：面板的内容不绑定当前会话，在这里用会话预设判断是没有定义的（2026-09-16 画布自隐藏就是这么失败的）。按 docs/plugin-visibility.md 不采用。

## Consequences

- 题集登记表和实验在侧栏点一下就能看到，不需要会话，标签页照常可用。
- Remote 签名变了：T97 前后两侧的客户端和宿主端混用时线协议不兼容。两半由同一个包发布，正常安装不会混用。两个包的 `dsh.compat.notes` 和 README 的兼容性一节都写明了这点。
- 在面板里打的标记记为 `panel:lab`，记录里仍能看出是面板写的，但看不出是哪个标签页。
- 在面板里批准会新建一个会话，用户不会被带过去。会话标题是「运行 <实验>」，在会话列表里能找到。
- 仓里只有 `profiles/web-eval` 一个 profile 装了这两个包（经由 `@khorsheed/dsh-eval-suite`），所以入口只在那里出现。
