# 工作模式切换（mode-switcher）

- **分类**：plugin
- **状态**：idea
- **最后更新**：2026-08-29
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——「模式 / 切换 / mode / preset」命中：[plugin-manager](2026-08-22-plugin-manager.md)（loader 级插件开关，profile 全局，非会话级）、worktree-governance 的「三档切换」、local-agent 的「驱动模式 live/exec」、官方 `agent-presets` 的 preset 选择器（本提案的底座，非竞品）。**无「按 domain 组织的工作模式选择」同意图提案。** 关联：[docs/roadmap.md](../../docs/roadmap.md) 的四层模型与决策 9（domain 在 profile 与 preset 两个平面落地）、[capability-catalog](2026-08-26-capability-catalog.md)（模式下工具与 skill 的展示面）、[package-management](2026-08-21-package-management.md)（domain 整合包携带 preset 目录）。
- **官方依赖**：纯插件。底座是官方 `@deepseek-ai/dsh-agent-presets`（`ctx.agentPresets`：roster、per-agent 挂载、copy-only authoring、`roots` 接受任意路径）；UI 走 `settings.section` 槽位与新建会话入口；快捷键复用本仓 `@khorsheed/dsh-ui-shortcuts` 的 `ctx.shortcuts.registerAction`。**零 harness 改动。**

需求来源：产品路线图评审（2026-08-28～29）。工作台要同时服务开发、评测、写作等不同 workflow，它们的工具、提示词、skill 与人格都不同。本提案是该模型在用户侧的入口。

> **重写说明**：本文件替换了同名的 2026-08-26 草稿。原草稿把「模式」建模为**一组插件行的活跃性**，用「写 profile 用户 patch 层 + config HMR 热切」实现。该路径在发现官方 `agent-presets` 之前成立，现予放弃——理由见「放弃的东西」，核心是 profile 级切换做不到「开发会话与评测会话同时开着」。

## 目标

让用户在**新建会话时选择工作模式**，会话即按该模式的组合运行：它的工具子集、prompt sections、skills 与 persona。模式与 [roadmap](../../docs/roadmap.md) 的 domain 一一对应（`daily` / `dev` / `eval` / …），一个 domain 可提供多个模式。

1. **入口**：新建会话处可见模式选择器，展示模式的显示名与描述（官方 roster 已提供这两个字段）。
2. **可见性**：当前会话属于哪个模式，在会话界面可见；模式下有哪些工具与 skill，经 `capability-catalog` 可查。
3. **不重启**：切换模式不重启实例、不重装插件——官方 preset 是 per-process standing scope 挂载，多个模式的组合可同时在场。
4. **降级**：未装本插件时，官方自带的 preset 选择行为逐字不变；roster 里某个模式 broken 时按官方语义列出原因，不隐藏。

非目标 / 明确不做：

- **不做会话内热切**。官方约束：会话只能在**零产出**时切 preset（`agent-presets` README：*a session can switch to a different preset only while it has produced nothing*），之后组合对会话终身固定。因此模式是新建会话时的选择，不是会话内的开关。
- **不做插件行开关**。那是 [plugin-manager](2026-08-22-plugin-manager.md) 的 loader 级能力，profile 全局、与会话无关，两者不是同一层。
- **不自己实现组合**。preset 的挂载、roster、健康检查全部是官方的；本插件只做入口与呈现。
- **不做跨模式委派**。子 agent 继承父会话的组合（官方语义），所以 dev 会话的子任务不会以别的模式运行。

## 现状（官方契约实测 / 已有实现）

`@deepseek-ai/dsh-agent-presets`（0.1.2-alpha.1 实测）：

| 事实 | 对本提案的含义 |
|---|---|
| preset = 一个目录，含单份 `agent.cordis.yml`，命名该会话运行的插件行 | 模式的载体已存在，无需自造数据模型 |
| 一个 session 得到该 preset 的 **tools、prompt sections、skills** | 模式的内容边界即此三样；浏览器 UI 插件不在其中（profile 级，所有模式共享） |
| `persona` 包提供可组合行，让 preset 改变 agent 身份 | 模式可带人格，不只是工具差异 |
| **One standing composition per preset**：每个 preset 每进程挂载一次，agent 以 scope key 认领 | 多模式可同时在场；切换不重启 |
| 切换只在会话零产出时允许，提交后发 `tools/change` | 入口必须落在「新建会话」，见非目标 |
| 子 agent 加入父级组合 | 委派继承模式，跨模式委派不可达 |
| roster 来源：包内 `presets/` + `<dshHome>/.agent-presets` + 配置的 `roots`（任意路径，`trust` 可选） | **domain 整合包可自带 `presets/` 目录并用 `roots` 指入，无需上游 seam** |
| authoring 是 copy-only：复制一个已有 preset 的整个目录 | 自建模式从复制官方 `standard` 起步 |
| 官方自带 `standard` / `minimal` / `ptc` / `cordis` 四个 | 均为编码 Agent 变体；`daily` 模式 = `standard` + 本仓自有的 agent 侧能力 |
| broken preset 列出原因而非隐藏；composing 被前置拒绝，会话不会半组合启动 | 降级语义由官方保证，本插件只需如实呈现 |

