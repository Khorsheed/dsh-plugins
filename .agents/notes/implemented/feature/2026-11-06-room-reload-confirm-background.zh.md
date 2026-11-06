# Agent Note: 替换正在跑后台工作的成员进程前，房间先确认

Status: implemented

## Problem

Kimi M3（`2026-11-06-kimi-keepalive-background-tasks`）让核心在成员的常驻进程还有后台任务在跑时拒绝重新载入：调用方不带 `confirmBackgroundTasks: true`，核心就答 `{ ok: false, reason: 'background-tasks', running: N }`，什么也不做。设计（`member-self-started-rounds` C①）要求房间对这类操作原地确认：「会让 N 项后台工作失去联系，继续吗？」。

房间之前没法把确认传下去。改动之前，它的 重新载入 / 立即载入 那一行遇到这个新的拒绝时什么都不显示。编辑弹窗里保存模型也会换进程，驱动又不拦这种退役，所以房间得在保存前自己先问一句。

## Decision

- **请求。** `slots.ts` 里的 `reloadMemberTools(childSessionId, options?)` 现在接受 options。`client/index.ts` 改为通过新的 `reloadThroughGateway`（`member-tools-view.ts`）发出请求：它把 options 原样传下去；没有家族、没有这个方法、或读取失败时，降级为 `undefined`。旧核心直接忽略 options。
- **共用的确认条。** `BackgroundConfirm`（`MemberActivity.tsx`）是原地的警示色一行：「⚠ 会让 N 项后台工作失去联系，继续吗？」，带 取消 / 继续。出现时滚进视野，焦点落在「继续」上。
- **重新载入 / 立即载入**（`MemberToolsLine`）。收到 `background-tasks` 就打开确认条。点「继续」，带上 `{ confirmBackgroundTasks: true }` 再请求一次；点「取消」，收起确认条，不再发请求。
- **保存模型**（`InviteDialog`，编辑模式，已有会话的 CLI 成员）。模型或推理强度改了时，先调 `runningBackgroundTasks(childSessionId)`。数目大于 0 就显示同一个确认条，点「继续」之前什么都不保存。
  - 这个数目是对 `memberBackgroundTasks` 的一次新读取（`MemberActivityStore.readNow`）。只数 `running` 的任务，而且只在进程还在时才算（`runningBackground`）。没有进程就没有东西会被切断，数目为 0。
  - 没改模型的保存不读。

## Alternatives considered

**直接用轮询 store 里的计数，不另读一次。** 弹窗可能在第一次轮询之前就打开了，缓存的数目也可能晚 4 秒。保存时单独读一次只多一个请求，回答的是进程此刻的状态。

**让核心像拒绝重新载入那样拒绝换模型。** 协调者这一步排除了这个做法：驱动不拦模型退役。所以这个问题就放在人改模型的唯一入口上问。

## Consequences

- 目前只有房间的界面会确认。成员输入框里 local-agent 自带的模型控件还不会问。
- 读取失败时数目按 0 处理，保存直接进行、不弹确认。降级方向和没装家族时一样。

## Testing

- `packages/room/tests/background-confirm.client.spec.tsx`（11 个用例）覆盖：
  - 重新载入：被拒、确认、带选项重试；
  - 取消后不再重试；
  - 立即载入同样处理；
  - 英文文案；
  - 保存模型：有后台工作时先确认、不保存，点「继续」才保存；取消；没有后台工作；没改模型时不读；
  - `runningBackground` 与 `readNow`；
  - `reloadThroughGateway` 带选项、不带选项，以及各种降级。
- 预览页 `activity.html?state=confirmReload|confirmSave` 在 1280 和 390、浅色和深色下截过图。
