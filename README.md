# dsh-plugins

[English](README.en.md) | 中文

**dsh**(DeepSeek Harness)生态的社区插件 monorepo:**40 个纯增量插件包,其中 29 个已发布 npm**。所有包只走官方扩展点(slots、commands、Remote 服务、会话镜像)接入——不修改任何官方包、不替换官方 UI 槽位、不 hack 核心服务;探测不到可选能力时静默降级,绝不拖垮启动。整套插件按共存设计:任意组合安装、卸载、开关,互不干扰,生产环境长期全量叠装运行。

> 本文只收录**已发布**的包;包总数、形态与 profile 归属以机器生成的[权威包地图](docs/packages.md)为准,各包版本与宿主兼容矩阵以[发布状态](docs/release-status.md)为准(每次发版后重新生成)。仓库同时是开发工作区,开发相关内容见文末[给 Agent 的安装及开发指南](#install-dev-guide)。

## 整合包:四种开箱体验

默认安装单元是一个完整 profile(整合包),不是单包。它的 `dependencies` 决定装哪些包,`dsh.profile.bundles` 决定激活哪些自挂载行。四个整合包对应四种模式:

| 整合包 | 模式 | 包含什么 | GitHub |
| --- | --- | --- | --- |
| **dsh-basic** | 日常模式 | 官方 dsh-web 的体验补充:发出去的消息可以改、可以撤,会话标题一键修改,产物预览与本地文件浏览,能力目录,移动端呈现,后台任务状态,完成提示音,快捷键,运维守护 | [Khorsheed/dsh-basic](https://github.com/Khorsheed/dsh-basic) |
| **dsh-dev** | 开发模式 | 开发 workflow 常用组件:basic 全部体验,再加本地编码 agent 委派(Kimi / Codex / Claude Code / DSH)、worktree 改动实况、room 多 agent 协作,自带「开发模式」preset | [Khorsheed/dsh-dev](https://github.com/Khorsheed/dsh-dev) |
| **dsh-eval** | 评测模式 | 评测 workflow 常用组件:题库、条件、计划进 git 评审,确定性编排执行,自带「评测模式」preset | 打磨中待上线 |
| **dsh-writing** | 写作模式 | 写作 workflow 常用组件:画布协作写作、链接阅读器、会话内卡片渲染,自带「写作模式」preset | 打磨中待上线 |

![dsh-basic 日常模式:消息编辑与撤回、引用动作、会话产物、文件列表、灵感空间一屏装齐](docs/screenshots/basic-mode.png)

![dsh-dev 开发模式:room 多 agent 邀请、worktree 实况徽标、子 agent 任务胶囊](docs/screenshots/dev-mode.png)

前两个是独立仓库,clone 后两条脚本完成安装与同端口交接,详见各自 README;评测与写作模式目前随仓内 [profiles/web-eval](profiles/web-eval) / [profiles/web](profiles/web) 维护,独立 GitHub 仓打磨中待上线。单包安装是高级路径,见文末[给 Agent 的安装及开发指南](#install-dev-guide)。

## 能力地图

每个包的功能详情、配置与截图见各自目录的 README(点目录进包即达)。「随整合包」一列表示它默认随哪个整合包装好;标「单包」的用 `dsh plugin add` 单独安装。

### 对话控制

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`message-tools`](packages/message-tools) | 用户消息**原位编辑 / 真撤回 / 恢复重放**——全家桶里唯一改变模型所见的插件,用的是与官方 compaction 同一套机制 | basic + dev |
| [`message-timeline`](packages/message-timeline) | 会话左缘悬浮**历史消息时间轴**,点击跳转任意用户消息 | basic + dev |
| [`session-title-edit`](packages/session-title-edit) | 聊天区标题**内联重命名**,用户改过的标题不再被自动生成覆盖 | basic + dev |
| [`quote`](packages/quote) | 选中任意文本浮出**引用动作菜单**(引用进 composer / 侧边对话 / 复制),其他插件可注册自己的动作 | basic |

### 文件与产物

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`file-preview`](packages/file-preview) | 会话「**产物**」tab + 宿主服务一体:产物 tab、回合变更卡片、详情页预览抽屉,与只读文件预览 Remote 服务同包(0.4.0 起两行合一) | basic + dev |
| [`local-files`](packages/local-files) | 右栏**本地文件浏览器**:懒加载文件树 + HTML/Markdown/JSON/CSV/图片结构化预览 | basic + dev |

### 任务与氛围

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`taskpilot`](packages/taskpilot) | 聊天框上方**后台任务 / 子 Agent 胶囊**:运行计时、停止/中断、详情抽屉回放执行轨迹 | basic + dev |
| [`context-guard`](packages/context-guard) | 上下文占用越过可配阈值时,聊天框上出现**一键 compact 提醒** | basic + dev |
| [`whalesong`](packages/whalesong) | 任务氛围:鲸鱼喷水、favicon 动画、完成/阻塞提示音(`prefers-reduced-motion` 自动静音) | basic + dev |

> **常用对话组件打包安装**:「对话控制」「任务与氛围」的常用组件再加 inline-html-render,可用元包 [`bundle-conversation-toolbox`](packages/bundle-conversation-toolbox) 一条命令装齐——`dsh plugin add @khorsheed/dsh-bundle-conversation-toolbox`,含 message-tools、message-timeline、session-title-edit、quote、context-guard、taskpilot、inline-html-render 共 7 个包。

### 体验与效率

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`ui-shortcuts`](packages/ui-shortcuts) | **可自定义键位的快捷键**(暂停 / 插队发送 / 新建会话)+ `ctx.shortcuts` 动作注册表;0.1.7-rc.2 起官方内置快捷键,本包预计逐步退役 | basic + dev |
| [`inline-html-render`](packages/inline-html-render) | 把 agent 写的 ```` ```dsh-card ```` HTML 渲染成会话内**沙箱交互卡片** | basic + dev |
| [`dsh-reader`](packages/dsh-reader) | **链接阅读器** tab:RSS/Atom 订阅 + 粘贴文章链接,卡片流 + 可读详情视图 | 单包 |
| [`mobile`](packages/mobile) | **移动端呈现**与 iOS 桥 | basic + dev |

### 开发协作

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`worktrees`](packages/worktrees) | 会话头部 **repo/worktree 徽标** + 改动抽屉:待提交/已提交文件树、diff、提交记录;模型工具经包内 `./tool` 子路径行由 preset 按会话授予 | dev |

### 本地多 Agent

把子任务委派给你本机装的编码 Agent CLI,各自独立上下文、独立记账、跨轮续聊;每个 harness 在自己独立的作用域 home 下运行(`$DSH_HOME/local-agent/<name>`,0700),**绝不触碰你用户目录里的私人配置与凭据**。

与官方版本的差异:支持开发者指定主 Agent 邀请自定义的任意 Harness 完成目标任务——开发者可以根据自己的使用体感编排,比如建议主 Agent 在目标任务中邀请 Kimi 做前端任务,邀请 Codex / Claude Code 做整体任务编排,邀请 DSH 做具体的编码任务等等。

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`local-agent`](packages/local-agent) | 家族**核心**:harness 注册表、作用域目录供给、`/<harness> login|sessions|status|logout` 命令族 | dev |
| [`local-agent-kimi`](packages/local-agent-kimi) | **Kimi Code** harness:`kimi -p` 委派、续聊、记账 | dev |
| [`local-agent-codex`](packages/local-agent-codex) | **Codex** harness:`codex exec` 委派、续聊、记账 | dev |
| [`local-agent-claude-code`](packages/local-agent-claude-code) | **Claude Code** harness:`claude -p` 委派、续聊、记账 | dev |
| [`local-agent-dsh`](packages/local-agent-dsh) | **dsh 自委派** harness:把 dsh 自己当本地 CLI 用 | dev |
| [`local-agent-dsh-headless`](packages/local-agent-dsh-headless) | (组合组件)dsh 委派的 **headless 子 profile** patch | 随 provider |
| [`local-agent-tool-subagent`](packages/local-agent-tool-subagent) | (组合组件)家族共享**委派工具行**,带 `resume` 续聊参数 | dev |

> **本地多 Agent 打包安装**:核心 + 四个 provider 用元包 [`bundle-local-agent`](packages/bundle-local-agent) 一条命令装齐——`dsh plugin add @khorsheed/dsh-bundle-local-agent`。

### 多 Agent 协作

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`room`](packages/room) | **room 会话**:邀请多个 agent 进同一条会话——成员名册 tab、@ 派发、任务板、通知闸门;模型工具经包内 `./tool` 子路径行由 preset 按会话授予 | dev |

### 能力与基础设施

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`capability-catalog`](packages/capability-catalog) | **能力目录**:枚举运行实例的全部 skill 与工具及其注册渠道,设置页三列预览 + 详情弹窗 | basic + dev |
| [`typesafe`](packages/typesafe) | (实验性)**TypeSafe 判定原语**宿主服务:接入 TypeSafe System One 模型(旗舰 Jev)支持模型快速决策场景调用,类型化 noul/choice/score 判定,带熔断、缓存与决策日志 | 单包 |
| [`typesafe-tool`](packages/typesafe-tool) | (实验性,伴生工具行)typesafe 的模型工具,由 preset 按会话授予 | 单包 |
| [`capture`](packages/capture) | **渲染抓取** Remote:托管 headless Chrome 渲染 URL,返回内联样式的序列化页面 | 单包 |

### 运维守护

| 包 | 你得到 | 随整合包 |
| --- | --- | --- |
| [`ankh-guard`](packages/ankh-guard) | 自修改重启的**安全门禁**:绿色凭证(绑定 git HEAD)+ 组合 preflight + watchdog 回滚——让 AI 自己改代码、自己重启,还不把服务搞挂 | basic + dev |

## Agent preset 设计

整合包不只装插件,还交付**按会话授予的 agent preset**。三条设计规则:

1. **工具按会话授予。** 模型工具行不进 profile 根:每个工具面拆成 core(全局服务/UI)+ 伴生 `-tool` 包(只含模型工具行),preset 组合按名引用伴生行——会话选中这个 preset 才拿到这组工具,其它会话的工具面保持干净。伴生 core 缺席时该行 pending,不炸宿主。
2. **UI 随授权自隐。** 会话绑定内容的面(会话 tab、头部徽标)跟随 preset 授予显隐——没被授予的会话根本看不到入口;跨会话的部署面不设运行时开关,装不装由 profile 决定。完整规范见 [docs/plugin-visibility.md](docs/plugin-visibility.md)。
3. **纯增量声明。** preset 以官方「标准模式」组合为底逐字重基,只在末尾追加社区工具行,不改任何官方行。

三个社区 preset:

| preset | 定位 | 授予的社区工具 | 交付方式 |
| --- | --- | --- | --- |
| **开发模式**(dev) | 官方标准模式全部能力 + 本地委派 + git 实况 + room 协作 | `subagent_kimi / subagent_codex / subagent_claude_code`、`worktrees`、`room_invite / room_task / room_message` | 随 [dsh-dev](https://github.com/Khorsheed/dsh-dev) 安装 |
| **评测模式**(dsh-eval) | 无 Shell/无工作流的只读 + 委派评测组合 | datasets 出题工具、eval 执行工具 | 随仓内 [profiles/web-eval](profiles/web-eval) |
| **写作模式**(dsh-writing) | 写作流,含画布 agent 行 | `canvas/agent` | 随仓内 [profiles/web](profiles/web) |

> preset 交付机制随宿主线演进:0.1.5 线由整合包脚本安装目录式 preset(`$DSH_HOME/.agent-presets/<id>/`);0.1.7-rc.1 起改为声明式 bundle 行(本仓 [`packages/presets`](packages/presets),随下一发布波上架)。引用装不上的伴生模块时,该 preset 带诊断留在名册,不影响其它 preset。

## 兼容性承诺

整套插件按共存设计:行 id、UI 席位、事件与命名空间全部互不重叠。唯一的例外说明:已自带 `ankh-guard` 行的镜像(历史 fork)不要再重复添加该包——重复行 id 会导致启动失败,详见 [ankh-guard 的说明](packages/ankh-guard/README.md)。

npm 发布线上各包全部功能完整,唯一例外是 ankh-guard 的组合 preflight 门禁在纯 npm 部署(无 harness 检出)下降级为提示后放行,其余能力完整;源码线(deepseek-harness master)全部完整。

| 宿主版本 | 目标插件 | 安装包名(带版本) |
| --- | --- | --- |
| **0.1.7-rc.1 ~ rc.2**(推荐) | 全部已发布插件;preset 另由 `@khorsheed/dsh-presets` 声明式交付(随下一发布波上架) | npm 最新线,如 `@khorsheed/dsh-whalesong@0.2.3` |
| **0.1.5-rc.1 起** | 全部已发布插件;preset 由整合包脚本以目录式安装 | npm 最新线,如 `@khorsheed/dsh-whalesong@0.2.3` |

逐包版本与 `minHost` 矩阵见[发布状态](docs/release-status.md)(每次发版后重新生成)。

## 模型影响总表

| 插件 | 模型上下文 | Token | KV 缓存 |
| --- | --- | --- | --- |
| message-tools(编辑/撤回) | 有——surface 替换遮蔽区间 | 移除区间 token,新增少量占位 | 前缀从替换点失效(同官方 compaction) |
| message-tools(恢复) | 有——尾部重放 | 新增可重放 token | 仅尾部延展,不改写 |
| local-agent 委派(子会话) | 独立子上下文 | 子会话独立付费,不进父级 | 与父级相互独立 |
| 其余全部插件 | 无 | 无 | 无 |

<a id="install-dev-guide"></a>
<details>
<summary><b>给 Agent 的安装及开发指南</b>(单包安装、卸载、在本仓开发插件——点击展开)</summary>

### 安装

前置:dsh 宿主(版本要求见[兼容性承诺](#兼容性承诺)与各包 README 的 Compatibility 节)。**推荐路径是整合包**(见上文[整合包](#整合包四种开箱体验));单包安装是高级用户按需裁剪或调试的路径。

宿主 ≥ 0.1.7-rc.2 时,单包安装不用碰命令行:**设置 → 插件 → 添加插件**,填 npm 包名(如 `@khorsheed/dsh-whalesong`),按提示启用/重启即可。注意这个入口只认**单个插件包**——本仓是 monorepo、整合包仓是 profile 模板,把它们的 GitHub 地址贴进去会被拒绝并回滚(官方安装器只装仓库根的插件包,不支持子目录);整合包请走各自仓库的安装脚本。

```sh
# 按 npm 名装单个(自挂载包自动挂载自身 loader 行,无需手改 cordis.yml)
dsh plugin --profile web add @khorsheed/dsh-whalesong

