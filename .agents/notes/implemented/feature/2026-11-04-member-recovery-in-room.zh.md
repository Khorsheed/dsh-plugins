# Agent Note: 在协作间里恢复卡住的成员，安全的启动失败自动重试

Status: implemented

## Problem

2026-11-04（生产）一个 Kimi 成员跑到一半时宿主重启了。它的 `kimi acp` 留下了过期的会话锁，下一次原生启动（`session/load`）报「This session is in use by another Kimi Code CLI instance」。`member-control.ts` 把成员配置记成 `failed`。原生启动失败要等用户处理；只有 `admissionFailed`（准入自己的配置检查拒绝）会自动复查。之后每一轮、以及房间里的「立即载入」都在 0 毫秒内带着旧错误失败。唯一的出路是「对账并重试」。这个按钮只在成员自己会话的输入框里，藏在模型下拉中（`MemberConfiguration.tsx`），用户在协作间里找不到。重启留下 `uncertain` 的一轮（第 5 批 S4）也有同样的问题：它的「待对账」控件只在成员页。

## Decision

1. **核心区分可自动重试的启动失败。** `types.ts` 导出 `LocalAgentRetryableStartError`、标记常量 `RETRYABLE_START_FAILURE`（`'localAgentRetryableStart'`）、`BEFORE_PROMPT_FAILURE`（`'beforePrompt'`）和 `isRetryableStartFailure(error)`，包根也再导出一份。判断函数按普通属性查这两种标记（`=== true`），查错误本身和最多四层 `cause`。Kimi 的 `KimiSessionOccupiedError`（main a9369a97a）已经带 `beforePrompt: true`，所以只要这个错误原样或作为 `cause` 传到核心，Kimi 的会话被占用失败不用改 Kimi 就会自动重试。所以按另一份核心打包的 provider，或者根本不导入核心的 provider，也能标记失败。`MemberConfigurationController.rejectAdmission(error, recheck)` 的 `recheck` 默认取 `isRetryableStartFailure(error)`。被标记的失败存成 `admissionFailed`，重启后还在。成员的下一次准入（下一条消息、协作间派活、立即载入）先对账再重试一次启动，和 5d4f 的拒绝路径一样。没有准入就不会重试。失败的那一轮本身绝不重跑。`run.result` 里的失败（run 已经返回之后）根本到不了 `rejectAdmission`。被取消的启动不算失败。没标记的失败仍然等用户。
2. **给 provider 的约定。** 只在一轮的 start（返回 run 之前）或 `prepareMember` 里抛 `LocalAgentRetryableStartError`（或设任一标记），而且只在还不可能有提示发给模型时抛。它的 `message` 显示在「上次启动没有成功：」后面，要写成平常话。Kimi 过期锁的修复在启动路径里清不掉锁时，已经抛带 `beforePrompt: true` 的错误；改成抛 `LocalAgentRetryableStartError` 只是把意图写得更明白。
3. **立即载入 / 重新载入先恢复。** `MemberConfigurationController.startFailed()` 判断「`failed` 且没有待生效的选择」。这表示原生启动或准入被拒，而不是没生效的模型/思考强度选择（那种选择留在 `pending`）。这个判断也能覆盖本次改动之前写下的记录，比如生产上那个成员的记录。`reloadMemberTools` 在两条路径之前都先调新的 `recoverFailedStart(binding)`，也就是先 `retry`。重试仍失败时回 `{ ok: false, reason: 'start-failed', error }`，什么也不启动。立即载入自己的启动失败时，原因现在记在 `lastReload.error`（`MemberToolsFace.reloadDone` 新增可选的 `error`，`MemberToolsTracker`）。
4. **协作间的编辑窗口显示恢复入口。** 新组件 `MemberRecoveryLine`（纯状态在 `member-recovery-view.ts`）放在「模式工具」那一行下面，同样是 12px 的字号，复用那一行的样式类。它读网关的 `memberConfiguration` 和 `memberInbox`，每 3 秒轮询。启动失败时显示「状态 ⚠ 上次启动没有成功」、provider 给的原因、「对账并重试」（按读到的版本调 `retryMemberConfiguration`），再加一句说明：之后的消息照常送达，没成功的那一条不会自动重发。没生效的选择写「上次的模型设置没有生效」。账本里 `uncertain` 的一行显示「待对账」，附上来源或输入的文字、一个核对结果输入框，以及「确认已完成 / 确认已取消」（`controlMemberInbox` 的 `reconcile`，和成员页同一语义）。四个网关调用都在 `membersFace` 里按鸭子类型探测，没有 local-agent 时这一块不出现。窗口里的「立即载入 / 重新载入」读到启动失败时也先对账并重试（`MemberToolsLine.recover`）。这样旧核心也能覆盖到；控制已经恢复时，再重试一次什么也不做。重试仍失败时，这一行显示「上次启动没有成功：<原因>」，不再请求载入。

## Alternatives considered

- **下一次准入时自动重试所有失败的原生启动。** 不采用。核心分不清 provider 失败前有没有发出提示，重发提示就是把付费的工作做两遍。只有 provider 知道，所以由 provider 来标记。
- **在记录里新加一个失败类型字段。** 第 3 项不采用。「failed 且没有待生效的选择」已经能区分启动和选择，还能给磁盘上已有的记录分类。
- **在窗口里直接渲染 local-agent 自己的 `MemberConfiguration` / `MemberInboxView`。** 不采用。它们是按输入框的形状做的（下拉 chip、队列列表），放进窗口里样式对不上。房间和 local-agent 之间也继续保持可选的读取、自己渲染，和「模式工具」那一行一样。

## Consequences

- `LocalAgentMemberToolsReload` 多了 `start-failed`，`lastReload` 多了 `error`。旧版房间会忽略这两项。
- provider 一侧（`packages/local-agent-kimi`）这里没有改。在它抛出可重试类型之前，过期锁仍然要等用户处理。不过用户现在能在协作间里恢复，立即载入一次点击就能恢复。

## Testing

- `packages/local-agent/tests/member-controls.spec.ts`：新增 7 个测试。可重试的启动失败由下一次准入重试，重启后也一样。仍然可重试的失败每次准入试一次。普通失败等用户，不启动就失败。run 返回后的可重试错误什么也不改。被取消的启动不算失败、不重试。失败的选择不算启动失败。标记能穿过 `cause` 读到，不需要那个类。
- `packages/local-agent/tests/member-tools-status.spec.ts`：新增 4 个测试。立即载入先重试失败的启动再启动。重试仍失败时回 `start-failed` 和新原因，什么也不启动。恢复后启动又失败时带上 `lastReload.error`。重新载入也先恢复，没生效的选择不动。
- `packages/room/tests/member-recovery.client.spec.tsx`：新增 12 个测试。覆盖状态折叠、启动失败块（按版本重试、已恢复提示、仍失败）、选择失败的措辞、待对账（必须填核对结果、对账参数）和无事可恢复。在窗口里覆盖：恢复块就在立即载入旁边，立即载入先 retry 再 reload，重试失败时显示原因、不载入，没有 family 时没有这一块。另外覆盖 `startError` 折叠和英文文案。
- 截图：窗口在 1280 和 390 宽度下的启动失败和待对账两种状态，来自 `packages/room/tests/preview/member-tools.html?state=recoveryFailed|recoveryUncertain`。
- 未验证：真实的 Kimi 过期锁、3080 线上实例、窗口连真实网关。
