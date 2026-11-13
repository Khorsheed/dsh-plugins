# Agent Note: 立即载入补齐可选参数并显示失败原因

Status: implemented

[English](2026-11-14-member-load-now-gateway-arity.md) | [中文](2026-11-14-member-load-now-gateway-arity.zh.md)

## Problem

房间成员编辑器的「立即载入」可能看起来毫无反应。`reloadMemberTools` 声明 `(childSessionId, options?)`，Remote 网关的精确参数个数校验也计算这个可选参数。没有确认选项时，客户端只发送 `childSessionId`，请求因此报 `expected 2 argument(s), got 1`，没有启动成员进程。

随后，客户端把 Remote 否定结果和网关抛错都丢掉，返回 `undefined`。按钮对宿主的 `unknown-member` 拒绝也没有可见分支，所以失败既不改变状态，也不显示原因。

## Decision

- `reloadThroughGateway` 总是调用 `(childSessionId, options)`，没有选项时也显式发送 `undefined`。保持现有 Remote 签名，也兼容忽略该可选参数的实现。
- Remote 否定结果或抛错转换为已有的 `start-failed` 结果，保留网关给出的原因。成员工具行显示这个原因；没有原因时使用原有的通用启动失败提示。
- `unknown-member` 与其他明确拒绝一样处理，提供中英文提示：关闭后重试，或先发一条消息让成员恢复。
- local-agent 核心、provider 的进程启动行为和宿主均不修改。

## Alternatives considered

**放宽网关接受单参数。** 会削弱共享协议，也解决不了错误被吞掉的问题；调用方本来就有可选值可传。

**只修参数个数。** 将来网关失败或 `unknown-member` 仍会让按钮看起来没有变化，错误路径必须可见。

**让房间直接启动进程。** 会绕过成员通道的身份、准入和工具记录；正确调用现有 Remote 操作才是它该负责的路径。

## Consequences

成员可启动时，按钮现在能到达真正的启动操作。其他拒绝和网关失败会显示在原地，不再被误认为没有执行。协议、持久化格式和 provider 行为均不变。

## Testing

修复前，严格的二参数网关 mock 使旧的无选项调用失败并返回 `undefined`，复现了静默分支。修复后，同一 mock 成功，并在第二参数位置收到 `undefined`。测试还覆盖 Remote 否定结果、抛错、可见的网关错误和 `unknown-member` 说明。

Room 62 个测试文件、739 项通过，包括原有的启动成功、载入中、恢复和后台确认场景。
