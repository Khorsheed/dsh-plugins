# Agent Note: boot 代际刷新等新进程组合结算

Status: implemented

[English](2026-09-18-ankh-guard-generation-reload-readiness.md) | 中文

## Problem

boot 代际通道只要 boot id 陈旧、且没有活跃 cutover 就回 `ready/reload`，而它可达的时刻是共享的 `webServer` 服务刚出现时——也就是端口刚监听时。watchdog 自己的日志写明了这个被忽略的区别：`transport up on :3080 (HTTP 404); application readiness still pending` 比 `instance ready` 早若干秒。

被刷进这个窗口的标签页，其第一次、也是唯一一次会话列表拉取，正好撞上后继进程还在挂载的行。prod 3080 上的现象：ankh-guard 重启后左侧会话列表只剩重启时被召回的那个会话，手动整页刷新才恢复完整列表。

这个失败的客户端一侧属于宿主，本次没有改动：

- `session-controller` 的刷新把一次成功的列表响应当作权威成员表（`mergeOrderedBaseline` 会移除 baseline 里没有的身份），且只在 `connection/reset` 重拉——没有任何重试定时器。
- 刚 reload 的页面没有可兜底的既有行，所以第一次拉取失败或为空就等于空表；之后只会出现宿主实时宣告的行（`api-session/added`），即重启后恰好是被召回/恢复的那个会话。
- 宿主自己也基于同一理由把浏览器交接 gate 在 Loader 结算上（`packages/bundle/web-app/src/index.ts`：浏览器「一打开就请求页面」，因此它「不能在 `/api` 路由 owner 之类兄弟行还在挂载时发生」）。

这是自动刷新的回归，不是宿主的回归。此前部署的 ankh-guard（0.1.0/0.1.1/0.1.2 的 tarball）**没有浏览器半边**——没有 `lib/client.js`、也没有 `dsh.client`——所以普通重启只是 WebSocket 静默重连，驻留页面重拉失败仍保留已有行。代际通道随 0.3.0 上线（`0f776cc3`，2026-09-11 发版，2026-09-15 首次装机）。

## Decision

**代际回答先等后继进程的 Loader 树结算。** `packages/ankh-guard/src/browser-handoff.ts` 的 `applicationReadyProbe` 在注册路由时读取 `ctx.get('loader')?.await()`，仅在兑现时置为就绪；没有 Loader 的组合本来就完整；结算失败则保持未就绪，因为那属于 watchdog 崩溃恢复的路径，而不是一次页面加载。

**滞留期回 `{ state: 'waiting' }`，且不带 boot id。** 客户端在按状态行动之前就会把 boot id 存下，所以这里一旦下发后继进程的 id，就会消费掉标签页一次性的代际判定，把它困在那个不可用的页面上。不下发则已存 id 保持陈旧，客户端在既有的重启遮罩下每 250 ms 重问，结算后的第一次 poll 即刷新。

cutover 优先级不变：活跃 cutover 时仍由 receipt 通道先判定、仍由它掌控节奏。

## Consequences

- 重启恢复会晚掉后继进程剩余挂载时间（数秒），期间标签页显示既有重启遮罩。不会有损失：poll 循环本来就按 250 ms 重试。
- 对旧客户端线协议不变：不带 `cutoverId` 的 `{ state: 'waiting' }` 只会重试，不会刷新。
- 标签页现在也能扛住组合结算失败的后继进程：它原地等待而不是加载一个垂死进程，下一个健康进程（新 boot id）自然会触发刷新。

## Alternatives considered

**用既有的长轮询机制把请求一直挂到就绪。** 否决：挂起响应路径会继续落入代际前/idle 分支，而那个分支是**带** boot id 回答的；超过 25 秒窗口的一次挂起正好落进该分支，同样消费掉代际判定。

**把结算被拒也当作就绪。** 否决：app-boot 把 pending 行视为致命启动失败，所以「结算失败」意味着进程正在退出——刷回去等于用一个坏页面换掉截断的列表；而 watchdog 重生的新进程会回答仍然陈旧的 poll。

**给等待加超时上限，避免遮罩卡住。** 否决：会卡住遮罩的情形就是实例不健康（同一个致命 pending 条件），而超时恰好会在树加载慢时重新引入过早刷新。

**改客户端、让列表拉取重试。** 客户端属于上游宿主；而它声明的那条不变量——浏览器只能在树结算后进来——正是 guard 违反的。守住刷新时机对每一个插件驱动的刷新都恢复了那条不变量，而不只是会话列表。

## Testing

两条用例钉住握手的两半：

- `packages/ankh-guard/tests/browser-handoff.spec.ts` —— 陈旧 id 配 `applicationReady: () => false` 时回 `{ state: 'waiting' }` 且不带 boot id；同一条陈旧 poll 在探针翻转后刷新，且 ready 响应仍带着后继进程的 id。
- `packages/ankh-guard/tests/browser-handoff.client.spec.ts` —— 线上客户端接受滞留响应、不刷新、用**同一个**陈旧 `knownBootId` 重问，并在随后的 ready 回答上刷新。

`scripts/run-test-lane.mjs` 的泳道清单随之更新（`pure`：57 → 59）。

未覆盖：会话列表被清空的原因本身，它位于宿主客户端（权威 baseline + 不重拉）。该现象在实例上观察到，并在上文按宿主源码标注；这里只断言 guard 侧的触发点。
