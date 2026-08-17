# 🐳 dsh 社区插件整合包

> 14 个纯增量插件，一个命令一个装，官方界面零改动。全部走官方扩展点接入，卸载即还原。

这是一份面向社区的整合包说明：把 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) 仓库里目前全部 14 个插件按家族汇总，讲清楚每个插件能做什么、怎么装、有什么需要注意的。所有包以 `@khorsheed/dsh-*` 发布到 npm，本文档与仓库保持同步。

## 设计原则

整套插件遵守同一条纪律，这也是你可以放心装的原因：

- **纯增量，零补丁** —— 不修改任何官方包、不替换官方 UI 槽位、不 hack 核心服务；全部通过官方扩展点（slots、commands、Remote 服务、会话镜像）接入。
- **独立可装可卸** —— 每个包可单独安装、单独卸载，卸载后界面精确还原，无残留。
- **降级不爆炸** —— 探测不到可选宿主能力时静默降级，绝不把整个 boot 打挂。
- **对模型几乎零影响** —— 绝大多数插件不触碰模型请求；唯一影响模型上下文的 message-tools 用的是与官方 compaction 相同的机制（见下文）。

## 全家桶速览

| 包名（npm） | 家族 | 一句话特性 | 版本线 |
| --- | --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | 对话控制 | 用户消息**编辑与撤回**（真撤回：surface 替换隐藏区间）+ 区间**恢复重放** | 0.4.9 |
| `@khorsheed/dsh-message-timeline` | 对话控制 | 会话左缘悬浮**历史消息时间轴**，点击跳转任意用户消息 | 0.1.0-rc.6 |
| `@khorsheed/dsh-client-session-title-edit` | 对话控制 | 聊天区标题**内联编辑重命名**会话 | 0.1.0-rc.6 |
| `@khorsheed/dsh-file-preview` | 文件预览 | 宿主侧只读**文件预览 Remote 服务**（列表 + 内容 + diff） | 0.1.0-rc.5 |
| `@khorsheed/dsh-client-ui-file-preview` | 文件预览 | 会话「产物」tab、回合变更卡片、文件预览抽屉（依赖上一行） | 0.1.0-rc.5 |
| `@khorsheed/dsh-local-agent` | 本地 Agent | 本地编码 Agent 家族**核心**：作用域 home、登录/会话命令族、委派 registry | 0.1.0-rc.7 |
| `@khorsheed/dsh-local-agent-kimi` | 本地 Agent | **Kimi Code** harness：`kimi -p` 委派、续聊、记账 | 0.1.0-rc.7 |
| `@khorsheed/dsh-local-agent-codex` | 本地 Agent | **Codex** harness：`codex exec` 委派、续聊、记账 | 0.1.0-rc.7 |
| `@khorsheed/dsh-local-agent-claude-code` | 本地 Agent | **Claude Code** harness：`claude -p` 委派、续聊、记账 | 0.1.0-rc.5 |
| `@khorsheed/dsh-local-agent-tool-subagent` | 本地 Agent | 家族自有委派工具（带 `resume` 续聊参数），随 harness 自动挂载 | 0.1.0-rc.7 |
| `@khorsheed/dsh-taskpilot` | 任务监控 | 聊天框上方**后台任务/子 Agent 胶囊**，详情抽屉 + 轨迹回放 | 0.1.0-rc.6 |
| `@khorsheed/dsh-whalesong` | 状态氛围 | 任务运行时鲸鱼喷水、favicon 动画、完成/阻塞提示音 | 0.1.0-rc.5 |
| `@khorsheed/dsh-ui-shortcuts` | 效率工具 | 可自定义键位的**快捷键**：暂停、插队发送、新建会话 | 0.1.0-rc.5 |
| `@khorsheed/dsh-ankh-guard` | 运维守护 | 自修改重启的**安全门禁**：绿色凭证 + preflight + watchdog 回滚 | 0.1.0-rc.6.6 |

> 版本为仓库内当前发布线；以 npm 上实际发布的版本为准。

---

## 一、对话控制

### `dsh-client-message-tools` —— 消息编辑 / 撤回 / 恢复

让 dsh 的用户消息真正可编辑、可撤回：

