# 插件可见性规范：按模式自隐的三层分工

本文统一回答一类问题：**一个插件的提示词、工具、sidebar、tab、设置卡等，在什么「模式」下应该出现，用什么机制隐藏**。所有插件作者按此执行，不要各自发明判据。

## 先分清两个「模式」

「模式可见性」的混乱大多源于混用了两个概念：

- **profile（部署级）**：`web-basic` / `web-dev` / `web-eval` 是部署组合，决定插件**装不装、挂不挂**。一个实例只跑一个 profile。**运行时拿不到 profile 名**——host 和 client 的 ctx 上都没有 profile 标志，profile-boot 也不设环境变量。所以不存在「运行时判断当前 profile」这条路。
- **preset（会话级）**：agent preset 是同实例内按会话授予的能力组合，**建会话时绑定并锁定**（存量会话永远保持创建时的 preset）。判据可读：会话的 preset id 从 `ctx.sessions.list` 投影读，preset 组合从官方 `pluginInventory` Remote 读。

推论：**「按模式自隐」= 按会话 preset 自隐，且只对会话级 surface 成立**。

## 速查表

| 维度 | 归属层 | 机制 |
|---|---|---|
| 工具注入（`ctx.tools.register`） | 会话级 | core/companion 拆分，工具行进 preset 的 `agent.cordis.yml`，官方原生授予 |
| 提示词注入（`systemPrompt.section`） | 会话级 | 注册在伴生工具行里，随工具走（guidance 描述工具，所有权随注册） |
| 会话级 UI（`conversation.view` tab、会话头徽标） | 会话级 | preset-visibility probe + RegistrationToggle / `return null`，**fail-open** |
| 右栏 sidebar tab、左栏 panellist、全局空间 | **安装层** | 没有也不该有运行时开关；装/不装由 profile 的 dependencies 决定 |
| 实例级行为开关（如 `tools: all\|none`） | config 层 | profile patch 行带 config；web client 读不到自己 config，走 host → Remote |
| 平台维度（web / headless） | manifest | `dsh.client.platform`，headless profile 不加载 client 半 |

## 第一层：安装层——跨会话 surface 的唯一开关

右栏 tab、左栏面板、全局空间这类 surface **先于并跨越任何会话存在**，它们的「按模式可见」只有一种实现：**那个 profile 不装这个包**（从 profile `package.json` 的 dependencies 去掉，`dsh.profile.bundles` 随之不含它）。web-basic 与 web-dev 的差异就是这么来的。

两个支撑事实：

1. **host 没有声明式可见性**。右栏 tab 注册表（harness `packages/client/ui-sidebar-right/src/client/tab-registry.ts:87-128`）只有 `id/kind/patterns/priority/canOpen/title/guide`，头注释明写「purely static … no runtime hook」；slot 注册（`ui-slots`）同样无任何 visibility 谓词（0.1.5 已复核）。`cordis.patch.yml` 的 `disabled: !!js` 表达式作用域读不到会话/preset 身份，只能做平台门。
2. **跨会话 surface 套会话 preset 判据是结构性错误**。preset 在建会话时绑定；存量会话的 preset 里没有你的行，「自隐」变成「永隐」。canvas 2026-09-16 实测踩过并整体回滚（见 `.agents/notes/implemented/feature/2026-09-16-canvas-preset-self-hide-reverted.md`）。**不要给右栏 tab / panellist / 全局空间加 preset 自隐**——包括「显示如果任一会话授予过」这类变体，那都是安装层穿了件查询的外衣。

同实例内「standard preset 的会话里能看到 worktrees 右栏 tab」**不是泄漏**：入口常驻、内容随会话能力降级是刻意形态（capability-catalog 的「镜子每个房间都挂」同理）。真的不想让某类部署看到，就从那个 profile 移除依赖。

## 第二层：会话级 preset 自隐——只对会话级 surface

会话 chrome（`conversation.view` tab 环、会话头徽标这类**依附于某个具体会话**的 UI）可以也应该自隐。

**判据（唯一事实源）**：当前会话的 preset 组合里有没有我的伴生行。组合数据读官方 `pluginInventory.list()` Remote 的 `agentPresets` 组（preset 组合文件本身是事实源，**不自建注册表**）。伴生行常量是纯数据，声明在 package.json 的 `dsh.references`（`scripts/check-plugin-independence.ts` 机械强制，不许放进 dependency 字段形成反向边）。

**fail-open 是铁律**：以下每条路径都判「显示」——host 没有 `remote.pluginInventory` namespace、RPC pending/失败、会话无 preset、preset 组缺失或 `broken`。自隐只藏「未授予的开发入口」，绝不允许把既有功能藏没。

**实现要点**：

