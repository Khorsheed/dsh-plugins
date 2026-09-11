# Agent Note: The mission / datasets / eval tool-row split (M4'③)

Status: implemented

[English](2026-09-11-eval-family-tool-split.md) | 中文

## Problem

[单实例多模式提案](../../../proposals/active/2026-08-26-mode-switcher.md)要求社区模型的工具行只进 agent preset、不进 profile 根:会话拿到某个工具,当且仅当它的 preset 授予了那一行。worktrees 与 room 两对已经立好了形状([拆分记录](2026-09-11-worktrees-tool-split.md)),而还有三个包是融合形态:`@khorsheed/dsh-mission`、`@khorsheed/dsh-datasets`、`@khorsheed/dsh-eval` 各自既提供自己的服务,**又**在 profile 根注册自己的模型工具,**还**贡献一段工具提示词——于是每个 preset 的每个会话都白拿十二个 mission 工具、八个 datasets 工具、三个 eval 读工具,以及拼装后系统提示词里的四段指引。

这不是纸上推断,是可观察的事实:2026-09-11 的会话 `session-aabca0ed`(日志记录 `agentPreset: "standard"`)轨迹里,拼装提示词的第 2–9 段正是 mission、eval、datasets 与 Agent Teams——一个标准模式会话的提示词,读起来像评测实例的。社区包这边,worktrees 与 room 的**工具行**半边早已拆完,mission/datasets/eval 还没有。而融合包根本进不了 preset:官方 preset 挂载会拒绝任何在 isolate realm 之外 `ctx.provide` 了服务的行。

## Decision

**三个伴生包,与 worktrees、room 两对同一模板——零形状偏差。**

- `@khorsheed/dsh-mission-tool`、`@khorsheed/dsh-datasets-tool`、`@khorsheed/dsh-eval-tool`(0.1.0)都是纯工具行:不提供任何服务,也不声明 `dsh.bundle`——作为依赖安装只让模块可解析,授予点是 agent preset 的 `agent.cordis.yml` 按名引用该行。每个伴生包在 apply 时探测自己 core 的全局服务(`ctx.mission` / `ctx.datasets` / `ctx.dshEval`),core 缺席时降级为一条日志的 no-op,因此任何组合里引用该行都能干净挂载。工具经延迟的 `ctx.inject(['tools'])` 注册,指引段经延迟的 `ctx.inject(['systemPrompt'])` 注册;每个伴生包打自己的 origin 标签,能力目录因此把工具归到被挂载的那一行。
- **工具定义零复制。** 三个 core 各自通过新的 `./tool` 子路径导出工厂——`missionToolDefinitions(service, tier)`、`datasetToolDefinitions(service, { defaultRepo, group })`、`evalToolDefinitions(service)`——返回未打标、未注册的定义。三个 core 的 `src/tools.ts` 改名为 `src/tool.ts`,因为 typert 生成器会把导出子路径(`./tool` → `lib/tool.js`)反解回源码路径。
- **core 不再注册任何面向模型的东西(BREAKING)。** mission、datasets、eval 保留服务、CLI、slash 命令、Typert Remote 面与会话 tab;不再注册任何工具,也不再贡献提示词段,core 的 `tools` 配置键随之删除。分组档位搬到伴生行:mission `all`(默认)/ `read` / `none`;datasets `all`(默认)/ `read` / `authoring` / `none`;eval `all`(默认)/ `none`。迁移就是既有的那两行——装上伴生包,在 preset 里引用它的行(非默认档位时带 `config: { tools: … }`)。
- **任务 tab 与数据集 tab 自隐**(M3'③/M3'④):各自恰好在该会话 preset 组合里的对应伴生行存在时注册,判据取自官方 `pluginInventory` Remote,隐藏发生在**注册层**(tab 条目的按钮由注册枚举而来,隐藏的 tab 必须是缺席的注册)。所有读不通的路径 fail-open。eval 没有浏览器半边。
- **当下的授予点**:评测包在自己的 `eval` 预设里引用三行并带按域档位(原先挂在 profile 根上的 `mission-tool: read`、`datasets-tool: authoring`、`eval-tool: all`);`profiles/web-eval/cordis.patch.yml` 不再给三个 core 行写 `tools` 键,且该 pack 把三个伴生包当普通成员安装(`package.json` 三条依赖 + 源码模式的 `UNPUBLISHED_DIRS`;profile 设了 `autoInstallPeers: false`,peer 不会被自动装上)。web-dev 的 dev preset **刻意不引用**这三行:三个 core 不在该 pack 的成员清单里(孵化中),而伴生包运行时要 import core 的 `./tool` 工厂——缺行会让**整个** dev preset 报 broken;等这些包上架并加进 `profiles/web-dev/package.json` 之后,这三行才进那个预设。落到正在跑的 3080 实例上,迁移是三步:部署三个伴生包(`deploy:3080` 的 family 打包会带上 core 的 peer 伴生包)、把三行加进 `$DSH_HOME/.agent-presets/dev`、此后开发模式会话才保住 mission/datasets/eval 工具。
- `check-plugin-independence` 新增三条正向边(`<name>-tool` → core)、三条反向 core 边(tab 判据常量按模块名引用伴生包),以及三个伴生目录的 `NO_OWN_PATCH` 项——在那里声明 `dsh.bundle` 会把工具重新挂回 profile 根,正是本次拆分要移除的东西。