- **编辑**：原位替换——host 追加 replacement，模型在**原位置**读到编辑后的新文本，旧内容及之后的一切从模型上下文消失；编辑框带真实的模型 chip（与 composer 共享同一 `ModelDirectory`），可形成编辑链。
- **撤回是真撤回，不是打标记**：用与官方 compaction 同一套 surface replacement 机制，把目标消息及之后的所有内容从 `session.surface` 移出，不再进入模型上下文；每条撤回投影为可展开的「已撤回 N 条消息」分隔线。
- **恢复**：沿撤回区间的权威边界（`sourceEventSeqs`）把用户消息与助手文本按原始顺序**尾部重放**（工具调用/结果永不重放），渲染为「已恢复」组。
- 撤回成功自动把原文回填到 composer 草稿（绝不自动发送）。
- 仍在排队的消息沿用官方队列条带的编辑/移除，不在本插件范围。
- **模型影响**（全家桶里唯一显著的一个）：一次撤回/编辑会把遮蔽区间的全部 token 从后续请求移除；KV 缓存前缀从替换点失效——与官方 compaction 同样的取舍，撤回越早的消息失效缓存越多。

### `dsh-message-timeline` —— 历史消息时间轴

- 一条平铺在会话滚动区左缘的悬浮时间轴，一行一条已加载用户消息（含回合中插入的 steering 消息，可配置）。
- 静止时只显示压淡刻度，像环境标记；悬停/键盘聚焦展开文字；点击跳转到对应消息。
- 跟随阅读位置、顶部翻页加载更早历史、面板宽度可配置；`enabled` 可整体关闭。
- 纯读取会话快照，零事件、零提示词，对模型与 KV 缓存完全无影响。

### `dsh-client-session-title-edit` —— 会话标题编辑

- 聊天区标题右侧铅笔控件 → 原位内联编辑：Enter 提交、Escape 取消。
- 走官方 `session.rename` RPC，用户来源标题会被**钉住**，不再被自动生成覆盖。
- 无需宿主半边、零新增 RPC；对模型零影响（标题是纯投影属性）。

---

## 二、文件与产物

### `dsh-file-preview`（宿主服务）+ `dsh-client-ui-file-preview`（界面）

一对核心/伴生插件：前者是宿主侧只读服务，后者是浏览器侧界面，两者独立分发、组合即用。

- **「产物」tab**：与「对话」「轨迹」并列的会话视图，列出会话写入/编辑过的文件（含嵌套 Code Mode 派发），按最近活动倒序。
- **内联预览**：点文件即看当前内容，无需打开 IDE；图片直接内联渲染；预览区带内容搜索（高亮 + 逐个跳转）。
- **改动记录**：逐条步进查看每次 write/edit 的 diff（每条带所属轮次/步骤）。
- **回合变更卡片**：每个已完成回合末尾出现「N 个文件已修改」汇总卡（可整体收起，超限折叠为「展开其余 N 个」）。
- **文件抽屉**：点击正文官方 mention 或变更卡片中的文件，打开仅内容的抽屉；宿主支持时提供「在文件夹中打开 / 在 IDE 打开」。
- 只读、仅当前会话；对模型零影响。
- 界面包探测不到宿主服务时自动降级（只装 UI 包也能正常 boot）。

---

## 三、本地编码 Agent 家族

让 dsh 能把子任务委派给你本机装的编码 Agent CLI——Kimi Code、Codex、Claude Code——各自独立上下文、独立记账，还能跨轮续聊。

### 架构

- **`dsh-local-agent`（家族核心）**：注册表 + 作用域目录。每个 harness 在自己独立的 scoped home 下运行（`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`），**绝不触碰你用户目录里的私人配置与凭据**；提供 `/<harness> login|sessions|status|logout` 命令族；浏览器端自带「设置 → 本地 Agent」分区（roster 驱动：认证状态、网页登录、退出登录、委派 preset）。
- **三个 harness 包**：`dsh-local-agent-kimi` / `dsh-local-agent-codex` / `dsh-local-agent-claude-code`。每个把一次性委派工具挂到 profile 根，任意 agent preset 都能委派，无需逐 preset 变体。
- **`dsh-local-agent-tool-subagent`（家族自有工具）**：官方 `subagent_*` 工具的超集，加一个可选 `resume` 参数——续聊句柄**绝不进 prompt**，只从参数读取并经 registry 按（parent, provider）校验，伪造句柄在任何 CLI 进程启动前就被拒绝。

### 核心能力

