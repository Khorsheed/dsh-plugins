# @khorsheed/dsh-context-guard

[English](README.md) | 中文

dsh Web GUI 的主动式上下文窗口压缩守卫。浏览器半边贡献一个 `conversation.input.right` 条目——输入框工具栏里的一枚压缩按钮，当**下一个请求的预算**越过模型上下文窗口的配置比例时自动出现。点击即执行官方 `/compact` 命令，让你在压缩仍然可行时提前压缩。本插件不需要新 RPC、不改官方代码；从 cordis.yml 中移除本插件即可清除它添加的所有界面。`/client` 导出即插件本体（`apply`/`inject`）与 `CompactGuardButtonProps` / `ContextGuardSettingsCardProps` 类型。

## 它为什么存在：官方自动压缩留下的无人预警的失败

官方 compaction-basic 引擎在 `agent/pre-step` 时，当 token-meter 估算越过上下文窗口的 80% 即自动压缩。该检查的两个特性留下了一个窗口：provider 拒绝主循环请求时，界面上没有任何预警：

1. **检查不含输出预算。** provider 在 `prompt + max_tokens > context_length` 时拒绝请求。官方压力检查只把 meter 的上下文估算与窗口的 80% 相比，因此当 prompt 低于 80%、但 prompt + 输出预算已超出窗口时，请求会以 `CONTEXT_WINDOW_EXCEEDED` 失败；随后溢出恢复压缩并重试——它的摘要调用只预留自己的小输出上限，重放仍然放得下，重试会成功——但用户先付出了一次失败的发送，且在空闲会话上没有任何信号提示下一次发送会失败。长工具调用回合会放大这一点：每一步的输出与工具结果持续追加，而危险在估算中始终不可见。
2. **meter 刻意低估。** token-meter 估算器"系统性地低估 CJK 文本与 JSON schema"，因此一个 CJK 密集或 schema 密集的会话可以停在 80% 估算之下，而 provider 侧计数早已越过 `context + maxTokens` 能放下的点。

守卫在数字仍处于窗口内时就暴露危险：它把配置的输出预算（主请求的预留）加到投影上下文上，一旦和越过阈值就显示按钮——让你在摘要调用仍能放下时提前压缩。

## 工作原理

- **位置**：`conversation.input.right`（输入框工具栏、发送按钮之前）。在越过阈值前不渲染任何内容，越过后自动出现。
- **数据**：官方 `contextPressure` 会话投影——`projectedTokens`（provider 上报的 prompt 样本随其后表面的有符号变动前移，因此压缩立即可见；旧日志回退到裸样本）与 `contextWindow`。
- **公式**：`(projectedTokens + maxTokens) / contextWindow >= thresholdRatio` → 琥珀色按钮；`>= 1` → 红色按钮（预算已超出窗口：主请求从此被拒，但手动 `/compact` 仍然放得下——它的摘要调用只预留小输出上限——现在就点）。
- **动作**：官方 `/compact` 命令通道（`remote.commands.execute` → 宿主 `ctx.commands` → `ctx.compaction.compactNow`），因此空闲门控、压缩锁与流程节点展示都由宿主负责。

## 配置

两个可调项可以在 GUI 里直接改：**设置 → 插件配置 →「压缩按钮时机」卡片**——卡片写入共享的 `context-guard` 设置节，按钮对保存后的新值**实时生效，无需重启**。下面的 YAML 组合条目是该设置节的 base 层：卡片未覆盖的值取自它，两者再叠加在 schema 默认值之上。

| 键 | 默认值 | 含义 |
|---|---|---|
| `thresholdRatio` | `0.8` | context + maxTokens 显示按钮的窗口比例（限制在 (0, 1]）。 |
| `maxTokens` | `256000` | 下一个请求预留的输出预算（token，限制为 >= 1）。默认与 deepseek 适配器的输出上限一致——主请求的预留；若你的模型上限不同请另行设置。更大的上限会让守卫更早出现，恰好落在真实请求开始被拒绝的位置。guard 的判定精度取决于 catalog 里 contextWindow 与 provider 真实窗口的接近程度，配小是保守（提前告警），配大会让红灯晚于真实的墙出现，所以宁小勿大。 |

**这两个字段只影响压缩按钮出现的时机。** 官方压缩引擎（compaction-basic）读的是它自己的 `thresholdRatio` / `maxTokens` / `auto` 配置，从不触碰本设置节——真实压缩时机不受这两个旋钮影响。

组合示例（成为卡片的 base 层）：

```yaml
plugins:
  context-guard:
    thresholdRatio: 0.75
    maxTokens: 32768
```

## 模型体验

### 模型看到什么

没有任何变化。按钮只是输入框装饰；点击执行的是与用户手动输入相同的 `/compact`，会话日志里出现的也是普通命令生命周期（以及任何压缩事务），与手输完全一致。

#### Token 影响

插件本身为零；它触发的压缩与手动 `/compact` 一样，把被遮蔽区间替换为检查点。

#### KV 缓存影响

无。

## 兼容性

- npm release 线（`@deepseek-ai/dsh@0.1.0-rc.7`）：✅ 完整——插件只触碰官方公开稳定面（插槽、`contextPressure` 投影、commands Remote、settings 面、locale、cordis 4.x、schemastery）。
- source 线（deepseek-harness master）：✅

## 已知限制与待办

- **`maxTokens` 是配置值，不是探测值。** 宿主异步解析有效输出上限（`ctx.llm.resolveModelInfo().defaultMaxTokens`），而会话投影无法等待异步解析，因此插件读取配置预算（来自设置卡片或 base 层）。若你的模型上限与默认不同，请设置 `maxTokens`；保守的较小值只会让按钮更早出现，这是安全的——提前压缩必然可行。
- **按钮是警告，不是保证。** 从"按钮出现"到"点击"之间上下文可能继续增长；agent 运行中宿主 `/compact` 可能报 `busy`；压缩摘要同样受窗口适配约束。
- **不自动压缩。** 插件只暴露手动动作；官方 80% 自动压缩保持原样运行，压缩落定后按钮随投影反映收缩后的表面而自动消失。
