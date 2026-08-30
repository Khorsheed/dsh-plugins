# Agent Note: capability-catalog 标签页修复（MCP 刷新、源码默认折叠、去掉「全部」兜底）

Status: implemented

[English](2026-08-30-capability-catalog-tab-fixes.md) | 中文

本说明记录 `@khorsheed/dsh-capability-catalog`（工具与技能设置页）一起交付的三处小行为修复。

## 问题

- **删除/新增 MCP 服务器后，工具网格里不会立刻消失，要手动刷新页面。** `removeMcp`（以及其它 MCP 变更操作）只经 `mcpSnapshot()` 刷新了 MCP store，没有刷新喂给工具网格的 catalog snapshot。host 端其实已经把 `mcp__<server>__<tool>` 从 `ctx.tools` 注销了，但客户端缓存的 `snapshot.tools` 里还有它们，于是 `buildMcpGroups` 又把那个组拼了出来。
- **技能详情弹窗默认展开「查看源码」**，把元数据/凭据内容往下挤。
- **空状态出现令人困惑的「全部」跳转链接**（"没有匹配的工具 全部" / "没有匹配的技能 全部"），暗示点它会跳到「全部」，而且在工具和技能两个空状态里是复制粘贴的，配了一个 `resetFilter` 处理器。

## 决定

1. **`refreshMcp` 现在也重拉 catalog snapshot** —— 任何 MCP 新增/删除/启用/禁用/发现都会改变 host 工具注册表里挂载的 `mcp__` 工具，所以工具网格必须和 MCP store 一起刷新。实现为 `Promise.all([refresh(), mcpSnapshot().then(setMcps)])`。
2. **`sourceOpen` 默认 `false`** —— 「查看源码」默认折叠（右箭头），与元数据块的折叠 `<details>` 一致。
3. **从两个空状态都去掉「全部」兜底跳转链接**，并删除因此变死的 `resetFilter` 函数/属性与 `.ghostLink` 样式。分段按钮保留「全部」标签（那是 tab，不是兜底）。

## 备选方案

- **变更后只刷新 MCP store（旧行为）。** 否决：MCP 的新增/删除/启用/禁用/发现也会改变 host 注册的 `mcp__` 工具，所以工具网格必须一起刷新，否则展示的是过期的工具列表。
- **「查看源码」默认展开。** 否决：它把元数据/凭据内容往下挤；默认折叠与元数据块的折叠 `<details>` 一致。
- **只在技能里去掉「全部」跳转、工具里保留。** 否决：同一困惑模式同时出现在两个空状态，所以两个都去掉以保持一致。

## 影响

- 对所有 MCP 变更操作生效（删除/新增/启用/禁用工具/发现），因为它们都调用 `refreshMcp`。
- 纯行为修复；无数据模型或 locale key 变化。（`filterAll` 保留，用于分段按钮；`noFilterMatch`/`toolNoMatch` 保留为纯空状态文案。）
