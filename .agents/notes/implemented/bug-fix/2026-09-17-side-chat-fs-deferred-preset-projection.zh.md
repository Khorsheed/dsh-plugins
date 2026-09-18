# Agent Note: 侧边对话 0.2.3——从未落盘的 apply 时 fs 探测、preset 继承与上下文注入投影

Status: implemented

[English](2026-09-17-side-chat-fs-deferred-preset-projection.md) | 中文

## Problem

三个 3080 地面核实的 bug，都在侧边对话的地基上：

**持久化从未发生（最严重）。** 全盘整盘搜索不到 `~/.dsh-official/state/sidechat/contexts.json`，而 side agent 的会话 journal 正常落盘。根因：`SideChatStore` 构造函数在 apply 时一次性 `this.fs = ctx.get('fs')`——sidechat 没有声明 fs 注入，按挂载顺序 fs 服务尚未发布，探针永远拿到 undefined，store 静默地永远 memory-only 降级。每次重启全部 context 映射丢失（journal 成为找不到的孤儿）。canvas 能落盘是因为它 `export const inject = ['fs']`；它的 index 注释里就有这条教训的原话（"Deferred injection, NOT an apply-time probe — the registry's own mount order would race a `ctx.get` and silently lose"）。

**preset 一致靠运气而非设计。** 部署默认 preset 恰好是 `dsh-writing`，所以 side-chat 与写作模式会话碰巧一致——而标准模式会话得到的仍是 `dsh-writing` 的侧边对话。

**AGENTS.md 整块被渲染成用户气泡。** side 会话的 journal 与任何会话一样携带上下文注入（agent-instructions、系统提示快照、技能目录），而投影把每条 `user/message` 都当用户发言渲染——包括一整块 `<system-reminder>` AGENTS.md 文档；官方 UI 把这些归类为 context-provenance 行。

## Decision

**fs 走延迟注入捕获，绝不 apply 时探测，也绝不包级 inject。** `ctx.inject(['fs'], fsCtx => { … })` 在 fs 已挂载时立即回调、在永不挂载时永不回调——store 按构造保持 memory-only，而不是像 `inject = ['fs']` 那样把整个插件 pending 消失。`sandboxPolicy` 走嵌套延迟门，且仅在到达的 fs 确实围栏时才需要。两处连带让"迟到"真正有用：store 暴露 `onFsReady`，service 在其上重置一次性的 `loaded` 标记（下一次 `ensureLoaded` 把磁盘文档合并进内存——内存对其持有的键保持权威——并把窗口期创建的记录回冲到磁盘）；`warnMemoryOnly` 从构造/读取路径挪到只在真正发生写且仍无 fs 时才打，并按 fs 缺席窗口重置。

**CREATE 继承调用会话自己的 preset。** create 路径解析 `calling.session.header.agentPreset`（每个 web 会话都有的 durable header 字段，已做 undefined 防护）→ `record.agentPreset` → `config.agentPreset` → 部署默认。RESUME 保持 `record.agentPreset`——历史是在那个组合下建的，header 注释自己的重放语义。0.2.2 的路由 options 修复原样保留，与两条路径都复合。

**投影按官方 UI 的同一分类过滤上下文注入。** `source.kind === 'agent-instructions'` 或 `source.form` 属于 KnownContextForm 集合（`instructions|catalog|snapshot|notice|relay|recall`）的 `user/message` 事件一律跳过；我们自己的发送（`kind: 'plugin'`、无 form）与普通用户消息保持可见。过滤基于 source 形状而非内容——不对消息正文做任何启发式。

**不做数据修复**（记录在案、刻意为之）：3080 上已存在的两个孤儿 side 会话 journal（无映射的 uuid 目录）按构造无法找回，留在原地无害。

## Alternatives considered

### 为什么不 `export const inject = ['fs']`（canvas 自己的写法）？