本仓已有：`capability-catalog` 按 **agent preset 的 standing scope** 读注册表，是「这个模式有哪些工具与 skill」的现成展示面。

## 方案

一个独立插件包 `@khorsheed/dsh-mode-switcher`（client 半为主，host 半仅在需要读 roster 时存在）。

### 1) 模式 = preset，不引入新数据模型

模式清单直接取自 `ctx.agentPresets` 的 roster，显示名与描述用官方字段。本插件**不持有模式定义文件**——没有 `definitions.yml`，没有 `active` 指针，没有 patch 层写入。这是与原草稿最大的差别：模式的事实源是 preset 目录本身。

domain 整合包（`dsh-dev` / `dsh-eval` …）在自己的 profile 模板里携带 `presets/<name>/`，并把 `agent-presets` 的 `roots` 指向它。装了哪些整合包，就有哪些模式可选。

### 2) 入口：新建会话处的模式选择器

新建会话流程里给出模式选择（默认取 `agent-presets` 的 `default`，即 `daily`）。选择器展示显示名 + 描述；broken 的模式照官方语义列出并标注原因，点击给出可操作的提示而非静默失败。

### 3) 当前模式的可见性

会话界面标示当前模式（轻量，不占据主要空间）。点击可跳转到 `capability-catalog` 的对应作用域，看这个模式实际有哪些工具与 skill。

### 4) 快捷键（可选）

经 `ctx.shortcuts.registerAction` 注册「以某模式新建会话」，键位用户可配。探测不到 `ui-shortcuts` 时静默降级。

## 里程碑

- **M1 选择器**：新建会话处的模式选择 + broken 态呈现 + 默认值取官方 `default`。
- **M2 可见性**：会话内当前模式标示 + 跳转 capability-catalog 对应作用域。
- **M3 快捷键**：以指定模式新建会话的可配键位。

## 验收标准（done 判定，绑定可插拔交付）

- 装齐两个以上 domain 整合包后，选择器列出全部模式，无一 broken；每个模式新建的会话工具集确实不同（对照 `capability-catalog`）。
- 切换模式不重启进程（pid 不变），已运行的会话不受影响（官方 generation 语义）。
- base 层 UI 在所有模式下一致可用——它们是 profile 级，不随模式变化。
- 未装本插件的环境，官方 preset 选择行为逐字不变；卸载后界面消失、无残留。
- 家族既有测试绿；hygiene / note 格式 / 翻译配对门禁绿；`check-plugin-independence` 绿。

## 风险 / 放弃的东西

- **放弃：profile patch 层 + config HMR 的行开关路线（原草稿）。** 它把模式建模为插件行的活跃性，是 profile 级的——切了就是整个实例都切了，做不到「开发会话与评测会话同时开着」，而那是 roadmap 决策 9 明确要的能力。它还需要处理「改装包集合时的重启边界」，preset 路线完全不需要。原草稿对 `plugin-manager` 的依赖随之消失。
- **放弃：会话内热切模式。** 官方零产出约束所致，不可绕过——中途换组合会让已记录的工具调用在新组合下无法成立。
- **模式粒度受 preset 粒度限制**：preset 组合的是插件行，做不到「同一插件只开放部分工具」。若将来需要更细的工具级裁剪，需另找官方 seam，不在本提案内造。
- **UI 漂移**：新建会话入口是官方界面，官方改版时选择器需跟进——与 message-tools 遮蔽官方渲染器的既有维护成本同量级，接受。
- **preset 的信任等级**：官方原话「a preset is as privileged as the plugins it names」，自建 preset 等同 shell 访问权。整合包自带 preset 时，其 `trust` 归属需在 package-management 里明确。
