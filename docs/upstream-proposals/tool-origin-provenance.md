# 上游提案：工具来源归因（tool origin / provenance）

- **状态**：提案（待上游评审）
- **提出方**：`@khorsheed/dsh-capability-catalog`（社区）
- **目标读者**：deepseek-harness 上游维护者（`packages/core/tools`、`@deepseek-ai/dsh-llm`）
- **登记**：`docs/upstream-seam-registry.md` → S12

## 一句话

`ctx.tools.schemas()` 只投影出 `{ name, description, parameters }`，不携带「这是官方内置、插件还是 MCP、以及哪个插件注册的」来源信息。下游任何消费者（能力目录、审计、UI 分组）都无法归因工具来源，只能靠启发式猜测。

## 现状

- `ctx.tools.register(definition)`（`packages/core/tools/src/index.ts:1037`）由某个插件/模块经 Cordis `this.ctx` effect 写入 `layer.tools.insert(name, definition)`。
- 注册表投影 `schemaOf()`（`index.ts:1256`）固定返回 `{ name, description, parameters }` —— `ToolSchema`（`@deepseek-ai/dsh-llm`）只有这三个字段：
  ```ts
  interface ToolSchema {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
  ```
- 因此 `schemas()` 无法反映来源。
- **后果**：`@khorsheed/dsh-capability-catalog` 只能靠三条启发式判定 channel（`packages/capability-catalog/src/channels.ts`）：
  1. `mcp__` 前缀 → MCP（精确）；
  2. 官方工具白名单 → 内置（精确）；
  3. 启动时基线差分 `appearedAfterApply` → 插件（仅捕捉「catalog 启动之后」才出现的工具）。
- 于是**在 catalog 启动时已注册的插件工具（`subagent_kimi` / `subagent_dsh`、message-tools、datasets 等）全被误判为「内置（推断）」**，插件分段恒为 0，误导用户。

## 建议的官方改动（低摩擦）

1. `ToolSchema`（`@deepseek-ai/dsh-llm`）新增可选字段：
   ```ts
   interface ToolSchema {
     name: string
     description: string
     parameters: Record<string, unknown>
     /** 注册来源：官方内置 / 插件 / MCP。可选，缺省视为官方内置。 */
     source?: 'official' | 'plugin' | 'mcp'
     /** 注册该工具的模块/插件 id（如 @khorsheed/dsh-local-agent-kimi）。 */
     owner?: string
   }
   ```
2. `ToolsRegistry.register()`（或 `layer.tools.insert`）在写入时从 Cordis 的 **layer 身份**捕获来源，存到 `ToolDefinition` 上（新增可选字段）。
3. `schemaOf()` 投影时把 `source`/`owner` 一并带出（不动 `name/description/parameters` 既有契约；缺省不输出）。

## 为什么摩擦低

- `register()` 本就通过 `this.ctx` effect 分发（`index.ts:1057`），**layer / 模块身份已经在调用作用域内**——host 不必让注册方额外传参，就能自动捕获「是谁注册的」（Cordis layer / 模块 id）。
- `schemaOf()` 已经单向读取 definition 再做白名单化，多带一个字段即可。
- 全可选 + 缺省 `builtin`，对现有调用零破坏；`schemas()` 的既有三字段契约不变。

## 对下游的价值

- 能力目录能精确标「内置 / 插件 / MCP」，不再依赖启发式，消除 `subagent_kimi` 等插件工具被误判为内置的问题；
- 审计 / UI 可按真实来源分组，而不是猜。

## 闭环 / 退役条件

官方落地后：`@khorsheed/dsh-capability-catalog` 的 `attributeToolChannel` 改为**首选读 `ToolSchema.source` / `owner`**，启发式退为兜底；`mcp__` 前缀可保留为 MCP 桥的提示信号。`docs/upstream-seam-registry.md` 的 S12 状态从 `绕行中` 改 `已退役`。

## 备选方案（若上游暂不接受 PR）

**不以上游改动为前提，社区侧可以做到相当精确的归因**，两点（详见 `docs/upstream-proposals/2026-08-30-tool-origin-provenance.codex-findings.md`）：

1. **社区自持 origin 元数据（长期）**：`schemas()` 只裁剪三字段，但注册表**完整保留 `ToolDefinition`**，且 `ctx.tools.get(name)` 能读回完整定义。所以注册方给 definition 挂 `Symbol.for('dsh.tool.origin') = { channel, package }` 即可绕过裁剪，catalog 用 `get()` 读回 —— 精确、boot 无关、随注册卸载自动消失。只需参与插件各自传入「声明方 owner」。
2. **扫 bundle 清单 × 活跃 loader 条目（当下就做）**：catalog 扫描已装插件 `package.json` 的 `dsh.bundle.patch` 里的 `config.toolName`，与 `ctx.loader.entries()` 的活跃 entry 求交，即可把 `subagent_kimi` 归到 `@khorsheed/dsh-local-agent-kimi`，无需等每个包更新。

推荐解析顺序：定义元数据 → `mcp__` 前缀 → 活跃 bundle-manifest 匹配 → 官方白名单 → 精确生成映射 → 既有 timing/命名推断。
