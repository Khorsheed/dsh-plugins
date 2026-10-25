# Agent Note：房间输入框里的引用 chip

Status: implemented

## 问题

房间输入框用一个普通 textarea 接管了官方输入栏，草稿仍存在会话的官方输入状态里。引用 chip 能正常写进输入状态，但 textarea 显示的是输入状态的展开文本：整段 `> …` 和 `—— 引用` 一行原样露出来，一编辑就会把 chip 冲成普通文字。quote 自身还有一个问题：chip 在署名行处结束，而编辑器把光标放在 chip 紧后面，于是在那里接着打的问题（任何输入框都一样）会续在署名行上、并进引用块，发出后的卡片就认不出来了。

## 决定

- **chip 单独一行，textarea 只放自己打的字。** 输入框读取输入状态的 `occurrences`，把每个 chip 显示在 textarea 上方（标签、点击预览、✕ 删除）。textarea 的内容是去掉所有 chip 展开文本后的草稿（`draft-chips.ts`）。
- **编辑以 detect 坐标的区间替换写回。** textarea 的一次改动先归约成公共前缀和后缀之间的那一段，再通过 `inputActions.insertText` 以 detect 坐标（每个 chip 折成一个字符）写回，每次都用当时的 `captureInsertion().draftRev`。光标落在 chip 边界时，文字插在 chip 前面；跨过 chip 的选区只删两侧的文字，不删 chip；✕ 删掉 chip 那一个占位字符。@ 成员的补全走同一条路径。发送不变：派发出去的仍是展开文本，引用原文都在。
- **预览**走会话的 input-trigger 控制器（`inputTriggers.sessionOf(scope).openReference`），和官方编辑器点 chip 是同一条路由。点击时才探测，服务不在就不响应。
- **兜底**：宿主没有 `occurrences` 或 `insertText` 时，保持原来的纯文本显示。
- **quote 在引用块末尾补一个换行**（chip 和纯文本兜底都补），这样接着打的字会另起一行。chip 预览解析时去掉这个换行。

## 考虑过的其他方案

- **在 contenteditable 里行内显示 chip。** 否决：等于重新实现被接管隐藏掉的官方编辑器。单独一行在桌面和手机宽度下都清楚。
- **用带 references 的 `setDraft`。** 否决：公开的 `setDraft` 签名只接受文本，带 references 的形式只是 facade 的实现细节，不是契约。

## 影响

- 在主输入框里夹在句中的 chip，到房间里也显示在那一行；它在发送文本里的位置保持不变，因为编辑从不移动 chip。
