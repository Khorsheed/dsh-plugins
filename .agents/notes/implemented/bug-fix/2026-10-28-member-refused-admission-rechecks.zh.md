# Agent Note: a member's refused admission is rechecked on the next admission

Status: implemented

## Problem

房间 5d4f0d41 的 Codex 成员被模型目录的旧思考强度规则拒绝（"Codex has not advertised this reasoning effort…"），成员配置随即存下了 `status: failed`。修好的规则上线后，每次派活仍然 0 毫秒就失败：下一次准入根本没有再问适配器，直接读了存下的旧结论。只有成员卡片上的「对账并重试」按钮能清掉它，而界面上没有任何提示让用户去点。

## Decision

如果失败是 `admit` 自己的配置检查记下的（适配器的 `prepare` 拒绝，此时还没有启动任何进程），记录上就打一个 `admissionFailed` 标记。下一次准入会先走和那个按钮相同的 `retry` 路径：对账，再重新检查一遍。如果仍然被拒，这一轮会以当前的原因失败，标记也重新打上。标记是持久化的，所以修复上线时的宿主重启不会把它丢掉。

以下两种失败仍然要等用户处理：

- 进程启动失败（`MemberControls.runNow` 里的 `rejectAdmission`，对应 spawn-failed 那个用例）；
- 配置切换没有应用成功（`drain` 失败）。

前者自动重试可能会反复拉起进程；后者是用户的配置意图，用户需要看到它失败了。

## Alternatives considered

- **准入时对所有失败状态都重新检查。** 那样进程启动失败会变成重试循环，失败的配置选择也会被悄悄重新应用。

## Consequences

导致配置被拒的原因（模型目录的规则、目录本身或端点）修好之后，这类失败会自己恢复。本次修改之前写下的记录没有这个标记，仍需要手动重试一次。

## Testing

`local-agent`（421）：member-control 新增两个用例。第一个让准入连续被拒两次，然后由一个重新加载记录的控制器重新检查并准入成功；第二个确认配置切换应用失败后仍然保持失败。member-controls 里 spawn-failed 那个用例照旧拦住第二次启动。
