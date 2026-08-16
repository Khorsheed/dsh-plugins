# Agent Note：快捷键动作注册表（ctx.shortcuts）

Status: implemented

[English](2026-08-16-ui-shortcuts-action-registry.md) | 中文

## 问题

插件的动作集此前是编译期写死的：封闭的 `SHORTCUT_ACTIONS` 联合类型、policy 里每个动作一个 store、封闭的 settings schema、硬编码的设置行列表。第二个需要自己键位的插件（分屏插件的"新会话+分屏"，Ctrl/Cmd+Shift+O）将不得不复刻整套录制/持久化/渲染管线。宿主也没有可复用的通用动作注册表：`dsh-commands` 的 handler 绑死 agent+文本语义，`ctx.commandUi` 只接受 popupSelect 贡献。

## 决策

ui-shortcuts 转型为快捷键动作注册表的 Provider，按能力缝模式实现，让消费者看到的是官方的 cordis 服务形态：

- **服务定义**（`client/contract.ts`）：`ShortcutRegistry.registerAction(contribution): disposer`，附 Context 声明合并。贡献项携带 `id`（惯例 `<插件>.<动作>`；重复 id loud 报错）、归属**贡献方**命名空间的 label/description locale 座位、`defaultBinding`、`layering`、可选的分发时 `available()` 门禁，以及 `run` 闭包。
- **`layering` 是枚举而非 when 表达式语言**：`'global'`（capture 阶段，抑制浏览器默认）和 `'yield'`（bubble 阶段，三重让路）覆盖了宿主现有的全部键位形态；出现第三种真实需求时再扩展。
- **持久化是开放字典**：`ShortcutSettingsSchema = z.dict(PreferenceSchema)`，按动作 id 存；只持久化用户改过的项，缺失 id 读取时回落到注册默认值。三个内建 id（`pause`/`steerSend`/`newSession`）不变，存量 settings 文档零迁移。
- 内建动作走公开注册路径（吃自己的狗粮）；设置行渲染自注册表的反应式 store，晚注册的动作无需重开面板即可出现。

## 考虑过的备选

**搭 `dsh-commands` 或 `ctx.commandUi` 的车。** 否决：它们的 handler 契约携带斜杠命令语义（agent 调用、会话日志、仅 popupSelect 的 UI），分屏这类纯 UI 动作不具备这些语义。

**开一个槽位让插件自渲染设置行。** 否决：每个插件都要重实现键帽录制、解绑语义和持久化，区块的交互语言会碎掉。

**VS Code 式 when 表达式。** 否决，复杂度没有消费者支撑；`available()` 加 layering 枚举已覆盖现有动作的同等场景。

## 影响

`ShortcutBindingsPolicy` 并入 `ShortcutRegistryRuntime`（actions/preferences/capturing 三个 store）；`policy.ts` 及其测试由 `registry.ts` 和 `registry.client.spec.ts` 替代。组合键冲突时按注册顺序分发——已写入文档，暂未在 UI 呈现。API 刻意只在 README 的插件作者一节低调公开：分屏插件是第一个外部消费者，接入期间契约仍可能小幅移动。
