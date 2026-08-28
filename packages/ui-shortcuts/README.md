# @khorsheed/dsh-ui-shortcuts

[English](README.en.md) | 中文

dsh web GUI 的键盘快捷键插件:`Esc` 暂停运行中的回合,`Ctrl/Cmd+S` 插队发送当前草稿,`Ctrl/Cmd+O` 新建会话——每个键位都能在设置里重绑。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/07-ui-shortcuts.png" width="480" alt="设置中的快捷键卡片">

## 特性

- **暂停当前回合**(`Esc`)——等同于 composer 的 Stop 按钮,页面任意位置可用。
- **插队发送草稿**(`Ctrl/Cmd+S`)——以插队方式投递当前草稿;绑定时抑制浏览器保存手势。
- **新建会话**(`Ctrl/Cmd+O`)——侧边栏新会话按钮的同一入口;绑定时抑制浏览器的打开文件手势。
- **键位可重绑**——在 设置 → 插件 → 快捷键 中点击键位即可录制、解绑或恢复默认;偏好持久化在 `$DSH_HOME/settings.yaml`。

## 安装

不在默认 web bundle 中;一条命令完成安装并挂载(通过 `dsh.bundle` 自挂载):

```sh
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts      # 安装
dsh plugin --profile web remove @khorsheed/dsh-ui-shortcuts   # 卸载
```

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.2`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码；rc.1→rc.2 复核(2026-08-22):消费面无变化,全量构建测试通过。
- 源码线(deepseek-harness master):✅

## 已知限制

- **无用户自定义动作**——动作由插件通过 `ctx.shortcuts` 贡献;任意的命令行或开关暂不提供。
- **Ctrl/Cmd+S 仅草稿**——空草稿不做事;整队列插队仍是 composer 的 `Cmd/Ctrl+Enter` 手势。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

- `src/index.ts`(node 半边)——注册 `ui-shortcuts` 设置命名空间。
- `src/client/`(浏览器半边,`/plugins/ui-shortcuts/client.js`)——按键接线与 设置 → 插件 里的快捷键卡片。

行 id `ui-shortcuts` 与官方 `@deepseek-ai/dsh-client-ui-shortcuts` bundle 同名——一个 profile 里最多组合其一(重复 loader id 会在启动时 fail loud);官方默认镜像不挂载任何一方,上文的一条命令安装即常规路径。

动作全部走公开服务,从不触及 ui-conversation 内部:

| 动作 | 行为 |
| --- | --- |
| 暂停当前任务 | `conversation.cancel()`——与 composer 的 Stop 按钮同一操作。one-shot 子智能体不可停止(与 Stop 按钮的可见性一致)。 |
| 插队发送 | 对当前草稿调用 `conversation.input.for(scope).submit('steer')`;空草稿保持静默无操作。 |
| 新建会话 | `workspaces.startSession()`——侧边栏新会话按钮的同一入口;全局动作,不限定焦点。 |

重绑:点击键位录制下一个组合键(`Esc` 取消,`Delete`/`Backspace` 解绑,`Ctrl/Cmd` 在所有平台都计为一个 `primary` 修饰键),或恢复默认。偏好持久化在 `$DSH_HOME/settings.yaml` 的 `ui-shortcuts` 小节。

**Escape 分层**:Escape 暂停是全局的,但让位于先消费该键的一方:已被消费的 keydown(`defaultPrevented`——composer 的斜杠菜单、popupSelect)、打开的弹层(模态框、菜单、设置面板)、以及 composer 之外的可编辑目标(行内重命名、搜索框)。其余任何位置——composer 文本框、侧边栏、会话列表——Escape 都会暂停运行中的回合。IME 组合输入与按住重复的按键不会触发任一动作。

**给插件作者**——通过 `ctx.shortcuts` 注册表贡献动作:

```ts
ctx.effect(() => ctx.shortcuts.registerAction({
  id: 'my-plugin.myAction',          // 唯一 id,惯例 <插件>.<动作>
  label: { ns: 'my-plugin', key: 'action.myAction' },
  description: { ns: 'my-plugin', key: 'action.myAction.desc' },
  defaultBinding: { kind: 'key', modifiers: ['primary', 'shift'], key: 'o' },
  layering: 'global',                // 'global':capture 阶段,抑制浏览器默认
                                     // 'yield':bubble 阶段,让位于已消费按键/打开的弹层/可编辑目标
  available: () => true,             // 可选的分发时门禁
  run: () => { /* ... */ },
}), 'my-plugin: shortcut')
```

贡献项的文案留在贡献方自己的 locale 命名空间。id 重复会 loud 报错;多个动作共享同一组合键时先注册者生效。用户可在 设置 → 插件 → 快捷键 重绑或解绑任何动作。无模型请求、无 KV cache 影响——这些动作调用的正是 composer 自身控件使用的公开动词。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/ui-shortcuts`)。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
