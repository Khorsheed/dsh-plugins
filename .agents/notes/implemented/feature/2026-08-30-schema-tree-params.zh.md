# Agent Note: 工具参数 schema 以树形结构渲染，取代嵌套表格

Status: implemented

[English](2026-08-30-schema-tree-params.md) | 中文

本 note 记录 `@khorsheed/dsh-capability-catalog` 的参数展示重做（工具详情弹窗与 MCP 管理弹窗内每个工具的 schema 共用的 `SchemaView`）。

## Problem

参数视图原本是 `<table>`（参数/类型/描述/必填），把嵌套的 `object`/`array<object>` schema 拍平成 `<tr>`，按层级加 `paddingLeft`，嵌套行再加一条 inset box-shadow 竖轨。实际效果很差：层级要盯着缩进才看得出来；必填列一整列只放一个"是"；每行一条粗分隔线；竖轨只出现在嵌套行上，表格在接缝处像断了。嵌套 schema 本质是树形，表格和这个形状天然相克。

## Decision

**参数视图改为 schema tree。** 每个属性一个节点：头部一行（chevron + 等宽名字 + 必填红色 `*`（带"必填" tooltip）+ 类型 chip），描述独占一行并与名字列对齐。子级渲染在父节点 chevron 中点延伸出的一条竖直参考线内——每层一条连续线，没有逐行竖轨。所有层级默认展开（状态记录的是*已折叠*集合，默认为空），层级一眼可见；父节点的整个头部行就是折叠按钮。某一**层**没有任何可展开的兄弟节点时，该层整体不渲染 chevron 占位槽——平铺 schema（最常见）不再凭空缩进。必填列、`paramName`/`paramType`/`paramDesc` 三个 locale key、以及整个 `toolParamsTable*`/`toolParamsNestedRow`/`toolParamsExpand` CSS 块全部移除；「表格」切换 tab 改名「结构」（`paramsTree`）。JSON 视图和「复制 JSON」不变。MCP 工具行一度内嵌 compact 树，现在改为打开共享的工具详情弹窗（见[共享弹窗壳 note](2026-08-30-shared-modal-chrome.md)），树因此只剩一个渲染上下文。同一改动顺带清掉了之前迭代留下的死 CSS（卡片化前的 `.card`/`.cardHead`/`.preview`/`.open`/`.scroll`/`.body`/`.divider`/`.title`、已删除的密码明文眼睛按钮 `.eyeBtn` 及其 64px 输入框内边距、`.infoBtn`、`.fieldGroup`、`.fieldLabelStrong`、`.pvDate`）。

## Alternatives considered

- **保留表格，打磨缩进/竖轨/列。** 否决：拍平行表格的问题是结构性的——嵌套 schema 不是表格数据，每种修补（更深缩进、竖轨、斑马纹）都在和网格打架。仅必填列就为一个字符吃掉约 15% 宽度。
- **每层展开一个独立小表格。** 之前已否决，此处确认：不定宽就无法跨表格对齐列，表与表之间的视觉接缝比竖轨更糟。
- **只保留 JSON 视图。** 否决：原始 JSON 仍是非对象 schema 的兜底、且一次点击可达，但常见场景下它把必填/类型信号埋进了大括号里。

## Consequences

- 层级无需交互即可读，必填/类型信号逐行可扫；折叠状态按节点记忆、随视图销毁重置（可接受——视图本身是临时的）。
- `nestedSchemaOf`/`schemaProps`/`requiredNames`/`typeLabel` 未动——树复用表格原来的 schema 遍历逻辑，MCP `array<object>` 的 items 行为一致。
- 该组件没有客户端测试；验证方式为 3090 实例目检（深层内置 schema、无 gutter 的平铺 schema、JSON 切换、折叠）。68 个 host 端测试不受影响。
- `CapabilityCatalogCard.tsx` 仍是约 1.8k 行单文件（15 个组件）；拆分是已知的、明确推迟的清理项——本次改动没有让它继续膨胀。
