# Agent Note: capability-catalog 工具来源约定 + 引导 UI 与 skill 来源标签

Status: implemented

[English](2026-08-30-capability-catalog-tool-origin-convention.md) | 中文

本说明记录 `@khorsheed/dsh-capability-catalog` 中交付的社区工具来源标记约定、catalog 侧归因、工具 tab 引导 UI，以及 skill 来源标签修正。

## 问题

`ToolSchema` 不带 source/owner 字段，所以 `attributeToolChannel` 靠 `mcp__` 前缀 / 官方白名单 / 启动基线差分推断 channel，社区插件工具（`subagent_kimi`、`subagent_dsh`……）落进了「内置」。之前的脆弱尝试（扫 `@khorsheed/*` 组合行、`subagent_*` 命名启发式）已被撤回：它们不可靠、对社区其他人没用。需要的是**让社区作者自己分类自己工具**的通用机制。

## 决定

**注册时打来源标记，经 `ctx.tools.get()` 读回。** 所有模型可见工具都走 `ctx.tools.register(definition)`，注册表按引用保留完整定义，而系统提示词组装只投影 `{ name, description, parameters }`（所以侧标签必须用 `get()` 读，不能从 assembly 拿）。

- `tool-origin.ts`：`TOOL_ORIGIN = Symbol.for('dsh.tool.origin')`、`setToolOrigin(def, origin)`、`toolOrigin(def)`、`ToolOrigin { channel: 'plugin'|'builtin'|'mcp'; owner? }`。从包主入口再导出，插件可 `import { setToolOrigin }`；也可直接写 `def[Symbol.for('dsh.tool.origin')]`（零新增依赖）。
- 归因：`index.ts` 用 `ctx.tools.get(name)` + `toolOrigin(def)` 构建 `toolOriginsMap(scope)`，经 `catalogSnapshot`/`projectTools`/`attributeToolChannel` 传递，后者在官方白名单/基线兜底之前优先尊重作者声明的 `channel`（精确）。未标记工具退化到既有启发式。
- 引导 UI：工具分段栏旁一个安静且**居左**的「为什么我的插件工具不在这里？」链接，弹窗解释原因、展示规范文档路径（`docs/tool-origin-guide.md`），并复制**一整段可直接发出的说明**（引用该文档）给用户的可编程 agent。
- skill 来源标签 + 分段过滤：卡片按真实 `source` 标注（bundled→内置、runtime→插件、project-*/custom/user-* → 项目/自定义/用户），删除按钮改用 `DELETABLE_SOURCES` 驱动（不再复用「内置」标签），技能 tab 也加了与工具一致的 `SegmentBar`（全部/内置/插件/其他 —— other = 项目/用户/自定义），共用同一 `SegmentBar` 组件与 `.segBar`/`.segBtn` 样式。

## 备选方案

- **组合扫描（`@khorsheed/*` 行）+ `subagent_*` 启发式。** 已撤回，脆弱且对社区无益；换成注册时标记。
- **引导弹窗内联可复制的代码。** 否决：无上下文粘贴易出错；改让 agent 读文档。
- **skill 的「非删除」语义复用「内置」标签。** 否决（已混淆）；删除可见性改用 `DELETABLE_SOURCES`，标签用 `source`。

## 影响

- 标记可选/增量、追加式；未标记工具保留启发式兜底（绝不崩）。
- catalog 通过**延迟 `ctx.inject(['tools'])`** 加入工具注册表（基线、`list_capabilities`、MCP 桥），而非 apply 时一次性 `ctx.get('tools')` 探测——一次性探测会与注册表挂载顺序竞争、在真实组合树上会输，导致带标记的工具**悄悄不注册**（worktrees 的坑）。并在实例日志警告：某工具可见但 `ctx.tools.get()` 取不回来、或 tag 的 channel 未知。
- 共享工具模块（如 `dsh-local-agent-tool-subagent`）必须从自身 config 接收/推导 `owner`，勿硬编码（README + AGENTS.md）。
- 纯 catalog 改动；`tool-origin.ts` 加入 `tsconfig.host.json`。build + 71 个宿主侧测试 + `check:plugins` 全绿；`GEN_TYPERT_ONLY` 限定构建可避开并发的 `packages/datasets` typert 递归栈错误（见该改动）。
- 约定已写入 `AGENTS.md`（Tool origin tagging）与 `docs/upstream-seam-registry.md` S13。
