# @khorsheed/dsh-context-guard

[English](README.en.md) | 中文

dsh Web GUI 的上下文窗口压缩提醒：当**上下文占用**——与输入框旁边进度环显示的是同一个数——越过模型上下文窗口的配置比例时，输入框工具栏里会自动出现一枚压缩按钮，点击即执行官方 `/compact` 命令。卸载即清除它添加的所有界面。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/context-guard-button.png" width="480" alt="上下文占用越过配置比例后，聊天框出现压缩按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/context-guard-settings.png" width="480" alt="提醒比例可在设置中按偏好调整(0.01–1)">

## 特性

- **输入框里的压缩按钮**——低于阈值时隐藏，越过后以琥珀警示色自动出现。
- **与进度环同一个数**——由官方 `contextPressure` 投影驱动，按钮与进度环永不打架。
- **执行官方 `/compact`**——空闲门控、压缩锁与流程节点展示都由宿主负责。
- **一个实时可调项**——占用阈值，在设置 → 插件里改，无需重启。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-context-guard
```

安装后重启 web 实例。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-context-guard
```

## 配置

一个可调项，在 GUI 里改（设置 → 插件配置 →「压缩提醒时机 / Compaction reminder timing」）且实时生效，无需重启。

| 键 | 默认值 | 含义 |
|---|---|---|
| `thresholdRatio` | `0.8` | 压缩按钮出现时的上下文占用比例（限制在 (0, 1]）。想更早收到提醒就调低——provider 拒绝墙在 100% 占用之下（见「实现原理」）。 |

```yaml
plugins:
  context-guard:
    thresholdRatio: 0.65
```

**该字段只影响按钮出现的时机**——真实压缩时机仍由官方压缩引擎自己的 `thresholdRatio` / `auto` 配置决定。

## 兼容性

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

## 已知限制

- **提醒，不是保证**——从按钮出现到点击之间上下文可能继续增长，agent 运行中 `/compact` 可能报 `busy`。
- **没有输出上限旋钮**——拒绝墙取决于 `window − maxTokens`，这是模型属性而非用户偏好。
- **不自动压缩**——官方 80% 自动压缩保持原样运行。

## 实现原理

<details>
<summary>它为什么存在与内部结构（点击展开）</summary>

### 在进度环看不到的"墙"之前提醒你

官方 compaction-basic 引擎在上下文窗口 80% 处自动压缩，且只在步间运行。但 provider 在 `prompt + max_tokens > context_length` 时拒绝请求——请求要预留输出 token，因此拒绝墙在 100% 占用之下。以 deepseek 适配器的默认值（窗口 1,000,000、输出上限 256,000）计，墙在约 74.4% 处，甚至低于官方 80% 压缩点；估算器还系统性低估 CJK 文本与 JSON schema，provider 侧计数比进度环显示的高。空闲会话上没有任何信号提示下一次发送会失败。

默认比例（0.8）下按钮与官方引擎要压缩的点重合；**调低比例（如 0.6–0.7）可更早收到提醒**——此时手动 `/compact` 的摘要调用还放得下。

### 机制

- **位置**：`conversation.input.right`（输入框工具栏、发送按钮之前）。
- **数据**：官方 `contextPressure` 会话投影——`projectedTokens` 与 `contextWindow`，旧日志回退到 provider 裸样本。
- **公式**：`projectedTokens / contextWindow >= thresholdRatio`——与进度环显示的是同一个占用数。
- **动作**：官方 `/compact` 命令通道（`remote.commands.execute` → `ctx.commands` → `ctx.compaction.compactNow`）。

### 模型体验

对模型没有任何变化：点击执行的是与用户手动输入相同的 `/compact`，会话日志里也是同样的命令生命周期。插件本身无 token 与 KV 缓存影响。

`/client` 导出即插件本体（`apply`/`inject`）与 `CompactGuardButtonProps` / `ContextGuardSettingsCardProps` 类型。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/context-guard`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