- 探测用 `ctx.get('remote.pluginInventory')`，**绝不 inject**——inject 一个宿主没有的 namespace 会把整个插件 pend 死。
- 会话 preset 的读取 key 跨宿主线不同（0.1.2 在 `projectionValues.agentPreset`，0.1.1 在顶层 `agentPreset`），**双读兜底**。
- keyed tab 槽（`conversation.view`）的按钮枚举的是**注册**而非组件，隐藏 = 不注册：用 `RegistrationToggle` 随判据注册/注销；组件 `return null` 会留一个空壳按钮。list 槽（如 `conversation.session.header.utilities`）组件级 `return null` 即可。
- 判据驱动重评估：订阅 `ctx.sessions.list`（会话切换）+ 自己的 inventory 应答。
- 逃生门：若 surface 对应的真实对象存在（如 room 会话本身），永远显示——判据只过滤「没授予却展示入口」的情形。
- 纯 UI 包在组合里没有任何行可 keyed 时：放一个工具行进 preset，或退回手配 `visiblePresets` 名单（config 须经 host → Remote 送达 client，worktrees `badgeConfig` 先例）。

**模板**：`packages/room/src/client/preset-visibility.ts`（判据类 + `RegistrationToggle`，约 160 行），现有 eval / mission / datasets / room 四份内联拷贝 + worktrees 徽标变体。**保持各包内联拷贝，不抽 helper**——mode-switcher 提案 M3' 已拍板：第 5 个消费者出现时再决定归属。

## 第三层：实例 config 开关

「这个实例上完全关掉某能力」用 profile patch 行的 config，不用自隐判据：

- host 侧 `apply(ctx, config)` 正常拿 config，注册任何东西之前可整体 return（`local-agent-tool-subagent` 的 `tools: all|none` 先例）；也可以设置驱动动态挂载（`local-agent-dsh` 先例）。
- **web client 拿不到自己的 config**（boot 组合 client entries 不带 config），需要时经自己的 Remote 送下去（worktrees `badgeConfig` 先例）。

## 各维度细则

- **工具注入**：全部走 core/companion 拆分。core 不注册模型工具；伴生包（`preset-composed-row` 形态，不声明 `dsh.bundle`）由 preset 的 `agent.cordis.yml` 按名引用、按会话授予。伴生行 `ctx.get` 探测 core 服务，缺席则 log + no-op。新工具记得 `setToolOrigin` 打来源标签（见 AGENTS.md）。
- **提示词注入**：`systemPrompt.section` 注册在伴生工具行里，随工具授予（guidance 描述工具，所有权随注册）。不要在全局挂载的 core 里注册模式专属的 prompt 段。
- **会话级 UI**：按第二节执行。已有样板：eval「实验室」tab（`packages/eval/src/client/index.ts:93-148`）。
- **sidebar（右栏 tab / 左栏面板）**：不支持按 preset 配置可见性，也不要绕行实现（见第一节）。发现「开发插件的 sidebar 在别的模式可见」时，正确动作是检查那个 profile 的 dependencies，不是给 tab 加判据。
- **slash 命令与设置卡**：现状是无条件注册（已知缺口，local-agent 家族 UI 同列）。它们是会话内 affordance，未来接第二节的判据；新插件写 slash 命令时就带上判据，不要新增漏 UI 的拷贝。

## 反模式清单

- ❌ 给右栏 tab / panellist / 全局空间套会话 preset 判据（canvas 回滚，2026-09-16）。
- ❌ `ctx.inject` / 直接依赖 `remote.pluginInventory`（namespace 缺席会把插件 pend 死；必须 `ctx.get` 探测 + fail-open）。
- ❌ 任何读不到判据的路径判「隐藏」（fail-closed）。
- ❌ 自建「preset → 可见性」注册表/配置中心（组合文件就是唯一事实源）。
- ❌ 指望 `disabled: !!js` 读会话/preset 身份（作用域里没有）。
- ❌ 把伴生行名写进 dependency 字段（纯数据引用走 `dsh.references`，反向边会被 pnpm 排进同一构建 chunk）。
- ❌ keyed tab 槽用组件 `return null` 代替注册级 toggle（留下空壳按钮）。

## 上游边界

声明式 UI 显隐（slot `visibleWhen` 类谓词）需要上游支持，已列入 mode-switcher 提案的可选上游增强（`proposals/active/2026-08-26-mode-switcher.md`）。在此之前，自隐是**约定**不是强制——这正是本文存在的原因。

## 参考

- 提案：`proposals/active/2026-08-26-mode-switcher.md`（C 节自隐约定、验收 C1–C3、M3' 推广待办）
- 模板 note：`.agents/notes/implemented/feature/2026-09-10-worktrees-badge-preset-gate.md`
- canvas 回滚 note：`.agents/notes/implemented/feature/2026-09-16-canvas-preset-self-hide-reverted.md`
- 形态分类：`docs/packages.md`「形态的含义」
