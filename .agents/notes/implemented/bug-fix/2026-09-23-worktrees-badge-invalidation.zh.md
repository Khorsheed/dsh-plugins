# Agent Note: 工作树徽标跟上右栏面板（事件驱动失效，不轮询）

Status: implemented

## Problem

会话头徽标与工作树 tab 渲染的是同一个 `summary` RPC（`remote.summary(agent)` 把 `cwd(agent)` 解析成"活跃 worktree override 或会话 cwd"），但两者肉眼可见地不一致：面板显示本会话的工作树，头部却停在 `main`；头部的 dirty 计数也会滞后好几分钟。原因不是两个数据源，而是两种刷新节奏。tab 有三个触发（刷新按钮/模式切换/导航 revision 的 `rev`、切换后的版本 bump、打开 tab 时的重新挂载），徽标只有两个（挂载 + 插件自己的版本 bump），而客户端**任何地方都没有**轮询、focus 或活动触发（`grep -rn "setInterval\|visibilitychange\|addEventListener('focus'" packages/worktrees/src/client` 为空）。于是凡是"不是这个 tab 发起的"动作，已挂载的徽标一概看不见：

- **模型自己的 `worktrees_switch` / `worktrees_create` 工具**直接写 host 的 `activeWorktrees`（`src/tool.ts:87,92` → `src/service.ts:305`），浏览器侧收不到任何东西；
- 另一个浏览器 tab 切换 worktree；
- 任何外部进程改工作区（本仓库并发跑着的其他 agent），头部只能等重新挂载。

两个结构性事实让它更糟：`activeWorktrees` 是 host 的**内存 Map**（`src/service.ts:296`），每次重启（包括每次部署）都会丢指针、两个表面一起回落到会话 cwd；而 `worktrees/tool.ts` 与客户端 tab 是两个毫无失效通道的独立角色。

## Decision

徽标改为**只按真事件重读**，三条通道、零定时器：

- **插件自己的版本号。** tab 侧任何刷新都会使头部失效：tab 里加了一个 `rev` 副作用去 bump controller 版本（切换处理器里那句显式 bump 删掉了——紧随其后的 `actions.refresh()` 会 tick `rev`）。注入面每次渲染都会给出新闭包，所以副作用用 ref 持有它，不依赖它的身份。
- **宿主转发来的会话事件。** 在 apply 时订阅一次——**探针式**，不假定存在（旧 carrier 没有 `$on`）——`api-session/status(sessionId, running)` 与 `api-session/activity(sessionId, updatedAt)`，即官方 `api/remotes` 白名单里"这个会话的状态动了"的那两条，并按 session id 过滤后分发给徽标监听者。轮次边界正是"模型的工具（含 worktree 切换）刚跑完"的时刻；用户消息则代表会话活动推进。两者都是官方 `api-session/*` 事件，**不需要任何上游改动**。
- **窗口焦点 / 可见性。** 窗口重新获得焦点或从不可见恢复时重读——这是唯一能捕捉"本会话谁都没动、但仓库变了"的路径，代价是每次回来一次 RPC。

一次 summary 要跑五到六个 git 调用（`worktree list`、两次 `rev-list --count`、`status --porcelain`、两段 numstat），所以每个可见会话一条 15s 定时器约等于每小时 1500 次 git 调用；这就是不把轮询当默认兜底的上限理由。

## 为什么这两条事件够用

用户报的不一致来自**模型侧切换 worktree**，而那必然发生在 agent 轮次里——所以它后面一定跟着一次 `api-session/status` 翻转，徽标在那一刻重读。滞后的 dirty 计数来自并发 agent 改文件，这在本宿主里没有任何事件可报（见下）；它们现在会在聚焦/可见时或下一个轮次补上——这是诚实的边界，而不是传输层给不了的承诺。

## 够不到的部分

插件无法转发自己的事件：转发集合是官方 `@deepseek-ai/dsh-api-remotes` 的静态数组 `API_REMOTE_FORWARDED_EVENTS`（`packages/api/remotes/src/remote-events.ts`），由宿主装配的转发循环消费（`src/index.ts:50`）。本仓库禁止对官方包做 profile 级补丁，而且在本仓此前没有任何地方用过 `ctx.remote.$on`——原因正在于此。所以"另一个浏览器 tab 切了 worktree、我的头部要立刻知道"和"用 `fs.watch` 盯工作区、每次变化都推送"都要等上游——已登记为 seam **S16**（`docs/upstream-seam-registry.md`），并写明建议改法（让插件能向转发集合贡献，或提供一个通用插件通知通道）。

## Alternatives considered

**轮询徽标（15s，或可见时 60s）。** 作为默认方案否决：每次读要五到六个 git 进程，而上面两条转发事件已经覆盖用户报的两个症状。仅在"宿主没有转发事件"的降级路径里保留一个可见时、tab 关闭时的低频轮询作为记录在案的兜底，而不是默认。

**让徽标订阅插件自有事件（`$on('worktrees/changed')`）。** 暂时否决：需要登记为 S16 的上游改动。会话事件以零上游代价拿到大部分价值，探针则让代码对其余部分保持诚实。

**顺手把活跃 worktree override 持久化。** 否决：那是另一个缺陷（指针随 host 重启而死，部署后两个表面一起回落到会话 cwd），且需要先定持久化位置（会话记录 vs `$DSH_HOME` 文件）。**记为待办，而不是悄悄修掉。**

**让徽标直接读 tab 的 store。** 否决：徽标与 tab body 是两个独立的 slot 注册，伸手去读另一个条目的 store 不是被 sanction 的通道，而 controller 的版本订阅已经是。

## Consequences

买到：头部与面板在一个轮次边界或一次聚焦之内一致；模型侧切换 worktree 无需任何轮询就会浮现；徽标的读取成本由真实事件界定而不是定时器；缺失的通道被写成上游需求，而不是留在 bug 报告里。

付出：需要理解三条失效通道而不是一条；每个事件多一次 `summary` 读（于是一次切换总共两次——tab 的刷新加徽标的跟进，这是"头部不滞后"的价钱）；徽标按每个转发事件读一次，所以 running 频繁翻转的会话会比定时器读得更勤——但边界是真实的 agent 起停，不是墙上时钟。

## Testing

`packages/worktrees` 共 81 个测试。徽标 spec（17）新增三条失效用例：命名本会话的转发事件会重读、别的会话的事件被忽略、`focus` 会重读。插件 spec 断言两条转发事件在 apply 时被订阅、在 fiber dispose 时被释放（并断言假 carrier 上的订阅表清空）——在它学会 `$on` 之前，既有的 harness 走的正是探针的降级路径。tab spec 断言切换 worktree 后徽标被失效。

## Deferred

- 活跃 worktree override 的持久化（host 重启即丢）。
- `fs.watch` 驱动的实时 dirty 计数——卡在 S16（推送通道）与 watcher 治理（仓库根目录含 `node_modules`）。
- 上游 S16 本身；落地后 worktree 变化将变成插件自有转发事件，会话事件订阅退为兜底。

## Related

- `docs/upstream-seam-registry.md` S16——本设计绕过的"插件自有事件"缺口。
- `.agents/notes/implemented/architecture/2026-09-23-preview-kernel.md`——同包同批次的另一处改动（文件列表与工作树共用一个内容面板）。
- `proposals/active/2026-08-23-worktree-governance.md`——持有 worktrees 插件 git 面能力的提案。
