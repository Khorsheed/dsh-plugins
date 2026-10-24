# @khorsheed/dsh-dev-suite

[English](README.en.md) | 中文

在 dsh 里写代码：一句话把活交给本机的 Kimi / Codex / Claude Code，几个 agent 在一个协作间里分工，抬头就知道这个会话在哪个分支上。

以前想让本机装好的 Codex 或 Claude Code 接一块活，得自己开终端、复制粘贴、再把结果搬回来；同时开几个 worktree 时，还要去终端敲 git 才知道当前会话对着哪个分支、有多少没提交的改动。装上开发套件、把会话切到「开发模式」，agent 就能直接委派给本机的编码 CLI，过程在子会话里实时可见；会话头部显示分支和改动行数，一点就看 diff 和提交记录；活大了就把几个 agent 请进同一个会话，协调者拆任务、成员交证据，验收还是你说了算。这个套件写给在 dsh 里做开发的人。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/dev-mode.png" width="640" alt="开发模式全景：协作间邀请成员、会话头部的工作树徽标与改动抽屉、子 agent 任务胶囊">

## 可以这样跟 agent 说

- 「把 parser 里这个 bug 交给 Codex 修，修完告诉我改了哪些文件。」
- 「新建一个 worktree 做登录页重构，在那边干活，别动 main。」
- 「邀请 Claude Code 和 Kimi 进来：Claude Code 写实现，Kimi 补测试，你来协调，最后给我看证据。」
- 「列出这个仓库的所有 worktree，哪些还有没提交的改动？」
- 「改完先过构建和测试，再重启实例。」

## 特性

- **把活委派给本机的编码 CLI**——Kimi、Codex、Claude Code 各有一个委派工具，委派在子会话里执行，思考、工具调用和回复实时可见，可中止、可续聊；它们跑在插件隔离的目录里，你本机原装 CLI 的配置与凭据不被动到。
- **也能委派给另一个 dsh**——在设置的本地 Agent 卡片里打开开关后，agent 可以把子任务交给一个隔离运行的无头 dsh（默认关闭）。
- **一个会话，一整队 agent**——邀请第一位成员，会话就升级为协作间：@ 名字派活、多个名字并行派发；协调者拆目标、成员交证据，验收由你决定。
- **抬头就知道在哪个分支**——会话头部的分支徽标带合并 diff 行数，点开右栏看待提交改动、提交记录与仓库文件；agent 可以列出、切换、新建、删除 worktree，删除必须确认，有未提交改动的 worktree 一律拒删。
- **快速决策**——agent 可以把「是不是、选哪个、打几分」这类判断交给 TypeSafe 模型，拿回带概率与置信度的答案，而不是一段要再解析的文字。
- **改自己也不怕挂**——agent 改完代码想重启时，重启守卫先确认这次改动的构建和测试都过了才放行，免得改坏的代码把服务连同正在进行的对话一起带走。
- **看清每次请求装了什么**——上下文透镜按 turn 展示每次模型请求的组成：system 每段从哪来、带了多少工具定义、token 与耗时分布。
- **官方标准模式的全部能力还在**——计划模式、压缩、子 agent、工作流、网页检索都照常；委派、工作树、协作间、快速决策的模型工具只授予开发模式会话，其它会话一个也看不到。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 本地 Agent 核（`@khorsheed/dsh-local-agent`） | 家族核心：每家 CLI 一份隔离目录、`/<harness> login` 等斜杠命令、设置里的认证卡片 |
| Kimi（`@khorsheed/dsh-local-agent-kimi`） | 把任务委派给本机的 Kimi Code CLI |
| Codex（`@khorsheed/dsh-local-agent-codex`） | 把任务委派给本机的 Codex CLI |
| Claude Code（`@khorsheed/dsh-local-agent-claude-code`） | 把任务委派给本机的 Claude Code |
| dsh 委派（`@khorsheed/dsh-local-agent-dsh`） | 把任务委派给一个隔离的无头 dsh（设置里打开，默认关） |
| 工作树（`@khorsheed/dsh-worktrees`） | 实况展示会话工作树的分支、待提交改动与提交记录 |
| 协作间（`@khorsheed/dsh-room`） | 把会话升级为有协调者和成员的共享协作空间 |
| 快速决策（`@khorsheed/dsh-typesafe`） | 类型化的模型判断：是/否概率、选项、等级，都带置信度 |
| 重启守卫（`@khorsheed/dsh-ankh-guard`） | 先证明构建与测试通过，才放行自我修改的重启 |
| 上下文透镜（`@khorsheed/dsh-context-lens`） | 按 turn 查看每次模型请求的完整组成：system 分段归因、工具定义、token 与耗时分布 |

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-dev-suite`（或从市场索引里选它），确认后重启实例——装这一个，成员随依赖一起到达，模式与成员由本包统一挂载。随后在会话的模式选择器里切到「开发模式」。

命令行等价：

```sh
dsh plugin --profile web add @khorsheed/dsh-dev-suite
```

<!-- collection:start -->
推荐连同基础体验一起装(「开发」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-dev-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-dev-suite
```