- **作用域隔离**：登录（device-code / 浏览器 OAuth）与委派进程都在 scoped home 里跑；卸载后保留目录，重装无需重新登录；删目录即清全部痕迹。
- **委派**：`subagent_kimi`（`kimi -p`）、`subagent_codex_local`（`codex exec`）、`subagent_claude_code_local`（`claude -p --output-format json`）。父级只看到最终回答或精确错误；子会话独立上下文、独立 token、独立 KV 缓存，永不进父级。
- **续聊（resume）**：首次委派结果自述句柄，下轮把 `resume="<childSessionId>"` 传回，就在**同一个** dsh 子会话里继续**同一个** CLI 会话，并按轮记账（轮次递增、turn 成对、usage 挂当轮）。
- **委派记账**：真实用量与耗时——`turn/start` 开、`turn/end` 关（失败/取消也关），token 按各 CLI 口径正确分桶（kimi 四桶求和、codex 去重缓存命中、claude 各桶独立），子代理时长 = 实际 CLI 运行时长。
- **会话记录**：`/kimi sessions` / `/codex sessions` / `/claude-code sessions` 列出本 agent 委派产生的会话（`session_index.jsonl` / rollout / project 会话文件）；设置分区按当前工作区收窄展示。
- **自定义端点**：三个 harness 都支持把 LLM 请求路由到自托管端点（kimi `base_url`、codex 自定义 provider、claude `ANTHROPIC_BASE_URL`）——⚠️ OAuth token 会发送给该端点，只指向你信任的地址。

### 安装注意

**核心 + harness 要显式一起装**（`dsh plugin add` 只把直接依赖调和进 bundles 层，传递依赖不会激活核心行）：

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi     # 或 -codex / -claude-code
```

前置：对应 CLI 已在 `PATH`（kimi / codex / claude）；装完重启，跑一次 `/<name> login`。

---

## 四、任务与子 Agent 监控

### `dsh-taskpilot` —— 后台任务 / 子 Agent 胶囊

- 聊天框上方两个**胶囊入口**：「后台任务」「子 Agent」，各自独立显隐（无数据不出现）。
- **任务胶囊**：当前会话全部后台任务，运行中在前、每秒计时、带停止按钮；点击行开详情抽屉。
- **子 Agent 胶囊**：当前会话的**完整子 Agent 谱系**（直接子 + 深层后代），展示运行时间与消耗 token，运行中带中断按钮（深层中断授权给其直接父），点击跳转子会话。
- **详情抽屉**：任务命令/类型/状态/起止时间/耗时 + 从会话日志回放的**执行轨迹**（启动、每次 `job_output` 增量、停止、完成；默认折叠）。
- 数据全部来自产品已有镜像（与标题旁列表同源），停止/中断注册在官方 `commands` 扩展点；对模型零影响。

---

## 五、状态氛围

### `dsh-whalesong` —— 任务跑着，鲸鱼喷水

- **favicon 水线气泡**：任一会话运行期间，标签页图标变成鲸鱼 + 三颗上升气泡（SVG 帧）；空闲时保持一只按页面主题着色的静态鲸鱼。
- **侧栏水滴**：三颗 DeepSeek 蓝水滴从侧栏鲸鱼喷气孔上升。
- **提示音**：完成 = 三连上升滑音；阻塞 = 上扬重复两次（WebAudio 合成，无音频资源文件）。
- 配置热生效（`enabled` / `volume`），`prefers-reduced-motion` 下动画与提示音自动静音；只读会话列表，对模型零影响。

---

## 六、效率工具

### `dsh-ui-shortcuts` —— 可自定义键位的快捷键

- 三个固定动作、键位用户自选：**暂停当前任务**（默认 `Esc`）、**插队发送草稿**（默认 `Ctrl/Cmd+S`）、**新建会话**（默认 `Ctrl/Cmd+O`）。
- 设置 → 通用 → 快捷键中重绑/解绑/恢复默认；偏好持久化在 `$DSH_HOME/settings.yaml`。
- 附带 `ctx.shortcuts` **动作注册表**：任何插件可以注册自己的键盘动作，免费获得设置项、重绑、持久化、无冲突分发。
- 全部走公开服务（`conversation.cancel` / `conversation.input.submit` / `workspaces.startSession()`），对模型零影响。
- ⚠️ **与官方包冲突**：本包与官方 `@deepseek-ai/dsh-client-ui-shortcuts` 的 loader entry id 都是 `ui-shortcuts`，同一 profile 装两个会在启动时 fail loud——只保留其一。

---

## 七、运维守护

### `dsh-ankh-guard` —— 让 Agent 自己改代码、自己重启，还不把服务搞挂

面向「让 AI Agent 自主修改代码并重启服务」的自托管场景：

- **绿色凭证门禁**：构建与测试全绿后记录凭证（绑定 git commit、10 分钟有效窗口）；重启前查凭证存在、新鲜、HEAD 一致——改坏了构建就永远拿不到凭证，重启在造成伤害前被拒绝。
- **preflight 组合闸门**：凭证之后、停任何东西之前，在子进程对完全相同组合做深度干跑（整棵插件树真实 apply 再 dispose），组合起不来绝不停止运行中的实例。
- **watchdog 无感重启**：detached 监督进程，宿主死了自动拉起；连续起不来就回滚到最后已知可用版本（健康启动戳 → 检查点 → 凭证 HEAD），回滚前自动留 `guard-backup-*` 恢复锚点，不依赖 reflog。
- **崩溃页**：连续 4 次失败停在带重试按钮的崩溃页，等人工处理。
- **中断会话自动恢复**：SIGTERM 时快照在途回合，重启后自动拉起并排入「继续」followup；重启报告经 followup 自动送达模型。
- 六步自我重启协议：checkpoint → 修改 → build+test → record → verify → 重启+canary。
- 兼容性注意：npm 发布线上组合 preflight 门禁**降级**（依赖 fork 的 `dsh preflight` 命令），其余能力（restart/supervise 门禁、watchdog、回滚）全部完整。

---

## 安装指引

### 前置条件

- dsh 宿主 ≥ `0.1.0-rc.6`（13/14 个包声明的 `minHost`；家族工具 `local-agent-tool-subagent` 不单独声明，随家族使用），任意 profile（`web` / `headless` / 自定义）。
- 各包均声明 `dsh.bundle`：`dsh plugin add` 一条命令完成安装并自动挂载 loader 行，**无需手改 cordis.yml**。
- 按需：本地 Agent 家族需要 `PATH` 上有对应 CLI；ankh-guard 需要 `node` + `bash`（macOS/Linux 上的 `lsof`）。
- 装完**重启 web 实例**生效。

### 全家桶一键安装

```sh
# 对话控制
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
dsh plugin --profile web add @khorsheed/dsh-message-timeline
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit

