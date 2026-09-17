# Agent Note: 画布 0.4.2 —— 会话工具迁入 `./agent` composition 入口并改为英文

Status: implemented

[English](2026-09-17-canvas-agent-entry.md) | 中文

## Problem

M3 把两个主会话画布工具与引导段注册在 **profile 根**：root `apply` 里的 `ctx.inject(['tools'])` 与 `ctx.inject(['systemPrompt'])`，于是所有 preset 的所有会话都背着一段中文画布引导、工具目录里都见 `canvas_*`。3080 的用户提出两条：工具按 preset 收敛（3080 只给写作模式），且引导要用英文（宿主提示词自己的语言）。那段文本也已过时（还写着顶栏重设计中已改名的「画布详情」tab）。

拆分所需的机制已有三重证明：官方子路径 composition 入口先例（`@deepseek-ai/dsh-tool-subagent-control/list-agents`，preset 的 `agent.cordis.yml` 按名挂载）；preset agent-plane 挂载——preset 文件里的 ctx 沿 scope 父链用 `ctx.get` 解析到 profile 根服务，而 `ctx.inject(['tools'])`/`ctx.inject(['systemPrompt'])` 落进该 preset 自己的层（plan-mode 先例）；以及 local-agent 家族为此种安排定下的规矩——**根行停用 + preset 内授予，两者绝不同时生效**，否则同名工具注册两次。

## Decision

**工具与引导段迁入 `src/agent.ts`——一个 `./agent` composition 入口。** 它的 `apply(ctx)` 探测 `ctx.get('canvasBoard')`（沿 scope 链解析到根服务——preset-plane 挂载因此成立），经 deferred `ctx.inject(['tools'])` 注册 `canvasMainSessionToolDefinitions(board)`（免导入 origin tag 不变），经 `ctx.inject(['systemPrompt'])` 注册引导段（name 仍 `canvas:tools`、order 151）。探测不到 `canvasBoard` 时 warn 且什么都不注册——降级不炸。`src/index.ts` 的 root `apply` 两段注册全删，docstring 记明拆分。

**引导段以英文重写**（宿主提示词的祈使行文），三条模型不必每轮重学的规则：提议经 `canvas_propose_card` 落成幽灵卡待用户收下/拒绝（绝不在回复里贴卡片正文冒充提议），评论经 `canvas_comment` 指出一个隐含假设或张力并以一个尖锐问题收尾，没有打开的画布时工具会明说——问用户，绝不乱猜。tab 按当前标签称呼：右栏 **Canvas** tab。

**出厂 patch 把入口挂在根级，收敛配方写进注释。** `cordis.patch.yml` 增第二行 `- id: canvas-agent, name: "@khorsheed/dsh-canvas/agent"`——社区默认 = 所有会话可见（0.4.2 前的现状，`dsh plugin add` 对老用户零变化）。按 preset 收敛的部署在 profile patch 里 `- id: canvas-agent, disabled: true`，并把同名行加进目标 preset 的 `agent.cordis.yml`——**两者绝不同时生效**（双注册规矩，写进 patch 注释）。identity triangle 未动：patch 仍挂本包自己的 `canvas` 行，checker 确认额外子路径出口自由（0 发现）。

## Alternatives considered

### 为什么不用插件 config 给根注册加开关（`tools: all|none`）？

config 回答的是「这个实例关掉」，不是「只给这个 preset」。多模式部署下，实例级开关仍把中文引导与目录存在感摊到每个会话，且要想到达用户真正画的那条 preset 边界还得经 Remote 绕一圈。composition 入口拆分正是 preset 授予的官方形态，代价只是一个小文件。

### 为什么不把工具挂进每个画布会话的 setup（像 side-chat 的 openWith）？

openWith 覆盖的是 side-chat 的画布上下文——另一条入口，原样不动。主会话没有画布自己的 agent setup 可挂工具，composition 级行是唯一的挂载点；把行做成具名入口，部署才能在根与 preset 之间挪动它。

### 为什么不保留中文段并加一段英文？

同一份引导两段齐上是双倍提示词预算换零信息。宿主提示词是英文的；这一段理应读上去像其余部分。zh 的 tab 标签留在 UI 里（locale 所有），提示词说模型的语言。

## Consequences

- `packages/canvas/src/agent.ts`（新）：`./agent` composition 入口（探测、工具、英文引导）。
- `packages/canvas/src/index.ts`：root `apply` 删除两段注册（及不再需要的 tools import）；docstring 记明拆分。
- `packages/canvas/cordis.patch.yml`：第二行 `canvas-agent`，注释写收敛配方。
- `packages/canvas/package.json`：`exports` 增 `"./agent"`（`types: ./lib/types/agent.d.ts`、`default: ./lib/agent.js`，官方 list-agents 形状）；版本 0.4.1 → 0.4.2。`tsconfig.host.json` 列入 `src/agent.ts`。
- `tests/agent.spec.ts`（新，3 例）：注册进 scope（两工具、origin tag、英文段的 name/order/内容与无 CJK）、`canvasBoard` 缺席降级（warn、零注册）、root apply 不再注册工具与段。
- 双语 README：新增「按 preset 收敛会话工具 / Scoping the session tools to a preset」节（3080 式配置样例）；Compatibility 条与工作原理段改指 `./agent`。
- 3080 的 operator 侧（profile patch disable + dsh-writing preset 行）是配置变更而非代码变更——正是这个入口存在的意义。
- side-chat 的 `openWith` 工具注入是另一条入口，未动。

## Testing

- `packages/canvas`：**167 个测试全绿**（164 之上 +3 入口用例）。`rm -rf lib` 后 `pnpm --filter @khorsheed/dsh-canvas build`（`lib/agent.js` + `lib/types/agent.d.ts` 产出）、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts` 全绿。
- 未在 3080 的活 preset 内复验（operator 在部署时挂 preset 行）；入口的注册与降级已对真 cordis Context 覆盖。

## Deferred

- `canvas_propose_draft` + 候选 diff 横幅、其余 stats 规则、web 搜索接线（M3 后段）；document 卡 html 渲染、会话侧 `canvas_search`/`canvas_clip`（M4）。
- 3080 operator 配置本身（profile patch `disabled: true` + dsh-writing 的 `agent.cordis.yml` 行）——部署时，主代理侧。

## Related

- [M3 note](2026-09-16-canvas-rightbar-rework.md)（本篇取代的根级注册；工具仍沿用的 focus 模型）。
- [顶栏 note](2026-09-17-canvas-topbar-redesign.md)（引导文本如今对齐的 tab 正名）。
- [plugin-visibility 规范](../../../docs/plugin-visibility.md)（本篇遵循的层表：工具随 preset 授予；tab 留在安装层）。
