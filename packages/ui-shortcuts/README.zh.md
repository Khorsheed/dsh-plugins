# @khorsheed/dsh-ui-shortcuts

[English](README.md) | 中文

可选的 web 快捷键插件：三个固定动作——**暂停当前任务**、**插队发送草稿**与**新建会话**——绑定到用户自选的键位。动作是固定的产品操作，键位由用户决定。默认：`Esc` 全局暂停（与 composer 的 Stop 按钮相同的取消操作），`Ctrl/Cmd+S` 以插队（steer）投递方式发送当前草稿，`Ctrl/Cmd+O` 新建会话（与侧边栏新会话按钮同一入口）。

## 安装与卸载

该插件**不在**默认 web bundle 中；安装需加入 profile。包声明了 `dsh.bundle`，一条命令完成安装并挂载 loader 行（不用手改 `cordis.patch.yml`）：

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts
```

**警示**：本包与官方 `@deepseek-ai/dsh-client-ui-shortcuts` 的 loader entry id 都是 `ui-shortcuts`，同一 profile 挂两次会在启动时 fail loud——只保留其一。

该行的 node 半边注册 `ui-shortcuts` 设置小节；浏览器半边（`/plugins/ui-shortcuts/client.js`）负责按键接线与 General Settings 行。卸载 = 移除或对该行 `disabled: true`。通过插件清单禁用属于部署层面的配置，不属于本包职责。

## 动作

| 动作 | 默认键位 | 行为 |
| --- | --- | --- |
| 暂停当前任务 | `Esc` | 通过公开的 `conversation.cancel()` 取消当前会话运行中的回合——与 composer 的 Stop 按钮同一操作。普通会话与 continuable 子智能体可停止；one-shot 子智能体不可（与 Stop 按钮的可见性一致）。 |
| 插队发送 | `Ctrl/Cmd+S` | 通过公开的 `conversation.input.for(scope).submit('steer')` 以 `steer` 投递方式发送当前草稿；绑定时抑制浏览器保存手势。仅草稿：空草稿保持静默无操作（插队整个队列仍是 `Cmd/Ctrl+Enter` 的手势）。 |
| 新建会话 | `Ctrl/Cmd+O` | 通过公开的 `workspaces.startSession()` 新建会话——与侧边栏新会话按钮同一入口；绑定时抑制浏览器的打开文件手势。全局动作，不限定焦点位置。 |

三个动作都只使用公开服务——插件从不触及 ui-conversation 内部。键位在 设置 → 通用 → 快捷键 中重绑：点击键位开始录制下一个组合键（`Esc` 取消，`Delete`/`Backspace` 解绑，`Ctrl/Cmd` 在所有平台都计为一个 `primary` 修饰键），或恢复默认。偏好持久化在 `$DSH_HOME/settings.yaml` 的 `ui-shortcuts` 小节。

## 给插件作者

任何插件都可以通过本包提供的 `ctx.shortcuts` 注册表贡献自己的键盘动作——设置区条目、重绑、持久化、无冲突分发全部免费获得：

```ts
ctx.effect(() => ctx.shortcuts.registerAction({
  id: 'my-plugin.myAction',          // 唯一 id，惯例 <插件>.<动作>
  label: { ns: 'my-plugin', key: 'action.myAction' },
  description: { ns: 'my-plugin', key: 'action.myAction.desc' },
  defaultBinding: { kind: 'key', modifiers: ['primary', 'shift'], key: 'o' },
  layering: 'global',                // 'global'：capture 阶段，抑制浏览器默认
                                     // 'yield'：bubble 阶段，让位于已消费按键/打开的弹层/可编辑目标
  available: () => true,             // 可选的分发时门禁
  run: () => { /* ... */ },
}), 'my-plugin: shortcut')
```

贡献项的文案留在贡献方自己的 locale 命名空间。id 重复会 loud 报错；多个动作共享同一组合键时先注册者生效。用户可在 设置 → 通用 → 快捷键 重绑或解绑任何动作；偏好按动作 id 持久化在 `ui-shortcuts` 小节。

## Escape 分层

Escape 暂停是全局的，但让位于先消费该键的一方：已被消费的 keydown（`defaultPrevented`——composer 的斜杠菜单、popupSelect）、打开的弹层（模态框、菜单、设置面板用 Escape 关闭且不 `preventDefault`，事件分发期间它们的 DOM 仍在）、以及 composer 之外的可编辑目标（行内重命名、搜索框）。其余任何位置——composer 文本框、侧边栏、会话列表——Escape 都会暂停运行中的回合。IME 组合输入与按住重复的按键不会触发任一动作。

## Model Experience

无。两个动作调用 composer 自身控件已在使用的公开动词（`conversation.cancel`、`conversation.input.submit`）；此处没有任何内容到达模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.0-rc.6`):✅ 完整——已对发布 tarball 实测验证:`@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6` 暴露 `conversation.input`(`SessionInputResolver.for(scope)` → `SessionInput.submit(mode)`,`InputSubmitMode` 含 `'steer'`);其余运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery)。
- 源码线(deepseek-harness master):✅

## Known Limitations and Deferred Work

- **无用户自定义动作**——插件通过 `ctx.shortcuts` 贡献动作（见「给插件作者」）；任意的用户自定义动作（命令、开关等）暂不提供。
- **Ctrl/Cmd+S 仅草稿**——空草稿不做事；插件刻意把整队列插队留给 composer 的 `Cmd/Ctrl+Enter` 手势。
- **无仓库内 e2e**——插件不在默认 bundle 中，因此没有 `apps/web` replay 场景；其接线由针对 fakes 的 apply 级浏览器 spec 覆盖。
