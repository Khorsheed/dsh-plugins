# Agent Note: member-channel 恢复 token-only 认证（宿主 0.1.5）

Status: implemented

[English](2026-09-10-member-channel-token-only.md) | 中文

## Problem

宿主 0.1.5 移除了 `SubprocessHandle.pid`（managed-range 抽象接管进程身份）。member-channel 的 bridge 回调原本由 per-run token 加「与所产 CLI 的 pid 交叉校验」双重认证——pid 从此无从供给。第一批适配（[host 0.1.5 breaking 适配](2026-09-10-host-015-breaking-adaptation.zh.md)）按 fail-CLOSED 处理：没有 pid 可绑定时一切回调按外来进程拒绝，CLI 成员互发消息整体停摆。[认证加固提案](../../../proposals/active/2026-09-10-member-channel-auth-hardening.md)把跟进拆成 M1（先恢复 token-only 投递）与 M2（之后上真正的第二因子）。

## Decision

per-run token 重新成为唯一凭证。wire 上去掉残留的 `pid` 字段（`{ token, to, text }`——bridge 不再发送 `process.ppid`），`MemberChannel.handle` 把 token 解析到注册的在飞 run 后不再查别的，`LocalAgentMemberRun` 删掉 `cliPid`。`bindMemberRunPid` 是删除而非保留：没有任何生产方能供给 pid 时，它是读着像第二因子的死代码；M2 落地时会带自己的凭证面。token 的全部既有强度原样保留：逐 run 铸造（fresh 与 resume 轮一样）、只经 0700 scoped home 里的 CLI 作用域 MCP 配置下发、settle 即焚。

威胁模型写进包 README 的已知限制（中英双语）：token 挡得住其他用户，挡不住同机同用户的兄弟成员 CLI——其模型驱动的 bash 能读到另一个成员的 token 并回放；而原 pid 校验本身是自报字段，从不能防刻意伪造，所以失去它损失有限。M2（socket 内核级 peer 凭证，或经上游 seam 的 spawn 期 capability token）负责真正的修复。

## Alternatives considered

**保留 `bindMemberRunPid` 与 `cliPid` 字段等未来的 pid seam。** 否决：没有生产方的死 API 读着像一道活的控制；member-channel 测试套甚至曾为它钉着「从未调用」断言。删掉才能让 M2 诚实地设计凭证，而不是复活一个自报 pid。

**wire 上继续发送 `process.ppid` 供日志/审计。** 否决：认证载荷里一个不被校验的自报字段，是在邀请未来的读者信任它；wire 只带宿主会验证的东西。

## Consequences

CLI 成员互发消息在宿主 0.1.5 上恢复。验收面：`member-channel.spec.ts` 覆盖 token 错误、未知/已过期 run、投递成功三路（token-only 用例钉住「活 token 单独即可投递」），`member-bridge.spec.ts` 钉住无 pid 的 wire 形状。安全姿态被诚实地记录为单因子加具名残余风险；收口归 M2。
