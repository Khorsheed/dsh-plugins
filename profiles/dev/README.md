# dsh-dev

中文 | [English](README.en.md)

**调度一组 agent 写代码，并看清他们改了什么。** 把任务派给你本机装的 Kimi Code、Codex、Claude Code 或 dsh 自己，各自独立上下文与记账；改动落在哪个分支、动了哪些文件、每次提交做了什么，都在会话里一眼可见；多个 agent 可以在同一个会话里协作。基础体验（消息编辑、产物预览、任务胶囊等）全部内含。

每个成员都是独立插件，复制包名到宿主的「添加插件」对话框（0.1.7-rc.2 起：设置 → 插件）即可自由安装；后续如果官方开放自定义 profile 安装，本仓库会支持一行命令直接安装。本地 Agent 家族也可以装元包 `@khorsheed/dsh-bundle-local-agent` 一次装齐（见[功能展示](#功能展示)末尾）。

## dev 整合包 - 插件列表

与 [dsh-basic](https://github.com/Khorsheed/dsh-basic) 共享的 13 个成员（消息编辑/撤回、时间轴、标题编辑、引用、产物预览、任务胶囊、压缩提醒、内联卡片、能力目录、快捷键、提示音、移动端、运维守护），逐插件介绍与截图见 basic 的插件列表。本包独有 10 个：

| 插件 | 包名（复制即可安装） | 你得到 |
|---|---|---|
| local-agent | `@khorsheed/dsh-local-agent` | 本地编码 agent 家族核心：作用域 home、登录/会话命令族、委派 registry |
| local-agent-kimi | `@khorsheed/dsh-local-agent-kimi` | Kimi Code 委派（`kimi -p`）、续聊、记账 |
| local-agent-codex | `@khorsheed/dsh-local-agent-codex` | Codex 委派（`codex exec`）、续聊、记账 |
| local-agent-claude-code | `@khorsheed/dsh-local-agent-claude-code` | Claude Code 委派（`claude -p`）、续聊、记账 |
| local-agent-dsh | `@khorsheed/dsh-local-agent-dsh` | dsh 自委派：把 dsh 自己当本地 CLI 用 |
| local-agent-tool-subagent | `@khorsheed/dsh-local-agent-tool-subagent` | 家族共享委派工具行（带 `resume` 续聊参数，随 provider 挂载） |
| worktrees | `@khorsheed/dsh-worktrees` | 会话头部 repo/worktree 徽标 + 改动抽屉（只读 git 事实）；模型工具随 `@khorsheed/dsh-worktrees/tool` 子路径行由开发模式 preset 按会话授予 |
| room | `@khorsheed/dsh-room` | 多 agent 同会话协作：成员名册、@ 派发、任务板 |
| room-tool | `@khorsheed/dsh-room-tool` | `room_invite / room_task / room_message`，随 preset 按会话授予 |
| local-files | `@khorsheed/dsh-local-files` | 右栏本地文件浏览器：懒加载树 + 结构化预览 |

### 版本兼容

整合包整体要求宿主 ≥ `0.1.5-rc.1`（多数成员的地板；basic 共享成员里 floor 更低的六个在 0.1.2 线宿主上也能单装）。local-agent 家族以 `0.1.0-rc` 预发布线发布，对话框填裸包名即得最新。各成员逐宿主线的矩阵见 [dsh-plugins 的发布状态](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/release-status.md)。

## 功能展示

### 本地 Agent 家族（6 个包）：把任务派给别的编码 agent

| 装法 | 安装规格（复制到对话框） |
|---|---|
| 整族一次装齐（推荐） | `@khorsheed/dsh-bundle-local-agent` |
| 单装：核心 + 任选 provider | `@khorsheed/dsh-local-agent` + `@khorsheed/dsh-local-agent-kimi`（或 `-codex` / `-claude-code` / `-dsh`） |

把子任务委派给你本机装的编码 Agent CLI——Kimi Code、Codex、Claude Code、以及 dsh 自己。每个 harness 在自己独立的作用域目录下运行（`$DSH_HOME/local-agent/<name>`，0700 权限），**绝不触碰你用户目录里的私人配置与凭据**。

- **独立上下文与记账**：子会话独立 token、独立 KV 缓存，永不进父级；每次委派按真实用量分桶记账。
- **跨轮续聊**：把子会话 id 传回即可在同一个 CLI 会话里继续。
- **常驻模式**：输出实时流入成员会话、取消不杀进程、崩溃自动续会话。
- **成员双向通道**：打开成员子会话即可直接对它续一轮；成员之间也能互相通知。

<img src="docs/screenshots/local-agent-delegation.png" width="840" alt="本地 Agent 家族:设置页的 provider 卡片,认证状态一眼可见">

<img src="docs/screenshots/local-agent-member.png" width="840" alt="成员双向通道:打开成员子会话直接续聊">

### worktrees（1 个包）：git 状态实况

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-worktrees`（模型工具行是包内 `./tool` 子路径入口，随开发模式 preset 生效，无需单装） |

每个会话右上角一个 repo/worktree 徽标，显示当前仓库、分支与合并 diff 行数（绿 = 无改动，黄 = 有改动）。点开是改动抽屉：未提交/已提交文件树 + diff、IDE 风格提交记录、仓库全量文件浏览。只读展示 git 事实，不写仓库。

<img src="docs/screenshots/worktrees-drawer.png" width="840" alt="worktrees:会话头部徽标与改动抽屉">

### room（2 个包）：多 agent 在同一个会话里协作

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-room`（模型工具行 `@khorsheed/dsh-room-tool` 随 preset 生效，无需单装） |

在任意会话里邀请一个 agent，这个会话就成为 room：成员 tab、@ 分发、多成员胶囊、任务板、通知闸门。成员之间可以互相召唤，进度在同一条会话线上可见。

<img src="docs/screenshots/room-members.png" width="840" alt="room:成员名册 tab,协调者与成员卡片">

### 打包装：bundle-local-agent（本地多 Agent 一次装齐）

| 宿主版本 | 安装规格（复制到对话框） |
|---|---|
| ≥ `0.1.5-rc.1` | `@khorsheed/dsh-bundle-local-agent` |

一个元包装齐 local-agent 核心 + kimi / codex / claude-code / dsh 四个 provider：成员作为 npm 依赖自动带入，元包的 patch 逐字重挂各成员的规范行；装完后每个组件在 设置 → 插件 里仍可单独禁用——打包的是安装，不是绑定。

<details>
<summary>展开查看功能示意（1 张）</summary>

<img src="docs/screenshots/bundle-local-agent.png" width="840" alt="bundle-local-agent:详情页逐行列出核心与四家委派,各自可独立开关">

</details>

## 自带 Agent 预设：开发模式（dev）

pack 自带一个**开发模式** preset（`presets/dev`，官方「标准模式」组合为底）：外加三家 local-agent 委派工具（`subagent_kimi` / `subagent_codex` / `subagent_claude_code`）、worktrees 模型工具与 room 工具三件套（`room_invite` / `room_task` / `room_message`），全部**按会话授予**——工具行只在本 preset 的组合里，不进 profile 根。`install.sh` / `update.sh` 把它卸进 `$DSH_HOME/.agent-presets/dev`（整体替换——它是 pack 装置，不是个人偏好；同名自建会被覆盖，自己的预设请用别的 id）。建会话时在 preset chip 选「开发模式」即可；默认 preset 仍是「标准模式」，要改默认在**设置 → Agent 预设**里选（patch 层是你的，pack 不钉）。mission / datasets / eval 的伴生工具行**刻意不在这里**：三个 core 不在本 pack 的成员清单里（孵化中），而伴生包运行时要 import core 的 `./tool` 工厂，缺行会让整个 dev preset 报 broken——等它们上架、并加进 `profiles/dev/package.json` 之后再补（见 CHANGELOG）。

## 自定义 Agent 预设

本 profile 使用官方「标准模式」。要做自己的预设：**设置 → Agent 预设** → 复制一份内置预设改，或点底部「用『创造模式』创作自定义预设」让 Agent 帮你做。自建的预设存在 `$DSH_HOME/.agent-presets/`，与本 profile 的更新互不影响。

## 更新

成员清单变化后（新增或移除插件），拉最新再跑一次 update：

```sh
cd dsh-dev && git pull
sh scripts/update.sh
sh scripts/restart-into-dev.sh
```

`update.sh` 只覆盖 `package.json` 与 lockfile，**不动你的 `cordis.patch.yml`**——那一层的改动是你的。

## 切换模式

```sh
sh scripts/restart-into-dev.sh          # 切到本 profile，默认 3080
sh scripts/restart-into-dev.sh 3090     # 指定端口
```

切回其它 profile，用它自己仓库里的同名脚本。切换是同端口交接，浏览器刷新原地址即可。

同时装多个 profile：各自 clone、各自 `install.sh`，互不干扰；**用各自的 restart 脚本在同一端口切换**，不用记端口。装了多个时，成员更新要在每个 profile 各跑一次 `update.sh`。

会话数据在 `$DSH_HOME/sessions/`、凭据与快捷键在 `$DSH_HOME` 下，**所有 profile 共享**——在一个 profile 里登录过 Kimi，切到另一个不用再登。

> 不建议在同一个 `$DSH_HOME` 上并行跑两个实例：会话数据共享且跨进程无写保护。需要长期隔离的实例（例如评测）请给它独立的 `$DSH_HOME`。

## 其他整合包

| 整合包 | 定位 |
|---|---|
| [dsh-basic](https://github.com/Khorsheed/dsh-basic) | 日常模式：只含基础体验，不带开发能力 |
| [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) | 插件 monorepo 主仓：全部插件的能力地图、preset 设计与开发文档 |

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 卸载整个 profile

```sh
rm -rf "$DSH_HOME/profiles/dev"
```

会话数据在 `$DSH_HOME/sessions/`，不随 profile 删除。

## 给 Agent 的安装指南

<details>
<summary><strong>展开：整合包整体安装 + 单包命令行安装</strong>（用户说"帮我装一下"时照此执行；没有 agent 的用户也可以照着手动跑）</summary>

### 一、整体安装整合包

整合包整体安装要求宿主 ≥ `0.1.5-rc.1`。

**一、安装与离线自检（不碰运行中的实例）**

```sh
git clone https://github.com/Khorsheed/dsh-dev.git /tmp/dsh-dev
sh /tmp/dsh-dev/scripts/install.sh
```

`install.sh` 末尾会打印组合的行数。如需手动复核：`dsh --profile dev --dump-config | grep -c "@khorsheed"` 应为 23（成员清单见上方「插件列表」）。`dsh` 不在 PATH 时用它的完整路径（可用 `ps` 查当前实例的启动命令获得）。

**二、同端口交接（关键一步）**

```sh
sh /tmp/dsh-dev/scripts/restart-into-dev.sh [端口，默认 3080]
```

脚本走 ankh-guard 守卫通道：环境探针 → 记录凭证 → preflight → watchdog 停旧启新 + canary 验证。**你会随宿主实例一起断开，这是预期**——watchdog 会在原端口拉起 dev；脚本刻意不传 `--initiator`，守卫会从你的环境读取 `$DSH_SESSION_ID`，重启报告才能寻址到你的会话：用户重新打开这个会话时，你会收到「重启完成」的 followup 并继续。

**三、告诉用户硬刷页面**

客户端 bundle 变了，浏览器需要 Cmd/Ctrl+Shift+R 强制刷新。

### 二、安装单个插件

- **对话框（0.1.7-rc.2 起，推荐）**：设置 → 插件 → 添加插件，填包名，按提示启用。
- **命令行**：`dsh plugin --profile <profile> add <包名>`；卸载 `remove`，更新 `update`。
- **打包装**：本地 Agent 家族用元包 `dsh plugin --profile <profile> add @khorsheed/dsh-bundle-local-agent` 一次装齐，成员行仍可在 设置 → 插件 里单独禁用。

</details>
