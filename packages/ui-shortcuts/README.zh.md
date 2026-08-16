# @khorsheed/dsh-ui-shortcuts

[English](README.md) | 中文

可选的 web 快捷键插件：两个固定动作——**暂停当前任务**与**插队发送草稿**——绑定到用户自选的键位。动作是固定的产品操作，键位由用户决定。默认：`Esc` 暂停（与 composer 的 Stop 按钮相同的取消操作），`Ctrl/Cmd+S` 以插队（steer）投递方式发送当前草稿。

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

两个动作都只使用公开服务——插件从不触及 ui-conversation 内部。键位在 设置 → 通用 → 快捷键 中重绑：点击键位开始录制下一个组合键（`Esc` 取消，`Delete`/`Backspace` 解绑，`Ctrl/Cmd` 在所有平台都计为一个 `primary` 修饰键），或恢复默认。偏好持久化在 `$DSH_HOME/settings.yaml` 的 `ui-shortcuts` 小节。

## Escape 分层

Escape 沿用 composer 现有分层，插件将其作为已记录的契约依赖：只有当事件目标是 composer 文本框、且 composer 没有先消费该按键（打开的斜杠菜单会对被消费的 Escape `preventDefault`）时才处理。其余一切——模态框、菜单、popupSelect——因为焦点在文本框之外，各自保留自己的 Escape 行为。IME 组合输入与按住重复的按键不会触发任一动作。

## Model Experience

无。两个动作调用 composer 自身控件已在使用的公开动词（`conversation.cancel`、`conversation.input.submit`）；此处没有任何内容到达模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **Escape 暂停限定在 composer 内**——只有焦点在 composer 文本框中时才暂停。全局 Escape 需要一个尚不存在的共享弹层消费方注册表；在那之前，侧边栏或模态框之上触发暂停是刻意不提供的。
- **无自定义动作**——动作集固定为两个；在重绑 UI 验证交互模型之前，暂不提供用户自定义动作（命令、开关等）。
- **Ctrl/Cmd+S 仅草稿**——空草稿不做事；插件刻意把整队列插队留给 composer 的 `Cmd/Ctrl+Enter` 手势。
- **无仓库内 e2e**——插件不在默认 bundle 中，因此没有 `apps/web` replay 场景；其接线由针对 fakes 的 apply 级浏览器 spec 覆盖。
