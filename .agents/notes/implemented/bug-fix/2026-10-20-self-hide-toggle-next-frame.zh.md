# Agent Note: preset 自隐 toggle 的注册切换延后到下一帧

Status: implemented

## Problem

宿主 ui-conversation 的 `refreshViews` 在任何 `conversation.view` 注册变更时重读所有已挂载会话绑定，对会话记录已释放的滞留绑定直接抛 uncaught（`conversation/assembly.ts` 的滞留绑定窗口期）。各 preset 自隐 tab 订阅 `ctx.sessions.list`，并恰恰在会话切换的同步 flush 里同步重注册——正好踩进窗口期——每次受自隐管的切换都是在赌这次 flush 不被中止。生产实证：message-timeline 时间轴（同一 flush 排在后面的订阅者）静默死亡，硬刷才恢复。上游健壮性提案见 `docs/upstream-proposals/2026-10-20-refreshviews-stale-binding-robustness.md`；我们的 toggle 是放大器，需要自己先缓解。

## Decision

凡 toggle 注册的是 `conversation.view` 条目的四个包——room（成员 tab）、datasets（题集）、eval（实验室）、mission（任务）——各自的包内 `RegistrationToggle` 副本改为把判据驱动的注册/注销放到下一帧执行（`requestAnimationFrame`，无 rAF 环境回退零延时 setTimeout），不再同步：

- 连续多次 `sync()` 合并为一次挂起帧，帧执行时读最新判据；
- `setReady(false)` 的拆除臂保持同步——取消挂起帧、当场摘掉已挂载的注册，slot（或组件）卸掉之后绝不再注册；
- 帧执行前复查就绪门。

从不碰 `conversation.view` 的 toggle 不触发 `refreshViews`，一律不动（canvas、game、library、dsh-reader、video-studio、worktrees 走 `sidebarRightTabs`；context-lens 的三个非 view 槽）。两个例外与某个 `conversation.view` toggle 共用一个类、无害地一并延后：room 的计划 tab 类型与 eval 的查看 tab 类型（都是 `sidebarRightTabs`）——为它们拆分包内副本不值。

## Alternatives considered

- **只等上游修复**：否决——提案未合入，而同步重注册是我们自己持有的那一半；宿主加固之后这层缓解也无害（只是多一帧）。
- **就绪门的挂载保持同步**（`setReady(true)` 立即注册，只有判据切换延后）：否决——它能保住首帧时机，但时序规则就要按调用点分叉，而且 slot 声明本身也可能落在会话释放的 flush 里。规则只有一条：一切走调度，拆除走取消。
- **抽共享 toggle 助手包**：被既有的副本内联规则（docs/plugin-visibility.md）否决；四个副本保持内联且一致。

## Consequences

- 四个 tab 的出现/消失比以前晚一帧——不可感知；启动时的 inventory 应答本来也是异步到达。
- 这四个包的 `conversation.view` 变更从此不在会话列表 flush 里发生，滞留绑定再也无法经它们把 flush 中止在中途。
- client spec 把 `requestAnimationFrame` 桩成零延时 setTimeout（apply spec 经既有的 `settled()` 冲刷），room 的 toggle 单测用手动帧队列。

## Testing

新增与更新的用例钉住：切换触发的注销不同步发生、下一帧生效（apply 层，datasets/eval/mission 用真实的 `list.set` 驱动会话切换）；突发合并与销毁时取消挂起帧（room 的 toggle 单测）。各包测试全绿：room 317/317、datasets 417/418（唯一失败是 `organizing-preset.spec.ts` 读 `profiles/web-eval`——并行 agent 在本共享检出里删了它，与本改动无关）、eval 1351/1351、mission 161/161。
