# Agent Note: capability-catalog 客户端弹窗拆分为聚焦模块

Status: implemented

[English](2026-08-30-capability-catalog-modal-split.md) | 中文

本说明记录 `@khorsheed/dsh-capability-catalog`（工具与技能设置页）单文件客户端弹窗的**行为保持式**拆分，拆分前与代码评审者（Codex）讨论，其优化决定了最终结构。

## 问题

`packages/capability-catalog/src/client/CapabilityCatalogCard.tsx` 达到约 1808 行、约 15 个组件。两块内部逻辑被复用却跨弹窗复制：元数据行（`meta`/`metaItem`/`metaKey`/`metaVal`）出现在工具详情与技能详情弹窗；凭据配置块（`credRow`/`credLabel`/badge/`inputWrap`/密码框 + 保存态）出现在技能与 MCP 管理弹窗。外壳已由共享的 `ModalShell` 集中。

## 决定

把文件拆成聚焦的 `client/*.tsx` 模块，先抽出共享件，保留**一份共享的 `CapabilityCatalogCard.module.css`**：

- `CapabilityCatalogCard.tsx`——分段/状态外壳（持有 tab/分段/过滤状态 + Remote 接线；渲染网格 + 弹窗）。
- `ModalShell.tsx`、`SchemaView.tsx`（SchemaView/Tree/Node + 辅助函数），原样搬移。
- `MetadataRow.tsx`——展示型 `MetadataRow({ items: {label, value}[] })`，不内嵌 tool/skill 知识。
- `CredentialField.tsx`——**展示型**的单行凭据组件。每个弹窗（技能 vs MCP 管理）各自保留本地 `credValues`/`credState`/`saveCred`；该组件刻意收窄，因为三处调用点的保存态语义不同（技能把 `state==='ok'` 当配置、隐藏保存；MCP 用 `decl.configured`、保存后清值但不翻转徽标；Add-MCP 是安装前无保存态的行）。一个持有全部状态的 `CredentialConfig` 会悄悄归一化这些差异。
- `SkillCards.tsx`（SkillPreviewCard + DeleteSkillConfirm）、`ToolCards.tsx`（ToolCard + ToolCards）、`McpCards.tsx`（McpCard）、`ToolDetailModal.tsx`、`SkillDetailModal.tsx`、`AddSkillModal.tsx`、`McpServerManageModal.tsx`（McpToolRow 留本地）、`AddMcpDialog.tsx`、`BundleFileTree.tsx`（BundleFileGlyph 留本地）。
- `mcp-model.ts`——共享的 MCP 分组/配置转换（`McpGroup`、`buildMcpGroups`，以及真正共享的 MCP 辅助函数）；小辅助留在其唯一消费方旁边。

## 备选方案

- **一个持有全部状态的 `CredentialConfig` 覆盖所有凭据点。** 否决：技能 / MCP 管理 / Add-MCP 的保存态语义不同；归一化它们会改变可观察行为。
- **把单一 CSS module 拆成每文件一个。** 本次否决：约 1750 行最终应按组件归属拆分，但现在拆会把「仅搬迁」审查变成大范围选择器移动 diff。CSS Modules 会去重，所以一份共享模块在此是安全的。
- **保留单文件、只就地抽两块重复逻辑。** 否决：文件仍约 1600 行，弹窗依然难以浏览；既定目标是按关注点分文件。

## 影响

- 纯结构改动：无标记、类名、状态归属、逻辑或 locale key 变化。bundle 大小因模块边界/tree-shaking 轻微变化（331 → 327 kB）。
- 新 `client/*.tsx` 文件被加入包的显式 `tsconfig.client.json` `files` 列表（该包用显式列表而非 glob）。
- 无组件测试；门禁为 `build` + `test`（68 个宿主侧测试）+ `check:plugins`，均通过，另加对弹窗堆叠/Escape、凭据 blur/Enter/Save、源码默认折叠、MCP 变更刷新的手动冒烟。