canvas 可以硬注入，因为没有文件系统的画布毫无意义；而没有文件系统的 side-chat 仍是可用的聊天（memory-only 是降级，不是失败）。包级 inject 会让**整个插件**在无 fs 组合里 pending——比被修的 bug 更糟。延迟注入两者兼得：有 fs 用之，无 fs 活之。

### 为什么不每次变更都重读磁盘，而保留 once 标记？

once `loaded` 标记存在的理由是文档是单一写入者自己的镜像——每个手势重读只买来 IO。bug 在于 fs 到达时标记不失效，而不在标记本身。fs-ready 重置保住了便宜路径，精确修掉陈旧的窗口。

### 为什么不按内容嗅探过滤注入（比如 `<system-reminder>` 标签）？

内容启发式会误伤正文里合法出现这些字符串的用户消息，也漏掉未来的新注入形式。source 元数据正是会话日志为此区分而记录的——官方投影按同样的 `kind`/`form` 字段分类，在这里过滤永远不可能与主 UI 不一致。

## Consequences

- `src/store.ts`：构造函数的一次性 `ctx.get('fs')` 改为延迟 `ctx.inject(['fs'])`，`sandboxPolicy` 走嵌套门，新增 `onFsReady` 钩子；模块与类文档写入延迟注入的理据。
- `src/service.ts`：`onFsReady` 重置 `loaded`/`warnedMemoryOnly`；`ensureLoaded` 合并磁盘入内存（内存权威）并回冲并集；`warnMemoryOnly` 仅写入时触发。`spawnAgent` 按路径拆分组合：resume 保持 `record.agentPreset ?? config`，create 继承 `calling.session.header.agentPreset ?? record.agentPreset ?? config.agentPreset`。
- `src/journal.ts`：`isContextInjection` 与 `CONTEXT_FORMS` 集合；`projectTranscript` 跳过这些 user 消息。
- `package.json` 0.2.2 → 0.2.3；`docs/packages.md` 已再生成。无依赖或 API 变更。
- M1 的 store 决策 note（[side-chat M1](../feature/2026-09-16-side-chat-m1.md)）在**一点**上被事实取代：它记录的构造时 `ctx.get('fs')` 探测在真实挂载顺序下是错的；本 note 拥有修正后的机制。

## Testing

- `packages/sidechat`：**80 个测试全绿**（原 74）：`tests/service.spec.ts`（+4——fs 迟到：首个手势 memory-only 可用，fs 挂载后的下一次手势合并并把记录回冲到真实的 `contexts.json`，跨"重启"能找到该上下文；preset 继承三态：调用 header 优先、record 兜底、部署默认，以及 resume 在新 calling header 前仍用 record preset）、`tests/journal.spec.ts`（+2——六类 context form 全跳过、无 form 的自家 plugin 发送保留）。
- `pnpm --filter @khorsheed/dsh-sidechat build`（gen-typert → tsc → tsdown）、`pnpm check:hygiene -- packages/sidechat`、`pnpm check:plugins`、`pnpm check:packages` 全绿。
- 未做：3080 真机重走（contexts.json 跨重启存活、标准模式 preset 一致、AGENTS.md 气泡消失——机制均有覆盖，手感未验）。

## Deferred

- 孤儿 journal 说明（不做数据修复，按构造如此——见 Decision）。
- 此前记录的 upstream 候选仍然开放（插件自定义转发 Remote 事件、用户消息动作座位、transcript 选区引用 seam、隐藏/折叠会话展示）。

## Related

- [side-chat 0.2.2——agentOptions 路由修复](2026-09-17-side-chat-agent-options.md)（姊妹 3080 修复；两者共享 spawnAgent 链）。
- [side-chat M1](../feature/2026-09-16-side-chat-m1.md)（本 note 修正其 store/围栏决策的一个机制）。
- [side-chat M2](../feature/2026-09-16-side-chat-m2.md)（投影所喂养的面板）。
