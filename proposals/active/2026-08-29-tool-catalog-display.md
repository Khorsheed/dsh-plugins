# tool catalog display：工具 tab 展示（内置 / 插件 / MCP 分组 + 参数级详情）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-29
- **官方依赖**：纯插件
- **范围**：**Phase 1 = 只做展示**。不涉及用户导入 MCP / 配置 / secret（那是独立的 Phase 2「MCP 导入与生命周期」，单独立 proposal）。

> 与提案 [`2026-08-26-capability-catalog`](2026-08-26-capability-catalog.md) 是同属「能力目录」的演进；本提案聚焦**工具**侧。

## 问题

目录已具备技能卡（预览卡 + 详情/源码/凭据），但**工具 tab 很弱**：

1. **只枚举到一个工具**：`snapshot`/`list_capabilities` 里用 `ctx.tools.schemas()`（**不带 scope**）。宿主 `schemas(scope?: ScopeKey)` 不传 scope 时只看**全局层**；而模型真正可用的（官方 + 插件 + MCP）工具多挂在 **agent 的 standing scope** 上。结果设置面板里工具只显示目录自己注册的 `list_capabilities`。
2. **展示扁平**：`ToolCard` 只是「名称 + 描述 + `source`（channel 原样字符串）+ 可选 owner」的折叠卡，没有**分组**、没有 **channel 标签**、没有**参数详情**。
3. **无搜索/筛选**，和技能 tab 的交互不对齐。

## 目标

把工具 tab 做成和技能 tab 对等的「能力清单」：

1. **枚举完整模型可见工具集**：`schemas()` 通过 standing scope（同技能的做法）取到官方 + 插件 + MCP 全部工具。
2. **强分组**：`内置` / `插件` / `MCP · <server>`。MCP 按 server 强分组折叠（server 头：名 + 工具数）。
3. **channel 标签 pill**：`内置`、`MCP · <server>`、`插件 · <owner>`，复用技能卡的 pill 样式。
4. **参数级详情**：工具卡展开显示**输入参数 JSON Schema**（宿主 `ToolSchema.parameters`）。
5. **搜索 + 来源筛选**：与技能 tab 相同的单行交互。

## 形态

### 1. 枚举（scope 修正）
`snapshot` 与 `list_capabilities` 里，把 standing scope 传给 `tools.schemas(scope)`，与 `catalogScopes()` 一致（技能已在用）。

```ts
// services/index.ts
const scope = await this.catalogScope()
const toolsSchemas = scope === undefined ? (tools?.schemas() ?? []) : (tools?.schemas(scope) ?? [])
```

### 2. duck-type 扩展
`ToolSchemaLike` 从 `{ name, description }` 扩成 `{ name, description, parameters? }`，好让 `CatalogToolRow` 能带出参数（JSON Schema 对象）。

```ts
interface ToolSchemaLike { name: string; description?: string; parameters?: Record<string, unknown> }
```

### 3. 数据
`CatalogToolRow` 增加：

```ts
/** 模型可见的参数 JSON Schema（仅展示）。 */
readonly parameters?: Record<string, unknown>
```

`projectTools` 透传 `schema.parameters`。

### 4. 展示（工具 tab）
- **分组渲染**：`内置`（平铺卡片）、`插件`、`MCP · <server>`（server 分组头：名 + 数，可折叠）。内置**暂不在此版按子类分组**（宿主未暴露工具分类，见「决策」）。
- **工具卡**：复用技能卡的 dsh-card anatomy（`pvCard/pvMain/pvHead/pvName/pvTag/pvDesc/pvSub`）：
  - `pvName` = 工具名；`pvTag` = channel pill（内置 / `MCP · <server>` / 插件）。
  - `pvDesc` = 一行描述；`pvSub` = server 或 owner。
  - 展开区显示**参数 schema**（JSON 区块，`parameters`）。
- **筛选栏**：搜索（名称/描述/server）+ 来源（内置/MCP/插件）下拉。布局同技能 tab 的单行。
- **计数**：每个分组头显示工具数；MCP server 头显示 server 名 + 工具数。

### 5. 模型侧 `list_capabilities`
现有工具已能 `kind:'tool'` 返回工具；保持。未启用（Phase 2）的 MCP server 因未连接、未注册，天然不出现在这里。

## 决策

- **强分组**：采纳（MCP 按 server，可折叠；内置/插件各自平铺分桶）。
- **参数级详情**：采纳（`ToolSchema.parameters`）。
- **内置是否再分组**：宿主未暴露工具分类（`official-tools` 是目录自己生成的 whitelist），**官方不支持则暂不分组**——内置平铺 + 计数；若官方将来暴露 channel/category，再加。可回溯为「upstream 候选」。
- **范围**：本版**只做展示**；MCP 导入 / `enabled` 生命周期 / secret 走 Phase 2。

## 实现记录

- worktree：`dsh-plugins-wt-tool-display`，分支 `feat/tool-catalog-display`。
- 部署验证：test 实例（port 3090，`cap-catalog-test` profile）目检 + 截图。
- （实现时登记 commit / PR）
