# Codex 调研：上游不接受 PR 时，如何拿到工具来源

- **调研对象**：`deepseek-harness`（上游）+ `dsh-plugins`（下游 catalog）
- **结论落地**：`docs/upstream-proposals/tool-origin-provenance.md` 的「备选方案」
- **约束**：**不做任何上游修改**（上游暂不支持该字段、不接受 PR）。

## 背景（一句话）

`ctx.tools.schemas()` 只投影 `{name, description, parameters}`，但注册表**完整保留了 `ToolDefinition`**，且 `ctx.tools.get(name)` 能取回完整定义 —— `schemaOf()` 的裁剪只发生在投影时，**多余字段在注册后仍然存活**。所以「来源」可以作为一个社区约定挂在 definition 上，穿过 `schemas()` 的裁剪，用 `get()` 读回。

## 排序后的备选方案

### #1（推荐）：社区自持的 origin 元数据，经 `tools.get()` 读回

**机制**。`register()` 时给 `ToolDefinition` 挂一个 `Symbol.for('dsh.tool.origin')`；`schemas()` 只裁剪三字段、不会丢掉它；`tools.get(name, scope?)`（`packages/core/tools/src/index.ts:1205`）返回完整 definition。用全局 Symbol 避免冲突：

```ts
// 共享约定，无需 import host 类型
const TOOL_ORIGIN = Symbol.for('dsh.tool.origin')
type Origin = { channel: 'plugin'; package: string; module?: string }

const definition = defineTool({ name: config.toolName /* ... */ })
;(definition as typeof definition & { [TOOL_ORIGIN]: Origin })[TOOL_ORIGIN] = {
  channel: 'plugin',
  package: config.ownerPackage,   // 声明方，而非实现方
}
ctx.tools.register(definition)
```

Kimi 类的 declarative patch 传声明方：

```yaml
- id: tool-subagent-kimi
  name: '@khorsheed/dsh-local-agent-tool-subagent'
  config:
    provider: kimi-cli
    toolName: subagent_kimi
    ownerPackage: '@khorsheed/dsh-local-agent-kimi'
```

catalog 消费：

```ts
const def = ctx.tools.get('subagent_kimi')
const origin = def?.[Symbol.for('dsh.tool.origin')] as Origin | undefined
// => plugin / @khorsheed/dsh-local-agent-kimi
```

**可靠性**：精确、可回溯、与 boot 顺序无关、作用域感知（`get()` 传同一 scope）；随注册卸载自然消失；能区分「声明方」与「实现包」。代价是**只有参与的社区插件才获得精确归因**，官方与 MCP 工具继续走现有兜底。普通 string 属性更易调试，全局 Symbol 碰撞/泄漏风险更低。
**改造成本**：零上游改动；catalog 小改 + 社区工具注册方各自 +1 个 config 字段。

### #2（建议 Now 就做）：扫 bundle 清单 + 对活跃 loader 条目求交

**机制**。Cordis 活跃组合可用 `ctx.loader.entries()` 遍历（`vendor/loader/src/config/tree.ts:27`），每条 entry 暴露 `options.name`/`options.config`/`disabled`/`fiber`（`vendor/loader/src/config/entry.ts:9`）。Kimi 的 patch 显式声明 `tool-subagent-kimi → config.toolName: subagent_kimi`（`packages/local-agent-kimi/cordis.patch.yml:27`）。catalog 扫描已装直接依赖的 `package.json` 的 `dsh.bundle.patch`，解析出 `config.toolName`，再与活跃 entry 求交：

```ts
for (const pkg of installedPluginPackages()) {
  for (const row of parseBundlePatch(pkg)) {
    if (row.config?.toolName === 'subagent_kimi'
        && activeEntries.some(e => sameRow(e.options, row))) {
      return { channel: 'plugin', owner: pkg.name }
    }
  }
}
```

返回 `@khorsheed/dsh-local-agent-kimi`，即使运行时注册方是通用工具包。
**可靠性**：对「self-mounting、patch 里带显式 `toolName`」的插件很强；boot 后可用、能排除「只装了没挂」的插件。弱点：Cordis 行保留了 import 的模块与 config，但不保留是哪个包的 patch 插入的——catalog 得从文件系统清单重建来源；完全相同的重复行有歧义；嵌套/生成 patch 需适配；包发现要限定在 profile 依赖内，别无脑 crawl `node_modules`。
**改造成本**：仅 catalog；工具插件与上游都不用改。是对当前 Kimi 行的最佳即时补丁。

### #3：早期注册拦截（装饰 `tools.register`）

复用 `ctx.tools.get` 的调用方重绑定（`vendor/cordis/src/registry.ts:52`）与 `tools.register()` 的 effect（`tools/src/index.ts:1037`），catalog 抢先加载时能拿到 `this.ctx.fiber` → `loader.locate(fiber)` 定位 entry 模块。**但**：只覆盖装饰之后的注册、对 proxy/实例赋值敏感、必须保 `disposer` 与 `this`、影响所有调用方，且**修不了既有的 boot 顺序问题**。无官方的「before registry insertion」钩子。**不建议生产用。**

### #4：显式的「名字 → 包」静态映射

```ts
const COMMUNITY_TOOLS = { subagent_kimi: '@khorsheed/dsh-local-agent-kimi', subagent_dsh: '@khorsheed/dsh-local-agent-dsh' }
```
确定性、boot 无关；但会过期、漏第三方插件、需手动/构建期再生成。**精确名字映射比前缀规则安全得多。**

### #5：命名启发式（仅兜底）

`mcp__<server>__<tool>` 是真协议约定；社区**没有**通用可比约定——`subagent_*` 只覆盖一族，message-tools/datasets 名字无关，`*_tool` 后缀既不必须也不排他。已知插件精确映射或极窄的 `subagent_*` 规则能改善计数，但**不是权威**。

## 候选方向裁决

- **A. Cordis layer 内省**：**死路**（精确工具归属）。fiber 通过 `getEffects()`（`vendor/cordis/src/fiber.ts:566`）暴露 effect-label 树，但每个注册都只是 `tools.register()` 标签；`ToolLayer` 只存 `name → definition`，不保留属主 fiber/disposer；无法把 loader/fiber 身份接回某个已存在的 definition。
- **B. 组合/清单映射**：**真实可行**（`ctx.loader.entries()` + 包 patch 扫描）。loader entry 只定位「注册行」，不定位「哪个包的 bundle 声明了它」。
- **C. `tools/change` / 事务**：**死路**（回溯）。事件不带参数，effect 不暴露注册载荷或来源钩子。
- **D. 命名约定**：只能当低置信兜底。
- **E. 更丰富的 `ctx.tools`**：`get()` 是真正的关键 API；`view()`/`visible` 是私有；无公开 list/debug/origin 访问器。`get()` 暴露完整 definition，但**没有 host 生成的 owner 元数据**。

## 推荐做法

- **长期**：采纳 **#1 作为社区约定**（`Symbol.for('dsh.tool.origin')` 挂在 definition 上，经 `tools.get()` 读回），让通用工具工厂把「声明方 owner」作为显式 declarative 参数传入。
- **当下就做**：实现 **#2**，无需等每个包更新即可修好已安装的 self-mounting 插件。
- **解析顺序**：
  1. 显式 definition 元数据；
  2. `mcp__` 前缀；
  3. 活跃 bundle-manifest 匹配；
  4. 官方白名单；
  5. 精确生成的社区映射；
  6. 既有 timing/命名推断。

全程留在下游，同时给 Kimi 精确 owner，并对还不能自我声明的工具保留诚实的置信等级。
