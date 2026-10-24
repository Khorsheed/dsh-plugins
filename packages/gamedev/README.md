# @khorsheed/dsh-gamedev-suite

[English](README.en.md) | 中文

和 agent 一起做小游戏：对话里定玩法，右栏看分章节的策划，玩每一轮通过检查的最新版本。

以前想做个小游戏，要么自己写代码，要么让模型写一份代码再自己想办法跑起来、找 bug、改了又坏。装上游戏开发套件、把会话切到「游戏开发模式」，agent 既写代码也当策划搭档：先和你定一句话玩法、有哪几类元素、选哪种美术风格，每个开放问题都给两三个具体选项让你拍板；然后尽早做出能玩的最小版本，照你玩下来的感受一点点改。每一轮结束，插件自动检查改过的项目，没过就把问题交回 agent 当场修，过了才进右栏「游戏」的试玩区。没做过游戏策划也能上手。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-gamedev-hero.png" width="640" alt="游戏开发模式的会话：左边对话末尾是本轮改动卡片，右栏「游戏」操作台正在试玩最新版本">

## 可以这样跟 agent 说

- 「我想做一个躲陨石的小游戏，先给我几个玩法方向。」
- 「主角跳得太低了，调高一点，再发一版给我试。」
- 「加一种会追着玩家跑的敌人。」
- 「把策划里「关卡」这一章补完整。」

## 特性

- **策划导师带你做**——每个开放问题（玩法、机制、元素外观或数值）给两三个具体选项和一句理由，一次最多问两个问题，决定由你做。
- **先能玩，再迭代**——玩法、元素类型和美术风格定下后，先做出能玩的最小版本，每轮改一两处、说清改了什么，决定记进对应的策划章节。
- **每轮自动检查**——项目文件校验、本机 Chrome 无头加载冒烟、跑 agent 随代码写的测试脚本；没过就把问题交回 agent 在同一轮里修（最多 2 次），过了就进试玩区。
- **右栏「游戏」操作台**——试玩调参、外观编辑、分章节策划、版本与回滚都在这里。
- **本轮改动卡片**——每轮结束，回复末尾一张卡片列出这轮改了什么，每行「查看」直接跳到右栏对应位置。
- **面板里改，提交成新版本**——在「元素」里改外观、字段、设定，预览立刻跟着变，试玩区先不动。
- **项目就是一个文件夹**——项目放在会话工作区里，版本快照、检查结果、试玩记录都在里面，整个文件夹拷走就带走。
- **多一双手**——把活委派给本机的 Kimi / Codex / Claude Code，或开协作间让几个 agent 一起做。
- **只在游戏开发模式的会话里出现**——游戏、委派与协作间的模型工具按会话授予，其它会话一个也看不到。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 游戏开发（`@khorsheed/dsh-game`） | 右栏「游戏」策划操作台（试玩调参、外观编辑、分章节策划、版本与回滚）、每轮结束自动检查 |
| 本地 Agent 核（`@khorsheed/dsh-local-agent`） | 本地 CLI 智能体家族核心：每家 CLI 一份隔离目录、登录命令与设置卡片 |
| Kimi（`@khorsheed/dsh-local-agent-kimi`） | 把任务委派给本机的 Kimi Code CLI |
| Codex（`@khorsheed/dsh-local-agent-codex`） | 把任务委派给本机的 Codex CLI |
| Claude Code（`@khorsheed/dsh-local-agent-claude-code`） | 把任务委派给本机的 Claude Code |
| dsh 委派（`@khorsheed/dsh-local-agent-dsh`） | 把任务委派给一个隔离的无头 dsh（设置里打开，默认关） |
| 协作间（`@khorsheed/dsh-room`） | 把会话升级为有协调者和成员的协作空间，成员取自本地 agent 与 dsh 原生子成员 |

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-gamedev-suite`（或从市场索引里选它），确认后重启实例——装这一个，成员随依赖一起到达，模式与成员由本包统一挂载。随后在会话的模式选择器里切到「游戏开发模式」。

命令行等价：

```sh
dsh plugin --profile web add @khorsheed/dsh-gamedev-suite
```

<!-- collection:start -->
推荐连同基础体验一起装(「游戏开发」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-gamedev-suite
```

卸载即整族移除（含游戏开发模式）；想保留成员、只关某一个，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.2.0-rc.1`）：✅ 完整——纯组合，地板即成员自身（minHost `0.2.0-rc.1`，game 的地板）。成员行为细节见其自己的 Compatibility 节。
- 源码线（deepseek-harness master）：✅ 完整（verifiedHost: 0.2.1-rc.1）。

**版本线对照**：`0.1.0` 起要求宿主 `0.2.0-rc.1` 及以后。

## 已知限制

- **画面全靠代码画**——宿主没有文生图，美术风格只在能用代码画好的范围里挑；游戏运行在沙箱里，代码和资源都得放在项目里。
- **还不能分享给别人玩**——导出单文件、发布到外部平台是后续的事。
- **检查要本机 Chrome**——自动检查用本机 Chrome 无头加载游戏。
- **CLI 本体要自己装**——委派用的各家 CLI 需在 `PATH` 上自行安装并登录；本包不代装、不代登录。
- **卸载是整族的**——remove 本包会把成员一起移除；想只关某一个，用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模式包 = 家族整合包 + 一行模式 preset。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的成员行逐字来自成员包自己的 `cordis.patch.yml`（`game-agent` 伴生组合行不进 patch，只活在 preset 组合里）；末尾一行 `preset-dsh-gamedev`（`@deepseek-ai/dsh-agent-preset` 声明，模式 id `dsh-gamedev`）是本包自有的正本——它曾镜像自 `@khorsheed/dsh-presets`，该包已于 2026-10-24 退役。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状：行只允许落在「成员规范行全集 − 伴生组合行 + 恰好一行 preset-<mode>」内，被减去的伴生行必须由本包 preset 组合点名授予，成员必须是真实自挂载包，每个成员至少贡献一行，mode 值全树唯一。

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-game` | `game`；`game-agent`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`；`tool-subagent-kimi`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`（+ override `tool-subagent-codex`）；`tool-subagent-codex-local`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`（+ override `tool-subagent-claude-code`）；`tool-subagent-claude-code-local`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |
| `@khorsheed/dsh-room` | `room`；`room-tool`（由本包 preset 授予） |

**模型工具按会话授予。** 游戏开发模式 = 游戏开发者兼策划导师人格加游戏工作台。游戏工具（`game_open` / `game_read` / `game_propose` / `game_publish`）与游戏技能（game `./agent` 入口）不在 profile 根挂行，由本包 preset 行的 `game-agent` 授予点按会话授予；成员单装时其自有 patch 会让该入口全局可用，宿主 0.2.x 下本模式会话见 scoped 副本遮蔽全局行，不再双注册崩 boot（宿主 scoped.spec.ts 钉死）。委派工具与 `room-tool` 同理按会话授予；两条 bare override 停用官方 preset 里与本家族同名的工具行（`subagent_codex` / `subagent_claude_code`），逐字取自 codex / claude-code provider 自己的 patch。

**无卡库。** `@khorsheed/dsh-local-agent-dsh-headless` 进 `dependencies` 不进 patch 行，清单页不出现，随家族存亡。

**装我 = 装成员 + 一个模式，不双挂。** 成员列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员自己的 patch 不被应用，任何一行都不会挂两次。成员单独安装仍自挂载；重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/gamedev`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
