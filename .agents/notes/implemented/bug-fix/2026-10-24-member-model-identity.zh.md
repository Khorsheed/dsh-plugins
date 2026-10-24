# Agent Note: 成员续接时重新绑定它原来绑定的模型

Status: implemented

[English](2026-10-24-member-model-identity.md) | 中文

## Problem

同一个宿主进程里，房间中 Claude Code 成员的第二轮会立刻失败，报「Member configuration identity changed: model」。`MemberControls.get` 在成员第一轮时固定它的配置身份（provider、父会话、cwd、scope、model、effort、锁），之后任何一轮的绑定与之不同就会被拒。

- 第一轮绑定的是调用方要的模型（邀请时选的值，比如一个别名）。
- 随后 Claude provider 往委派记录里写的是它解析后的模型（`round.model`，比如 `claude-opus-5-5`）。
- 每次续接都从这条记录构造绑定，于是第二轮报的模型和固定下来的不一样。

没有指定模型的启动，在 provider 记下解析出的默认模型后也会同样失败。宿主重启后固定的身份就没了，所以只在同一个进程里出现。

## Decision

只要成员已有绑定的身份，`recordDelegation` 就让记录里的 `model` 原样跟随绑定值，包括「没有指定」的情况；`effort` 和 `configurationLock` 本来就是这样处理的。解析出的模型仍可以从 `observedModel` 和成员配置控件里已生效的配置看到。

Codex、Kimi、dsh 本来就记录请求的模型。修复放在核心里，任何 provider 都不会再造成这种不一致。

## Alternatives considered

**只改 Claude provider，让它记录请求的模型。** 否决：这只修了一个写入方，「记录里的模型就是续接要绑定的模型」这条约束又得靠每个 provider 自己守。

**放宽对 `model` 的身份检查。** 否决：这道检查负责把外来的绑定挡在成员的队列之外；换模型应该走成员配置控件，而不是悄悄换一个不同的绑定。

## Consequences

- 成员有绑定时写入的委派记录，带的是请求的模型而不是解析后的模型。旧记录保留解析后的值；重启后会重新绑定，不会冲突。
- `tests/delegation-facade.spec.ts` 覆盖了别名模型和不指定模型的启动连续跑两轮。
