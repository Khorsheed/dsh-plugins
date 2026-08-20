# Agent Note: mission — Typert Remote 驱动的 web 会话 tab（里程碑 M4）

Status: implemented

[English](2026-08-19-mission-m4-tab.md) | 中文

## Problem

[mission 提案](../../../proposals/active/2026-08-19-mission-tasks.md)预留了 web 会话 tab（「会话 tab」一节及 ASCII 草图）作为人的队列面：五桶筛选 chip、默认本会话的 run 选择器、任务表、行详情面板、以及与 CLI 同闸的导出按钮。在 [M1](2026-08-19-mission-m1.md)、[M2 slash](2026-08-19-mission-m2-slash.md)、[M2 export](2026-08-19-mission-m2-export.md) 之后，tab 是 v1 最后一块界面——按 datasets tab 定型的范式交付：宿主侧 `TypertRemoteService` 数据面 + 注册进 `conversation.view` 的浏览器半。

## Decision

**宿主**（`src/remote.ts`）：`MissionRemoteService extends TypertRemoteService`，cordis key `missionRemote`，wire 命名空间 `mission`，由插件 apply 挂载。每个方法首参是调用方 agent，所有可选选择器进请求对象（exact-arity 教训）。`queue` 默认只看调用会话发起的 run（`all` 放宽、`runId` 指定、`buckets` 过滤）；`get` 返回行详情（wire 变体 `MissionAttemptWire`/`MissionAnnotationWire` 把 `unknown` 收紧为 `JsonValue`——生成器拒绝边界上的裸 unknown）；`retry` 记 `tab:<sessionId>`；`isReleasable` 透传服务判定。导出对拆开泄题闸：`exportPlan` 解析 guarded 层（挂载 datasets 时探针 + 显式声明叠加）返回触发清单；`exportRun` 用**全新** plan 复核调用方的 `confirmed` 清单，未确认的 guarded 层一律拒绝——过期对话框绝不会放行已变的层集。

**边界类型**：Remote 请求/响应类型全部住在 `src/types.ts`，经公开的 `./types` 子路径导出（生成器的「公开非根类型子路径」规则；`./src/*` 不算）。生成的 `lib/typert.remote-client.js` import zod，故 zod 是运行时依赖（datasets 先例）。

**client**（`src/client/`）：`conversation.view` 入口 id `missions`、order 35，照 datasets 解剖——inject `['slots', 'remote', 'locale']`，`$mount` 后 `ctx.get('remote.mission')` 读回，store 工厂（绝不用模块级单例），`mission` 命名空间的 zh/en 词典。视图按草图：桶 chip（多选）、run 范围选择器（默认本会话 / 全部 / 单个 run）、表格（# / 标题 / 桶 / 模板状态 / 计划阻塞 / 时长——时长取自 `enteredCurrentAt`）、每 run 的未释放警示、详情面板（attempt/检查点/注解计数）配重跑 + 释放检查 + 导出。导出对话框是闸的 web 形态：先检查（plan）→ guarded 层逐项 checkbox → 全部勾选后导出才可用。

**构建面**：包切到 datasets 布局——solution tsconfig + `tsconfig.host.json`/`tsconfig.client.json`，tsdown 走 `clientBundle('@khorsheed/dsh-mission', [...])`，`scripts/gen-typert.mts` 注册，官方六件套 `dsh.client` inject，build 脚本 `gen-typert && tsc -b && tsdown`。

与草图的出入（如实）：没有提交产出按钮（产物上传管线不在 Remote 面范围内；工具/CLI 覆盖 submit）；导出对话框写到人输入的宿主侧目录（浏览器选不了服务器路径）。

## Alternatives considered

- **Remote 方法名用 `export`**——否决：作属性合法，但对代码生成的 client 来说离关键字太近；拆为 `exportPlan`/`exportRun`。
- **信任对话框的确认**——否决：宿主重新 plan 并对全新 guarded 清单复核 `confirmed`，被篡改或过期的 client 无法把 guarded 层滑过去。
- **模块级 store 句柄**——按 datasets note 否决；工厂让每个入口有自己的 store 身份。

## Consequences

- 四个面加 tab 共享同一服务内核；tab 的写（retry）在 history 里记 `tab:<sessionId>`。
- 在 0.1.0-rc.8 时代的 web profile 上活冒烟（自建 :3091 实例）：tab 注册并渲染（chip、范围选择器），wire 命名空间应答类型化 RPC 信封。队列成功路径没能活体走通——共享 $DSH_HOME 里全部预存 demo 会话都因早前 datasets 联调留下的日志损坏（torn JSONL / 本 harness 不认识的 `datasets/binding` 事件）无法 resume，而新会话需要该实例没有的模型 key；成功路径由进程内 Remote spec 与视图 spec 覆盖。
- `package.json` 新增 `./client`/`./typert`/`./remote`/`./types` exports 与 zod 运行时依赖；`dsh.compat` notes 更新为 tab 已交付（仅 web，headless 提供 Remote 无消费方）。

## Testing

`tests/remote.spec.ts`（5 个，宿主面）：queue 作用域（默认本会话 / all / buckets / runId）、get + retry 归属、isReleasable、exportRun 复核拒绝未确认的 guarded 层再放行已确认导出、datasets 探针供给 guarded 层。`tests/apply.client.spec.ts`（5 个）：inject 声明、Remote 挂载 + 入口注册、挂载失败韧性、注入面把六个动词绑定到带会话 id 的命名空间、拆卸收起。`tests/MissionsView.client.spec.tsx`（6 个，jsdom + 真 store）：表格渲染（桶/模板状态/计划/时长列）、chip 多选驱动请求、范围放宽、详情面板 + 重跑/释放检查通知、未释放警示、导出对话框在逐项确认前锁住导出。套件：113/113；bin 冒烟（构建产物）保持通过。

## Cross-references

- [Mission 提案](../../../proposals/active/2026-08-19-mission-tasks.md)——本 note 实现的「会话 tab」一节与草图。
- [mission M2 export](2026-08-19-mission-m2-export.md)——tab 导出对话框复用的闸合约；[mission M1](2026-08-19-mission-m1.md)——服务内核。
