# Agent Note: a finished Codex command always carries its result

Status: implemented

## Problem

10-27 的一个 Codex 成员（bcc89add…）里，一条 Blender 命令崩溃了：Codex 的 rollout 记录到退出码 139，输出为空。镜像把它显示成「（工具调用被中断，未能记录返回结果）」，看起来像是镜像丢了结果，而不是命令执行失败。两条折叠路径，即 exec 流（`command_execution`：`aggregated_output`、`exit_code`、`status`）和 app-server 实时驱动（`commandExecution`：`aggregatedOutput`、`exitCode`、`status`），都只在输出非空时才把它当作结果，从不读取退出码。所以每一次没有输出的失败，以及每一次没有输出的成功，都变成了「没有结果」。仅那一轮就有五条命令受影响。

## Decision

`codex-cli-provider.ts` 里新增 `commandOutcome(output, exitCode, status)`，两条折叠路径共用。只要命令已经结束（有退出码，或状态是 `completed`/`failed`），就一定产出结果：有输出用输出，没有输出写「（无输出）」。退出码非零时会附上退出码（「（退出码 139，无输出）」），并把结果标记为失败，于是 tool/result 带上 `isError`。仍在运行的命令不产出结果，折叠会继续等待。

## Alternatives considered

- **仍然显示原来的占位文字，只把它标记为失败。** 用户还是分不清是崩溃了还是镜像丢了结果。退出码才是用户需要的事实。

## Consequences

失败的命令会显示为失败，并带上退出码。「被中断」占位只留给真正没有执行完的调用。在这次修改之前写入的日志保留原来的占位文字。

## Testing

`local-agent-codex`（258）：单元测试覆盖崩溃、有输出的失败、无输出的成功和仍在运行四种情况；另有一个 exec 流测试，把 `exit_code: 139`、输出为空的事件折叠成一条失败结果。