卸载即整族移除（含开发模式）；想保留家族、只关某一个成员，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.7-rc.1`）：✅ 完整——纯组合；成员地板最高 `0.1.5-rc.1`，但模式 preset 行（`@deepseek-ai/dsh-agent-preset` 声明行）在 `0.1.7-rc.1` 才存在，故地板取两者较高者。各成员的个别行为差异见各成员自己的 Compatibility 节。
- 源码线（deepseek-harness master）：✅ 完整（verifiedHost: 0.2.1-rc.1）。

**版本线对照**：`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。

## 已知限制

- **CLI 本体要自己装**——各家 CLI（`kimi` / `codex` / `claude`）需在 `PATH` 上自行安装，登录各走各的 `/<harness> login`；本包不代装、不代登录。
- **快速决策要 TypeSafe 的 key**——没配 key 时判断以结构化失败返回、不会报错崩溃；key 怎么配见 [`@khorsheed/dsh-typesafe`](https://github.com/Khorsheed/dsh-plugins/tree/main/packages/typesafe)。
- **重启守卫要先有看门狗**——它在受看门狗守护的实例上才起作用，并要求部署目录是 git 仓库；首次接管怎么做见 [`@khorsheed/dsh-ankh-guard`](https://github.com/Khorsheed/dsh-plugins/tree/main/packages/ankh-guard)。
- **卸载是整族的**——remove 本包会把全部成员一起移除，没有「从 bundle 里退掉单个成员」的操作；单个停用请用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模式包 = 家族整合包 + 一行模式 preset。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的成员行（含两条停用官方同名工具行的 bare override）逐字来自对应成员包自己的 `cordis.patch.yml`；末尾一行 `preset-dsh-dev`（`@deepseek-ai/dsh-agent-preset` 声明，模式 id `dsh-dev`）是本包自有的正本——它曾镜像自 `@khorsheed/dsh-presets`，该包已于 2026-10-24 退役。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状：行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内，成员必须是真实自挂载包，每个成员至少贡献一行，mode 值全树唯一。

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`（+ override `tool-subagent-codex`） |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`（+ override `tool-subagent-claude-code`） |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |
| `@khorsheed/dsh-worktrees` | `worktrees` |
| `@khorsheed/dsh-room` | `room` |
| `@khorsheed/dsh-typesafe` | `typesafe` |
| `@khorsheed/dsh-ankh-guard` | `ankh-guard` |
| `@khorsheed/dsh-context-lens` | `context-lens` |

两条 bare override 停用官方 preset 里与本家族同名的工具行（`subagent_codex` / `subagent_claude_code`），逐字取自 codex / claude-code provider 自己的 patch。

**模型工具按会话授予。** 开发模式 = 官方标准模式的全部能力，外加 preset 组合里点名的社区工具行：三个委派工具 `tool-subagent-kimi` / `tool-subagent-codex-local` / `tool-subagent-claude-code-local`（各 provider 包的 `./tool` 入口，工具名 `subagent_kimi` / `subagent_codex` / `subagent_claude_code`）、`worktrees-tool`、`room-tool` 与 `typesafe-tool`（`typesafe_judge` 及 `typesafe-decide` skill）。这些行不进 profile 根——挂在根上等于给所有会话授予。`subagent_dsh` 不由 preset 授予，由 local-agent-dsh 的设置开关控制。

**无卡库。** `@khorsheed/dsh-local-agent-dsh-headless`（子 dsh 被 provision 面）进 `dependencies` 不进 patch 行——与 @khorsheed/dsh-bundle-local-agent 同一处理，清单页不出现，随家族存亡。

**装我 = 装一族 + 一个模式，不双挂。** 成员全部列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员自己的 patch 不被应用，任何一行都不会挂两次。成员单独安装仍自挂载；重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/dev`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
