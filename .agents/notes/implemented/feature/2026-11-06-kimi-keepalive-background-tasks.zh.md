# Agent Note: Kimi 常驻进程在后台任务运行期间不被收回

Status: implemented

## Problem

这是设计 `proposals/active/2026-11-06-member-self-started-rounds.md`（gitignored）的 M3 步。Kimi 成员的常驻 `kimi acp` 进程在跑后台任务，live 驱动照样在空闲 30 分钟（`DEFAULT_LIVE_IDLE_MS`）后收回它。收回进程会把任务截断：Kimi 的任务文件一直写着 `running`，结果永远回不来。重新载入或换模型同样会换掉进程，而且事先没有任何提示。核心类型那一步（`2026-11-06-member-activity-core-types`）把 `keepAliveUntil` 留给了本步填。

用户 2026-11-06 定：保活上限为从成员最后一次活动算起 4 小时。

## Decision

**空闲检查**（`packages/local-agent-kimi/src/live-driver.ts`）。空闲计时器到期时，驱动先读成员的后台工作：Kimi 在跑的任务 id（`readKimiBackgroundTasks`），以及 wire 上有没有一轮 kimi 自己开、还没结束的轮次（`findOpenSelfTurn`，只看进程启动之后）。

- 没有后台工作：照旧收回。
- 有后台工作：保留进程，过 `min(空闲时长, 距上限剩余)` 再检查一次。
- 上限是 `DEFAULT_LIVE_KEEPALIVE_CAP_MS`（4 小时），从最后一次活动算起。活动指一轮或一次准备结束、在跑任务 id 集合发生变化、或有没结束的自开轮。到上限照常收回，并记一条 warn。
- 刚结束的后台工作：从发现它结束的那次检查起，再给一个完整的空闲时长，然后正常收回。
- 异步读取期间如果有一轮开始，以那一轮为准：计时器已不是该成员当前的计时器，检查就此停止。

`config.keepAliveCapMs` 和 `config.backgroundWork` 留给测试注入，生产环境用默认值和文件读取。

**`process-reclaimed`**。除插件卸载（`disposeAll`）外，每次收回都先读出在跑的任务 id，经 `config.onReclaimedWithTasks` 报出去。覆盖的情形有：空闲到上限、重新载入、`retireRuntime`（换模型）、`ensureRuntime` 模型不一致、设置切换时的 drain。`LiveDriverSwitch` 按成员保存这份记录，跨驱动代保留，只存在内存里。宿主重启后，在跑的任务一律按 `host-restart` 处理（M6）。Kimi 的 `backgroundTasks` 读取（`index.ts`）在两种情况下把有记录的任务报成 `state: 'lost'`、`lostBecause: 'process-reclaimed'`：文件仍写 `running` 而进程已不在；或 Kimi 自己已把它改写成 `lost`。没有记录的「running 但无进程」任务保持原样；其余的失去联系判定（宿主启动扫描、`process-exited`）属于 M6。

**`keepAliveUntil`**。同一次读取把在跑的任务 id 交给托管该成员的驱动（`observeBackgroundTasks`），id 有变化在驱动那边也算一次活动。有常驻进程且有任务在跑时，读取结果带上 `keepAliveUntil`（最后一次活动 + 上限），即托盘上的「进程最晚保留到 HH:MM」。

**自愈推迟**。`retireIfToolsStale`（进程缺模式工具时在轮次开始前重启进程）遇到有后台任务在跑，就保留进程、记一条 warn，等下一轮开始时再看。

**重新载入的确认**（改核心，这是让房间能先问一句的最小改动）。设计要求「重新载入」这个操作先确认「会让 N 项后台工作失去联系」。

- `registry.reloadMemberTools(childSessionId, options?)` 和网关 Remote `reloadMemberTools(childSessionId, options?)` 接受 `LocalAgentMemberToolsReloadOptions { confirmBackgroundTasks?: boolean }`。
- 没带确认、且成员的活进程有后台任务在跑时，返回 `{ ok: false, reason: 'background-tasks', running: N }`，什么都不做。
- `running` 数的是 `memberBackgroundTasks` 里 `state: 'running'` 的任务，只在 `supported` 且 `processAlive` 时计数。
- 房间确认后带 `{ confirmBackgroundTasks: true }` 再调一次。
- 没有 `backgroundTasks` 的 harness 不会被拒绝。成员没有进程时的「立即载入」也不会被拒绝：没有进程，就没有任务会被截断。

**换模型**。保存模型走成员配置控制器（`apply` → `retireMemberRuntime`），不走重新载入。驱动不拦这条路：拦下来会让已保存的选择和进程对不上。这个操作的确认由房间在保存前读现有的 `memberBackgroundTasks` Remote 来做：看 `processAlive` 时有没有在跑的任务。被截断的任务由驱动记为 `process-reclaimed`。

## Alternatives considered

**在驱动的 `reloadMember` 里拒绝**。这个 harness 钩子是同步返回的，而读任务文件是异步的，用缓存的计数可能已经过时。改钩子的返回形状还会让旧核心把拒绝对象当成句柄来用。在核心里检查，复用的是已有的 harness `backgroundTasks` 读取，以后的 harness 也都适用。

**在两次空闲检查之间轮询任务文件**。那是 B② 的观察器（M4 步），只在有后台工作时开启。保活只需要在空闲时长到期时看一眼，再加上托盘本来就会做的读取。

**把收回记录持久化**。设计规定重启后在跑的任务一律算 `host-restart`。持久化的 `process-reclaimed` 会和这条规则打架，也换不来什么。

## Consequences

- **在房间 M2 发送确认之前，对有后台任务在跑的成员点「重新载入」会被拒绝。** 现有的 `MemberToolsLine` 没有 `background-tasks` 的文案，点了之后界面上看不出任何反应。M3 要和 M2 一起上线，或者在 M2 之后上线。
- 模型如果起了一个永远不结束的后台任务（`tail -f`、开发服务器），进程最多从最后一次活动起保留 4 小时。
- 插件卸载仍然直接结束所有进程、不留记录；下次启动时这些任务按 `host-restart` 读。
- 旧核心搭配这个 Kimi 包：核心从不传这个选项，也就从不拒绝，重新载入行为和原来一样，只有空闲保活和收回记录生效。

## Testing

- `packages/local-agent-kimi/tests/live-driver.spec.ts` 的 "background tasks keep the resident process (keep-alive)" 一组，用假时钟：
  - 有任务在跑 → 过了空闲时长进程仍在，`observeBackgroundTasks` 给出上限以内的截止时间
  - 到上限 → 收回，并报出 `bash-1`
  - 新起一个任务 → 上限重新计时
  - 有没结束的自开轮 → 保留
  - 任务结束 → 再给一个空闲时长，然后收回、不留记录
  - 没有后台工作 → 到空闲时长就收回
  - 有任务时重新载入 → 留下记录；卸载 → 不留记录
  - 默认的文件读取 → 任务文件写 `running` 时进程保留，改成 `completed` 后放行
- `packages/local-agent/tests/member-tools-status.spec.ts`：两个任务在跑 → 拒绝并返回 `running: 2`，没有重新载入；带确认 → 重新载入；进程已不在 → 不拒绝。
