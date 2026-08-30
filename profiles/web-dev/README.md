# dsh-web-dev

中文 | [English](README.en.md)

**调度一组 agent 写代码，并看清他们改了什么。** 把任务派给你本机装的 Kimi Code、Codex、Claude Code 或 dsh 自己，各自独立上下文与记账；改动落在哪个分支、动了哪些文件、每次提交做了什么，都在会话里一眼可见；多个 agent 可以在同一个会话里协作。基础体验（消息编辑、产物预览、任务胶囊等）全部内含。

<!-- screenshot placeholder: docs/screenshots/web-dev-overview.png (pending) -->

> **状态**：pre-release。21 个成员里有 13 个尚未上架 npm，当前需从 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) 源码构建安装（见[安装](#安装)）。

## 安装

**有 Agent（推荐）**：装好 [dsh](https://github.com/deepseek-ai/deepseek-harness) 后，对你的 Agent 说一句：

> **帮我装一下这个：https://github.com/Khorsheed/dsh-web-dev**

它会照「给 Agent 的安装指南」完成安装、自检，并把当前实例在同端口交接给本 profile——你只需要在结束后硬刷页面（Cmd/Ctrl+Shift+R）。

**手动安装**：

```sh
git clone https://github.com/Khorsheed/dsh-web-dev.git
sh dsh-web-dev/scripts/install.sh              # 把 profile 拷进 $DSH_HOME 并安装
sh dsh-web-dev/scripts/restart-into-web-dev.sh  # 当前实例同端口交接给本 profile
```

<details>
<summary><strong>给 Agent 的安装指南</strong>（用户说"帮我装一下"时，照此执行）</summary>

按下面三段做，全程不需要浏览器级验证。

**一、安装与离线自检（不碰运行中的实例）**

```sh
git clone https://github.com/Khorsheed/dsh-web-dev.git /tmp/dsh-web-dev
sh /tmp/dsh-web-dev/scripts/install.sh
```

`install.sh` 末尾会打印组合的行数。如需手动复核：`dsh --profile web-dev --dump-config | grep -c "@khorsheed"` 应为 21。`dsh` 不在 PATH 时用它的完整路径（可用 `ps` 查当前实例的启动命令获得）。

**二、同端口交接（关键一步）**

```sh
sh /tmp/dsh-web-dev/scripts/restart-into-web-dev.sh [端口，默认 3080]
```

脚本走 ankh-guard 守卫通道：环境探针 → 记录凭证 → preflight → watchdog 停旧启新 + canary 验证。**你会随宿主实例一起断开，这是预期**——watchdog 会在原端口拉起 web-dev；脚本刻意不传 `--initiator`，守卫会从你的环境读取 `$DSH_SESSION_ID`，重启报告才能寻址到你的会话：用户重新打开这个会话时，你会收到「重启完成」的 followup 并继续。

**三、告诉用户硬刷页面**

客户端 bundle 变了，浏览器需要 Cmd/Ctrl+Shift+R 强制刷新。

</details>

## 更新

成员清单变化后（新增或移除插件），拉最新再跑一次 update：

```sh
cd dsh-web-dev && git pull
sh scripts/update.sh
sh scripts/restart-into-web-dev.sh
```

`update.sh` 只覆盖 `package.json` 与 lockfile，**不动你的 `cordis.patch.yml`**——那一层的改动是你的。

## 切换模式

```sh
sh scripts/restart-into-web-dev.sh          # 切到本 profile，默认 3080
sh scripts/restart-into-web-dev.sh 3090     # 指定端口
```

切回其它 profile，用它自己仓库里的同名脚本。切换是同端口交接，浏览器刷新原地址即可。

同时装多个 profile：各自 clone、各自 `install.sh`，互不干扰；**用各自的 restart 脚本在同一端口切换**，不用记端口。装了多个时，成员更新要在每个 profile 各跑一次 `update.sh`。

会话数据在 `$DSH_HOME/sessions/`、凭据与快捷键在 `$DSH_HOME` 下，**所有 profile 共享**——在一个 profile 里登录过 Kimi，切到另一个不用再登。

> 不建议在同一个 `$DSH_HOME` 上并行跑两个实例：会话数据共享且跨进程无写保护。需要长期隔离的实例（例如评测）请给它独立的 `$DSH_HOME`。

## 包含什么

21 个成员，三层：

**基础体验**（与 dsh-web-basic 相同的 12 个）：消息编辑/撤回/恢复、历史消息时间轴、会话标题内联编辑、文件预览（服务 + 界面）、本地文件浏览器、后台任务胶囊、上下文压缩提醒、内联 HTML 卡片、能力目录、快捷键、任务氛围。逐个介绍见[基础成员说明](https://github.com/Khorsheed/dsh-web-basic#功能展示)。

**开发能力**（本 profile 独有的 8 个）：见下方[功能展示](#功能展示)。

**运维守护**：`ankh-guard` —— 同端口交接与自修改重启的安全门禁，上面的切换脚本就走它。

## 功能展示

### 本地 Agent 家族：把任务派给别的编码 agent

把子任务委派给你本机装的编码 Agent CLI——Kimi Code、Codex、Claude Code、以及 dsh 自己。每个 harness 在自己独立的作用域目录下运行（`$DSH_HOME/local-agent/<name>`，0700 权限），**绝不触碰你用户目录里的私人配置与凭据**。

- **独立上下文与记账**：子会话独立 token、独立 KV 缓存，永不进父级；每次委派按真实用量分桶记账。
- **跨轮续聊**：把子会话 id 传回即可在同一个 CLI 会话里继续。
- **常驻模式**：输出实时流入成员会话、取消不杀进程、崩溃自动续会话。
- **成员双向通道**：打开成员子会话即可直接对它续一轮；成员之间也能互相通知。

<!-- screenshot placeholder: docs/screenshots/local-agent-delegation.png (pending) -->

### worktrees：git 状态实况

每个会话右上角一个 repo/worktree 徽标，显示当前仓库、分支与合并 diff 行数（绿 = 无改动，黄 = 有改动）。点开是改动抽屉：未提交/已提交文件树 + diff、IDE 风格提交记录、仓库全量文件浏览。只读展示 git 事实，不写仓库。

<!-- screenshot placeholder: docs/screenshots/worktrees-drawer.png (pending) -->

### room：多 agent 在同一个会话里协作

在任意会话里邀请一个 agent，这个会话就成为 room：成员 tab、@ 分发、多成员胶囊、任务板、通知闸门。成员之间可以互相召唤，进度在同一条会话线上可见。

<!-- screenshot placeholder: docs/screenshots/room-members.png (pending) -->

## 装卸单个成员

```sh
dsh --profile web-dev plugin rm  @khorsheed/dsh-whalesong   # 卸载
dsh --profile web-dev plugin add @khorsheed/dsh-whalesong   # 装回来
sh scripts/restart-into-web-dev.sh                          # 重启生效
```

## 自定义 Agent 预设

本 profile 使用官方「标准模式」。要做自己的预设：**设置 → Agent 预设** → 复制一份内置预设改，或点底部「用『创造模式』创作自定义预设」让 Agent 帮你做。自建的预设存在 `$DSH_HOME/.agent-presets/`，与本 profile 的更新互不影响。

## 卸载整个 profile

```sh
rm -rf "$DSH_HOME/profiles/web-dev"
```

会话数据在 `$DSH_HOME/sessions/`，不随 profile 删除。

## 相关整合包

| 整合包 | 定位 |
|---|---|
| [dsh-web-basic](https://github.com/Khorsheed/dsh-web-basic) | 日常模式：只含基础体验，不带开发能力 |

## 许可

[MIT](LICENSE)
