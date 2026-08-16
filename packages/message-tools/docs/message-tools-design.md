# message-tools 设计：用户消息编辑与撤回

## 背景与目标

dsh web 的用户消息一旦发出就无法修正。本插件为**用户消息**提供两个操作：**编辑**（改后重发）与**撤回**（隐藏但保留）。设计目标：不 patch 核心 ui-conversation，全部走现有扩展点。

插件名 `@khorsheed/dsh-client-message-tools`——聚合名，后续消息相关能力（引用、置顶等）可继续收纳。

## 核心约束

1. **会话日志 append-only**：不能改写历史事件，编辑/撤回只能**追加新事件**。
2. **模型-可见 ⟺ 已记录**：任何进入模型上下文的改动必须有会话事件承载。
3. **不 patch UI**：按钮注入走 `MessageIconActions.extraActions`（现有 slot 注入点，独立插件可挂）。
4. **外部插件**：独立仓库 + npm 发布，peer 依赖 dsh 生态包。

## 事件设计

### 编辑：`user/message/edited`

```ts
{
  type: 'user/message/edited',
  data: {
    targetSeq: number,   // 被编辑的原始 user/message 的 seq
    content: { type: 'text', text: string }[],
    source?: { ... },    // 编辑来源（用户）
    ts?: number
  }
}
```

**投影语义**：模型上下文组装时，`targetSeq` 指向的消息用 `content` 替换；`targetSeq` 之后的事件序列不变。

### 撤回：`user/message/withdrawn`

```ts
{
  type: 'user/message/withdrawn',
  data: {
    targetSeq: number,   // 被撤回的 user/message 的 seq
    ts?: number
  }
}
```

**投影语义**：模型上下文组装时，`targetSeq` 指向的消息**跳过**（不可见）；trajectory/日志保留原事件（append-only 天然满足）。

## UI 设计

**图标**：官方 `ui-primitives` 提供 `IconEditOutline16`（编辑）与 `IconTrashOutline16`（撤回），经 `MessageIconActions.extraActions` 注入，无需自绘。

### 渲染接入：shadow 官方 user 渲染器（零官方改动）

- 注册 `conversation.chat.node` 的 `user` key，`priority: -1` → **shadow 官方默认**（官方 priority=0，lowest renders）
- 自绘用户消息：气泡（文本/图片/JSON 块）+ 按钮区
- **全部用 ui-primitives 公共 API**：`MessageText`/`JsonBlock`（内容）、`writeClipboard`（复制）、`IconEditOutline16`/`IconTrashOutline16`（按钮）
- 不 import ui-conversation 内部（发布物 files 只含 lib/，`./src/*` 外部不可达）

### 编辑：就地编辑

- 点击「编辑」→ **该消息位置就地**变为可编辑输入框（样式参考 composer，但内联在消息旁）——支持编辑历史消息（不一定是最新一条）
- 修改后发送 → 追加 `user/message/edited` 事件 → 新回合
- 取消 → 恢复原消息展示

### 撤回：影响面确认 + 文件快照

- 点击「撤回」→ 弹确认，列出**将被一并撤回的文件改动**（从会话日志 fold 该消息引发的 write/edit 文件）
- 消息本身与该轮 agent 回复被撤回是默认语义，不再额外确认
- 确认 → 追加 `user/message/withdrawn` 事件，**创建一版文件快照**（不真删文件，而是快照"撤回后"的文件状态）
- 撤回后消息流显示：**横线 + 文字 + 横线**（如 `──── 已撤回 ────`），文字标注动作（撤回 / 撤回回撤）
- **撤回的回撤**：文件快照机制天然支持——撤回后可再"回撤"（恢复文件到撤回前状态），UI 同样用横线+文字标注

## 模型可见性实现

**方案：session-projection**。dsh 已有 `session-projection` 机制（事件驱动的投影注册表，whole-value 规则）——注册一个 `message-tools` 投影，消费 `edited`/`withdrawn` 事件，产出"有效消息视图"。模型上下文组装侧（agent-loop 或 projection 消费者）读取该视图。

## 已定决策

- 编辑 = 就地编辑（消息位置内联输入框），支持历史消息
- 撤回 = 默认撤回消息 + 该轮 agent 回复；确认弹窗只列文件改动影响面
- 文件撤回 = 创建新版本快照（支持回撤的回撤），不真删
- 撤回/回撤的 UI 呈现 = 横线 + 文字 + 横线（标注动作）

## 未决项

- 编辑后原消息在 trajectory 是否保留（建议保留，append-only 原则）
- 投影层具体挂接点（agent-loop 的上下文组装位置）需实现时确认
- 文件快照的存储位置与格式（版本化文件层 or 每撤回一份副本）

## 里程碑

1. 事件类型 + known-event-types 注册：`user/message/edited` / `user/message/withdrawn`
2. session-projection 投影：edited 替换 / withdrawn 跳过
3. 独立 UI 插件：extraActions 注入编辑/撤回按钮（官方图标）
4. 就地编辑输入框（内联在消息位置）
5. 撤回确认弹窗（列文件改动影响面）
6. 文件快照（支持撤回回撤）
7. 测试：投影纯逻辑 + 组件渲染 + 事件写入
