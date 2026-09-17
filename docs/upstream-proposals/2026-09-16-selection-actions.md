# 上游提案：选区动作 seam（ui-conversation 会话区 + 文档预览）

- **状态**：提案（待上游裁决）
- **提出方**：dsh-plugins 社区仓（`@khorsheed/dsh-*` 系列包的消费者）
- **目标读者**：deepseek-harness 上游维护者（`packages/client/ui-conversation`、`packages/client/ui-chat`、`packages/client/ui-sidebar-documentpreview`）
- **起草日期**：2026-09-16（`@khorsheed/dsh-quote` M1 实施期间）

## 一句话

请上游在**会话转写区**与**文档预览**两类只读内容面上提供**选区动作 seam**：插件注册动作项，owner 在用户选中一段文本时把**选中的纯文本**（及可用的消息/文件锚点）交给动作——让「引用 / 转发 / 摘录」类插件不必用 `window.getSelection()` 的 DOM anchor 绕行。

## 现状（社区侧两次独立探针，结论一致）

1. **side-chat M2 探针**（2026-09-16，已归档于其 Agent Note）：`conversation.*` / `conversation.chat.*` SlotMap 目录无选区/摘录座位——`conversation.chat.assistant-actions` 是消息整粒度的动作位，不是文本跨度；ui-conversation 里所有 `selection` 命名都是 composer 输入机（Lexical caret spans、`EditSelection`、`caretSpan()`）的内部件，从不触及转写文本；message-tools（最可能有此功能的消息面插件）没有选区能力。
2. **quote-anything M1**（本提案的触发方）：要在「卡片详情、文件预览、聊天区」任意选中内容上浮出动作菜单，唯一可用实现是应用级 `window.getSelection()`——按社区仓 AGENTS.md 属"DOM anchor 最后手段"，允许但必须带兜底（宿主改版时浮层安静消失）。功能可以上线，但每一次宿主改版都是一次静默失效风险，且选区与消息/文件锚点之间没有任何官方通路。

## 建议的 seam 形态（任一即可，按上游架构口味取舍）

**方案 A：转写区 keyed 动作位。** 在 `conversation.chat.assistant-actions` 旁新增 `conversation.chat.selection-actions`（list 座位）。owner 在渲染侧监听消息体内的文本选区，以 owner props 调动作组件：

```ts
interface ChatSelectionOwnerProps {
  /** 选中的纯文本（已折叠空白） */
  readonly text: string
  /** 锚点：所在消息 id（用户/助手消息各自可寻址时） */
  readonly messageId?: string
  /** 视口矩形（浮层定位用；owner 也可以自己渲染浮层） */
  readonly rect: { left: number; top: number; width: number; height: number }
  /** 选区塌陷/动作完成时 owner 负责清理 */
  readonly dismiss: () => void
}
```

**方案 B：owner-prop 扩展。** 在现有消息渲染的 extraActions/owner props 上携带选区跨度（`selection?: { text, from, to }`），插件动作项在消息动作行内出现、以跨度为输入。覆盖粒度=单消息，跨消息选区不支持——可接受为 v1。

**文档预览（ui-sidebar-documentpreview）**：同样的选区动作位，owner props 带 `{ text, fileRef?, page?/anchor? }`。画布/文件预览等社区内容面可以照同一契约自实现，殊途同归。

## 同族追加（2026-09-17，quote-anything 引用样式需求）

**composer 任意位置引用 chip 插入。** 宿主 composer 已有结构化引用 chip（`ReferenceInsert = { source, ref, label, appearance?, clipboardText }`，`packages/client/ui-conversation/src/client/contract/input.ts:60`），但唯一插入路径是 `insertReference(ref, span)`——触发词（`#` 类）替换流程，需要一个已存在的 `TokenSpan`。社区场景是"把一段引用文本作为一个 chip 插到光标处"（引用样式，替代 `> ` markdown 引用块纯文本）。请开放一个不需 span 的插入面（形如 `insertChip(ref: ReferenceInsert): boolean`，插在 caret 处），或把 `insertReference` 的 span 放宽为可选（缺省=caret）。与选区 seam 同族：都是"内容进出会话"的官方通路，一并裁决命中率最高。

## 为什么值得上游收

- **一个 seam 退掉一类 DOM anchor**：quote-anything（引用到会话/侧边对话）、message-tools（编辑/转发）、side-chat（转写引用）三个插件的选区需求全部收敛； seam 落地后社区侧按区域逐个退役 `window.getSelection()` 路径。
- **纯文本先行，锚点可选**：v1 只需 `text` + `rect`；`messageId`/文件锚点是增量（owner 能供给时才给），契约向后兼容地生长。
- **无渲染负担**：owner 只在"该面板内确有选区"时调动作组件；未选中时零成本。

## 被拒/搁置的社区侧退路

quote-anything v1 的 `window.getSelection()` 路径**带兜底继续运营**（判定失效时浮层安静不出现，零破坏），并在 seam registry（docs/upstream-seam-registry.md）登记该缺口；每次 host 适配人工复验一次。

## 退役条件

ui-conversation（或 ui-chat）与 ui-sidebar-documentpreview 任一线发布选区动作 seam 后：quote-anything 按区域切换为官方 seam（会话区先行），DOM anchor 路径随之退役并在 Compatibility 流程中记录；本提案关闭。
