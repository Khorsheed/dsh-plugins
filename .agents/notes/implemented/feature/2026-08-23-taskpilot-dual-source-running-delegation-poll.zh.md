# Agent Note: taskpilot 一次性委派行的双源 running 判定

Status: implemented

[English](2026-08-23-taskpilot-dual-source-running-delegation-poll.md) | 中文

## Problem

taskpilot 胶囊的中止按钮只在官方 session summary 标记为 running 的行上渲染。local-agent 家族的一次性外部 CLI 委派(kimi/codex/claude/dsh)的子会话永远没有 live agent,因此 summary 的 `running` 标志恒为 false,中止按钮从不出现——尽管自 codex-exec-usage-fallback 之后 host 侧停止链路(`/taskpilot-interrupt` → `/local-agent stop <childSessionId>`)已经就绪。用户看着一个在飞的外部 CLI 委派,却只能看到一个已结算的行,无法从胶囊中止。

第二个小缺口:`/taskpilot-interrupt` 命令注册时没有声明 `input` hint,手打带参数的行不会被 composer 拦截(palette 点选正常,因为它直接派发整行)。

## Decision

### 1. 来自家族委派轮询的双源 running 判定

dock 子代理行的 running 判定改为双源:`summary.running === true || activeSet.has(child.id)`。`activeSet` 来自对 local-agent 家族只读 Remote(`localAgentGateway.activeDelegations()`,返回在飞子会话 id 数组)的轮询,在有后代行展示期间每 1.5s 一次。注入的轮询函数(`TaskPilotDockInjected` 上的 `pollActiveDelegations`)在 client apply 闭包里通过鸭子类型读取器接线——不 import local-agent 的任何包,不加 manifest 依赖。所有失败模式都按空集处理:通道不存在(家族未安装——`ctx.get('remote.localAgentGateway')` 得 undefined)、调用异常、或非 ok 结果。家族缺席时第二源是严格空操作,行为与单源 dock 完全一致。行遍历(`collectDescendants`)把 active 集作为可选的第三个参数,默认空;胶囊的 running 计数改为从双源行遍历(`runningSubagents.length`)推导——它是官方索引计数的严格超集,因此胶囊圆点与弹层行对一次性委派也保持一致。

中止动词本身不变:行上的中止按钮仍派发 `interruptSubagent(child.id, child.parentId)` → `/taskpilot-interrupt` →(无 live agent)`/local-agent stop <childSessionId>`。

### 2. `/taskpilot-interrupt` 的 input hint

命令注册补上 `input: { hint: '<child-session-id> [parent-session-id]' }`,composer 会像对待 `/local-agent`、`/mission` 一样宣传并拦截自由格式参数行。

## Alternatives considered

- **taskpilot 自己 `$mount` 家族命名空间 vs 鸭子类型读取**:taskpilot 必须能单独安装;`$mount` 一个不属于自己的命名空间会与家族自身的 mount 冲突,把两家插件绑在一起。按 key 读取已挂载的命名空间保持插件独立——兼容契约就是「家族缺席 = 不可见」。
- **只在子 agent 弹层打开时轮询 vs 只要有行就轮询**:只弹层轮询更省,但胶囊的 running 圆点由同一个双源计数驱动,而「行」正是用户要求作为门控的单元;只要存在任何后代行就轮询,能在 dock 完全没有子 agent 数据时不空转,同时让圆点保持真实。
- **胶囊计数用官方索引 vs 双源行遍历**:官方 `runningCount` 完全漏掉一次性委派,一个唯一在跑的工作是 CLI 运行的会话会不显示圆点;对同一谱系的行遍历是严格超集,且正是弹层实际渲染的计数。
- **通道缺失时硬失败 vs 软失败**:没有 local-agent 就抛错会把每个未装家族的用户的 boot 打崩——degrade-don't-explode 规则优先;轮询解析为空集,中止动词通过既有 seam 错误降级。

## Consequences

- 一次性 local-agent 行在委派在飞期间显示中止按钮,结束后自动回落,且不新增任何 host 逻辑——复用既有 `/taskpilot-interrupt` → `/local-agent stop` 链路。
- 两家插件保持完全独立:taskpilot 不新增对家族的 peer/dev 依赖,不 import 其任何代码;唯一耦合是服务 key 字符串与鸭子类型方法名。plugin-independence 门保持绿色。
- 代价:有子 agent 行的会话每 1.5s 一次 Remote 调用(家族网关只读、不产生会话事件,轮询不会在日志里留命令节点);行 running 状态相对委派开始/结束最多滞后一个轮询间隔。
- 带参的 `/taskpilot-interrupt` 现在能像其它带 hint 的命令一样从 composer 解析;handler 语法不变。

## Testing

- `active-delegations.spec.ts`:软失败轮询在通道缺失、调用抛错、非 ok 结果、缺 value 时都解析为空集;ok 时返回 id 数组。
- `taskpilot-dock.spec.tsx`:一次性行(summary `running: false`)在轮询报出它的 id 后渲染中止按钮,委派离开 active 集后掉落(fake timers),空轮询时保持单源行为,无子 agent 行时不轮询。既有行测试在 `act` 内 flush 挂载 tick,保持 React 警告安静。
- `host-interrupt.spec.ts`:注册携带 input hint。
- 套件:taskpilot 47/47;hygiene 与 plugin-independence 门全绿。