## Alternatives considered

**把指引段留在 core、按 scope 门控文本。** 否决:段落描述的是工具,归属跟着注册走。一个 core 一边说"mission 工具是这样的……"、一边把真正的注册放在别的行,要么得依赖那一行,要么在描述缺席的工具;段落随工具一起搬。datasets 的条件文本也是同一条规则定的(它只点名所授予分组真正放行的动词)。

**tab 在组件层隐藏(`return null`)。** 否决,理由 room 已经记过:`conversation.view` 的按钮由 slot 注册枚举而来,组件层隐藏会留下一个空体的活按钮。这里用注册开关,按判据注册/注销。

**抽出共享的 preset-visibility 辅助包。** 再次推迟,如今已有四份内联副本(worktrees 徽标、room chrome、mission tab、datasets tab)。每份约百行且形状一致;等第五个消费者出现再抽取,这次把推迟写进记录而不是默默重复。

**为已经持有 mission/dataset 状态的会话留逃生口。** 否决:room 的"真实 room"规则保护的是拆分前创建的历史 room,而隐藏一个只读查看器不会破坏任何持久物——store、绑定、CLI 与 slash 面都不受影响,且一旦该会话的 preset 授予该行,tab 立刻回来。

**把伴生包写进 pack 的直接依赖。** 否决,与 worktrees/room 先例一致(也因为已发布的 pack 依赖未发布的伴生包会让安装直接失败):core 的可选 peer 加上部署流的 family 打包足以让模块可解析,发布顺序约束改为记录在案。

## Consequences

- **BREAKING,已公告**:preset 未引用三行的会话将失去 mission / datasets / eval 工具集与那四段提示词;core 的服务、CLI、slash 与 tab 面不变。在评测包里这一点可见:那里的 `standard` 预设会话不再携带按域工具,因为档位搬进了 `eval` 预设——这正是拆分的意义。
- **标准模式的提示词重新干净**:除非该会话的 preset 引用了这些行,拼装提示词不再携带 mission/datasets/eval/Agent Teams 段落。最初那处观察到此闭合。
- **任务/数据集 tab 从标准模式会话消失。** 这是对人有意做的一次能力收缩:tab 是查看器 UI,所以不授予工具的 preset 现在也没有 tab。fail-open 让旧宿主(没有 `pluginInventory` 命名空间)、读不通的组合数据、无 preset 会话与 `broken` 预设组继续显示 tab。
- **接线在 pack 里,不在 preset 里**:web-eval 装上三个伴生包并在 `eval` 预设里引用;web-dev 一个都不引用,因为三个 core 不是它的成员(见 Decision)。**相邻的既有缺口(本次只记录、未修)**:web-dev 的 dev preset 早已引用 `@khorsheed/dsh-worktrees-tool` 与 `@khorsheed/dsh-room-tool`,而该 pack 的清单两个都没装——在该 pack 的 `autoInstallPeers: false` 下,这两行在姊妹包上架并列入清单之前是同一个"行解析失败"的形态。
- **没有引入插件间依赖**:每个伴生包在 core 缺席时静默降级,每个 core 在伴生包缺席时照常工作(只是不注册工具)。检查器的受制裁边因此多了三对。
- **验证**:六个包全部构建通过、测试全绿(mission 130、mission-tool 4、datasets 117、datasets-tool 5、eval 393、eval-tool 3);伴生包 spec 冻结注册、origin 标签、分组档位与 core 缺席时的降级,core spec 冻结"不注册"不变式与"工厂不打标",客户端 spec 冻结判据的三种状态(授予 / 未授予 / fail-open)。`pnpm check:plugins` 在 31 个包上 0 findings,检查器自身的 spec 绿;worktree 里的 `pnpm gate` 是合入门禁。
