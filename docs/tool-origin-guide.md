# 工具来源标记（Tool origin tagging）指南

> 本文档面向「注册了模型可见工具的社区插件开发者」以及它的可编程 agent。看完按规范为工具标记来源，工具就会在 `工具与技能` 里归入「插件」（而不是按启发式显示为「内置」）。

## 为什么需要

harness 的 `ToolSchema` 只带 `name/description/parameters`，不携带「这个工具是哪个插件注册的」。所以 catalog 只能靠启发式猜测 channel（`mcp__` 前缀 / 官方白名单 / 启动基线差分），无法精确区分内置与社区插件工具。**所有模型可见的工具都会经由 `ctx.tools.register(definition)` 注册**，且注册表**按引用保留完整 `ToolDefinition`**，`ctx.tools.get(name)` 能原样读回——所以在注册的那一刻给定义打一个来源标记，catalog 就能通用地读出来。标记是**宿主侧**的，永不进入模型 wire（`schemaOf()` 只投影三字段）。

## 约定（二选一）

### 写法 A（推荐，零依赖）
插件自己去写全局 symbol 键（无需安装任何包）：
```ts
const def = defineTool({ name: 'subagent_dsh' /* ... */ })
def[Symbol.for('dsh.tool.origin')] = { channel: 'plugin', owner: '@khorsheed/dsh-my-plugin' }
ctx.tools.register(def)
```

### 写法 B（用 catalog 的便利 helper）
```ts
import { setToolOrigin } from '@khorsheed/dsh-capability-catalog'
ctx.tools.register(setToolOrigin(defineTool({ name: 'subagent_dsh' /* ... */ }), { channel: 'plugin', owner: '@khorsheed/dsh-my-plugin' }))
```

## origin 值

```ts
{ channel: 'plugin' | 'builtin' | 'mcp', owner?: string }
```
- `channel: 'plugin'` —— 社区插件工具，归入「插件」。
- `owner` —— 声明方包名（如 `@khorsheed/dsh-my-plugin`），展示用；推荐填。
- 也支持标 `'builtin'` / `'mcp'`，但官方/`mcp__` 工具本就能被现有启发式识别，通常无需标。

## 关键注意事项

1. **谁调 `ctx.tools.register` 谁挂 origin。** 很多家族插件的工具其实由**公共工具模块**注册（如 `@khorsheed/dsh-local-agent-tool-subagent`），不是插件本尊。这时共享模块**必须从自己的 config 接收/推导 `owner`**，**绝不要**把某个插件名硬编码进共享模块——否则所有用该模块的插件都会被标成同一个 owner。
2. **可选、增量。** 未标记的工具不会报错或崩溃，只是退回现有启发式（可能显示为「内置」）。新工具应默认带标记。
3. **标记是宿主侧**，挂在 `ToolDefinition` 上。模型看到的 schema 由 `schemaOf()` 重建，**永远不带**这个标记。
4. **打标之外，先确认工具真的注册上了。** 用 `ctx.get('tools')` 一次性同步探测再 `register` 的写法，在真实组合树上会输——tools 插件未必比你先就绪，探不到就永久跳过，而插件其余部分照常挂载，表面看不出异常（worktrees 当初就踩了这个坑：标记对、owner 对、也部署了，但工具压根没注册）。正确形态是 `ctx.inject(['tools'], (toolsCtx) => { ... })`：注册表出现时才触发，组合里没有 tools 时不触发，**且不会 pend 整个插件**（回调是子作用域）。

   三种注册时机的取舍：

   | 写法 | 结果 |
   |---|---|
   | 插件级 `export const inject = ['tools']` | 安全；代价是组合无 tools 时**整个插件 pend** |
   | `ctx.inject(['tools'], cb)` | 安全；只有**回调子作用域** pend，插件其余照常（✅ 推荐） |
   | `ctx.get('tools')` 一次性探测 | ✗ 真实组合树上会输，工具**悄悄不注册** |

   正例 `packages/room`（`ctx.inject(['tools'], ...)`），反例 `packages/worktrees`（已改为 inject）。

## 相关：组合层的两个共享命名空间

工具来源之外，还有两处「所有插件共用、无人拥有」的命名空间，`pnpm check:plugins` 现在会检查：

- **loader 行 id**（`cordis.patch.yml` 的 `id:`）：重复会**直接炸 boot**，因此是硬错误。
- **chain 槽的 priority**：升序选举、第一个返回非 null 者胜出，所以同一优先级的两个条目由**注册顺序**决出——那是组合树的实现细节，不是稳定契约。条件不重叠时共存是合法的，因此只报警告，并打印台账：

```sh
pnpm check:plugins --ledger
```

```
independence: chain-slot ledger
  conversation.composer
      -20  @khorsheed/dsh-local-agent
      -10  @khorsheed/dsh-room
```

要接管某个 chain 槽时先看这份台账挑一个空位，不必读几个包的源码去猜。keyed 槽（注册时带 `key:`，如 `conversation.chat.node`）靠 key 天然隔离，不参与选举，也不在台账里。

## 验证

标记后刷新 `工具与技能` 工具 tab，该工具应显示为「插件」，副标题是 `owner`。若仍显示「内置」，说明标记没挂上（检查是否在 `register` 前挂了、`owner` 是否取对）。**若工具在「插件」和「内置」两段都找不到，那不是标记问题——它根本没注册，先查注册时机（见注意事项 4）。**