# 家族一键装(元包)
dsh plugin --profile web add @khorsheed/dsh-bundle-conversation-toolbox
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent

# local-agent 家族单装时注意:核心与 harness 要显式一起装
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi   # 或 -codex / -claude-code / -dsh
```

装完重启对应 web 实例生效。组合组件包(`*-tool`、`local-agent-dsh-headless`、`ui-content-preview`)不由 `dsh plugin add` 挂载——它们由 profile 的 preset 行或 provider patch 落位,完整关系见[权威包地图](docs/packages.md)。

### 卸载

```sh
dsh plugin --profile web remove @khorsheed/dsh-<name>
```

通用规则:

- **卸载即精确还原。** 没有任何插件修改/替换官方文件,移除后组合精确回到之前的状态。
- **用户数据刻意保留。** local-agent 家族保留每个 harness 的作用域目录(`$DSH_HOME/local-agent/<name>`),重装无需重新登录;ankh-guard 保留 `stateDir` 下的状态(凭证、重启记录、中断会话快照);ui-shortcuts 的键位保留在 `$DSH_HOME/settings.yaml`。任何卸载都不碰会话日志——编辑/撤回的审计轨迹留在日志里是有意为之。
- **家族行随行。** 先卸 local-agent 核心而 harness 还在时,harness 行保持 **pending,不会崩溃**——重装核心即恢复。
- **`enabled: false`** 可以禁用某行而不卸载——这是部署层操作,不是代码改动。

### 开发

独立 pnpm monorepo;每个包以 `@khorsheed/dsh-*` 发布。

```
packages/   一个目录一个可发布插件
profiles/   整合包(basic / dev / web-eval 与生产 web)
build/      共享构建/测试预设(tsdown client bundle、vitest 源码面配置)
scripts/    仓库工具(pack-dist、gen-typert、镜像同步、门禁检查器)
```

```sh
pnpm install
pnpm run build      # pnpm -r --if-present run build
pnpm run test       # pnpm -r --if-present run test
pnpm run typecheck  # pnpm -r --if-present run typecheck
```

测试必须走根 `pnpm test` 或 `pnpm --filter <pkg> test`——裸跑 `vitest run packages/xxx` 会绕过每包的 vitest 配置(源码面别名预设),报误导性的解析错误。

**开发期对 harness checkout 的依赖。** 两条机制解析到本地 deepseek-harness clone(env `DSH_HARNESS`,默认 `~/code/deepseek-harness`),发布的 npm 产物单独无法满足:

- `scripts/gen-typert.mts` 对 harness checkout 重新生成 `lib/typert.*` 产物(带 `./typert`/`./remote` 导出的包);全量构建有保鲜缓存,输入或产物有变才会真生成(`GEN_TYPERT_FORCE=1` 强制)。
- `build/vitest.ts`(共享 vitest 预设)把平台 import 映射到 harness 的 `tsconfig.base.json` 路径——发布的包不携带 `src/`,其 `/client` 入口是 loader 包裹的浏览器 bundle,裸 import 会炸。

CI 注意:先在本仓库旁 clone deepseek-harness 并设 `DSH_HARNESS` 再 `pnpm test`;harness checkout 过期意味着被测 API 面可能落后于生产宿主。发布走 `scripts/pack-dist.ts`(`--family` 重写 peer 依赖的 scope),`npm publish` 前先验证 tarball。完整仓库纪律见 [AGENTS.md](AGENTS.md)。

</details>