# 文件预览（服务 + 界面，推荐成对）
dsh plugin --profile web add @khorsheed/dsh-file-preview
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview

# 本地 Agent 家族（核心 + 你用的 harness，成对装）
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
# dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
# dsh plugin --profile web add @khorsheed/dsh-local-agent-claude-code

# 任务监控 / 氛围 / 快捷键
dsh plugin --profile web add @khorsheed/dsh-taskpilot
dsh plugin --profile web add @khorsheed/dsh-whalesong
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts

# 运维守护（自托管场景）
dsh plugin --profile web add @khorsheed/dsh-ankh-guard
```

### 卸载

```sh
dsh plugin --profile web remove @khorsheed/dsh-<name>
```

移除即注销对应行；local-agent 家族刻意保留作用域目录（会话与凭据），删除 `$DSH_HOME/local-agent/<name>` 目录即清全部痕迹。

### 推荐组合

| 场景 | 组合 |
| --- | --- |
| 日常轻装（推荐起步） | message-tools + message-timeline + session-title-edit + taskpilot + file-preview/ui-file-preview + whalesong + ui-shortcuts |
| 完整全家桶 | 上面全部 + local-agent 家族（本机已装对应 CLI） |
| 自托管 / 让 AI 自己改代码 | 全家桶 + ankh-guard |

## 兼容性

所有包声明 `minHost: 0.1.0-rc.6`，运行时只依赖官方公开稳定面（slots、核心服务、核心事件、cordis 4.x、schemastery）：

- npm 发布线：全部 ✅ **完整**，唯一例外是 `dsh-ankh-guard` ⚠️ **降级**（组合 preflight 门禁依赖 fork 的 `dsh preflight`，缺失时守护放行并提示，其余能力完整）。
- 源码线（deepseek-harness master）：全部 ✅。

## 模型影响总表

| 插件 | 模型上下文 | Token | KV 缓存 |
| --- | --- | --- | --- |
| message-tools（编辑/撤回） | 有——替换遮蔽区间 | 移除区间 token，新增少量占位 | 前缀从替换点失效（同官方 compaction） |
| message-tools（恢复） | 有——尾部重放 | 新增可重放 token | 仅尾部延展，不改写 |
| 其余全部插件 | 无 | 无 | 无 |
| local-agent 委派（子会话） | 独立子上下文 | 子会话独立付费，不进父级 | 与父级相互独立 |

## 一起维护

仓库：[github.com/Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) —— 所有包在同一个 monorepo 里开发、测试、发布（`@khorsheed/dsh-*`）。欢迎提 issue、PR；每个包自带中英双语文档与测试，改动走仓库 AGENTS.md 的构建/发布纪律。
