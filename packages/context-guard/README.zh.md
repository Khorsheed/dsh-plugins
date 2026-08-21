# @khorsheed/dsh-context-guard

[English](README.md) | 中文

dsh Web GUI 的上下文窗口压缩提醒：当**上下文占用**——与输入框旁边进度环显示的是同一个数——越过模型上下文窗口的配置比例时，输入框工具栏里会自动出现一枚压缩按钮，点击即执行官方 `/compact` 命令。不需要新 RPC、不改官方代码；移除本插件即清除它添加的所有界面。

<img src="docs/screenshots/context-guard-button.png" width="480" alt="上下文占用越过配置比例后，聊天框出现压缩按钮">
<img src="docs/screenshots/context-guard-settings.png" width="480" alt="设置 → 插件里的提醒比例配置项">

## 特性

- **输入框里的压缩按钮**——一个 `conversation.input.right` 条目；低于阈值时不渲染任何内容，越过后以琥珀警示色自动出现。
- **与进度环同一个数**——由官方 `contextPressure` 会话投影驱动，按钮与进度环永不打架。
- **执行官方 `/compact`**——走宿主命令通道，空闲门控、压缩锁与流程节点展示都由宿主负责。
- **一个实时可调项**——占用阈值，在 GUI 里改（设置 → 插件配置 →「压缩提醒时机 / Compaction reminder timing」），无需重启。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-context-guard
```

然后重启 web 实例。卸载即清除插件添加的所有界面：

```sh
dsh plugin --profile web remove @khorsheed/dsh-context-guard
```

## 配置

一个可调项，在 GUI 里改（设置 → 插件配置 →「压缩提醒时机 / Compaction reminder timing」）且实时生效——按钮对保存后的新值立即反应，无需重启。下面的 YAML 组合条目是该设置节的 base 层；卡片未覆盖的值取自它。

| 键 | 默认值 | 含义 |
|---|---|---|
| `thresholdRatio` | `0.8` | 压缩按钮出现时的上下文占用比例（限制在 (0, 1]）。想更早收到提醒就调低——provider 拒绝墙在 100% 占用之下，因为请求要预留输出 token（见「实现原理」）。 |

组合示例（成为卡片的 base 层）：

```yaml
plugins:
  context-guard:
    thresholdRatio: 0.65
```

**该字段只影响按钮出现的时机。** 官方压缩引擎（compaction-basic）读的是它自己的 `thresholdRatio` / `auto` 配置，从不触碰本设置节——真实压缩时机不受影响。

## 兼容性

- npm 发布线（`@deepseek-ai/dsh@0.1.1-rc.1`）：✅ 完整——基于 rc.8 类型面构建并通过测试。本构建**要求 rc.8**：`commands/execute` Remote 新增必填 `images` 参数（rc.6/rc.7 宿主会收到错位的参数）——在旧宿主上请停留在上一个构建。——亦在 0.1.1-rc.1 上验证（纯增量审计，2026-08-21）
- source 线（deepseek-harness master）：✅

## 已知限制

- **按钮是提醒，不是保证。** 从"按钮出现"到"点击"之间上下文可能继续增长；agent 运行中宿主 `/compact` 可能报 `busy`；压缩摘要同样受窗口适配约束。
- **输出上限不在界面暴露。** 拒绝墙取决于模型的输出预算（`window − maxTokens`），这是模型属性而非用户偏好；README 承载了算式与"调低比例"的引导，而不是再加一个让人困惑的旋钮。
- **不自动压缩。** 插件只暴露手动动作；官方 80% 自动压缩保持原样运行，压缩落定后按钮随投影反映收缩后的表面而自动消失。

## 实现原理

<details>
<summary>它为什么存在与内部结构（点击展开）</summary>

### 在进度环看不到的"墙"之前提醒你

官方 compaction-basic 引擎在 `agent/pre-step` 时，当 token-meter 估算越过上下文窗口的 80% 即自动压缩。该画面的两个特性会让请求在 meter 显示 80% **之前**就可能失败：

1. **拒绝墙在 100% 占用之下。** provider 在 `prompt + max_tokens > context_length` 时拒绝请求——请求要预留输出 token。以 deepseek 适配器的默认值（窗口 1,000,000、输出上限 256,000）计，墙在约 74.4% 占用处，远低于 100% 与官方 80% 压缩点。CJK 密集或 schema 密集的会话更糟：估算器"系统性地低估 CJK 文本与 JSON schema"，provider 侧计数比进度环显示的高。
2. **官方自动压缩只在步间运行。** 空闲会话上没有任何信号提示下一次发送会失败；长工具调用回合里输出还在不断累积。

守卫是进度环之上的提醒：默认比例（0.8）下它与官方引擎要压缩的点重合；**调低比例（如 0.6–0.7）可更早收到提醒**——此时手动 `/compact` 的摘要调用还放得下。

### 机制

- **位置**：`conversation.input.right`（输入框工具栏、发送按钮之前）。在越过阈值前不渲染任何内容，越过后以琥珀警示色自动出现。
- **数据**：官方 `contextPressure` 会话投影——`projectedTokens`（provider 上报的 prompt 样本随其后表面的有符号变动前移，因此压缩立即可见；旧日志回退到裸样本）与 `contextWindow`。
- **公式**：`projectedTokens / contextWindow >= thresholdRatio` → 按钮出现。这与**输入框旁边进度环显示的是同一个占用数**——一个数字，不混淆。
- **动作**：官方 `/compact` 命令通道（`remote.commands.execute` → 宿主 `ctx.commands` → `ctx.compaction.compactNow`），因此空闲门控、压缩锁与流程节点展示都由宿主负责。

### 模型体验

对模型没有任何变化。按钮只是输入框装饰；点击执行的是与用户手动输入相同的 `/compact`，会话日志里出现的也是普通命令生命周期（以及任何压缩事务），与手输完全一致。

- **Token 影响**：插件本身为零；它触发的压缩与手动 `/compact` 一样，把被遮蔽区间替换为检查点。
- **KV 缓存影响**：无。

`/client` 导出即插件本体（`apply`/`inject`）与 `CompactGuardButtonProps` / `ContextGuardSettingsCardProps` 类型。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/context-guard`）。问题与贡献请移步该仓库。
