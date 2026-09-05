# Agent Note: ankh-guard preflight 调用方等待期限

Status: implemented

[English](2026-09-05-ankh-guard-preflight-caller-deadline.md) | 中文

## Problem

`schedule-exit` 默认允许组合 preflight 运行 120 秒，但托管的 agent shell 若未由调用方提供更长执行期限，可能在 60 秒后终止命令。CLI 过去要等 preflight 子进程结束才输出，并且在此之后才写重启 marker。一个正确但较慢的 preflight 因此可能被调用方杀死，既没有输出、没有 `exit scheduled` 回执，也没有重启。agent 随后可能把更早的 listener 变化误认为自己的重启，或在不知道授权是否已到达 detached 退出代理的情况下重试。

这个时间范围有真实证据，并非假设：历史上成功的完整 profile preflight 既有约四秒的，也有一次用了 75 秒。后者因为工具调用显式等待 180 秒而成功。更早的一些近乎瞬时的调用报告 preflight 不可用，并未 boot 完整 profile，因此其耗时不能作为可比证据。

## Decision

- 每个具备停止能力的组合闸门都在等待 runner 之前立即输出 `composition preflight START`，包含选中的 profile 和 guard 内部超时。PASS 或拒绝仍是终态闸门结论；单独的 START 从不授权重启，也不包含 runner 路径、launch URL 或凭证形状的输出。
- 随包发布的自重启 Skill 把调用方 deadline 作为独立安全预算。内部 preflight 使用默认 120 秒时，托管 Bash/tool 调用使用 `timeoutMs: 180000`；自定义时，调用方期限至少比配置的 preflight 超时多 30 秒。
- Skill 要求普通同启动配置重启直接通过该动词自带的唯一闸门。独立 preflight 只用于诊断已经观察到的失败，不在同一个守卫动词之前投机重复运行。
- 若调用方仍中断 CLI，只有 `composition preflight START`、没有 PASS/拒绝和 `exit scheduled`，表示没有证据证明重启已获授权。操作者先检查耐久 restart marker 与回执，再决定是否安全重试，不能从 listener PID 变化推断成功。

## Alternatives considered

**把 guard 默认 preflight 超时降到常见 shell 的 60 秒以内。** 否决：已知健康的完整 profile preflight 曾运行 75 秒。把调用层集成错配变成虚假的组合或基础设施拒绝，会削弱安全闸门。

**分离 preflight，让 `schedule-exit` 在结论前返回。** 否决：调用方将拿不到闸门通过且退出确已调度的终态证明。detached 边界仍只属于所有停止前闸门通过后创建的退出代理。

**依赖 agent 从 CLI help 自己推断合适的 timeout。** 否决：两个预算属于不同层，使用不同参数面。agent 消费的是随包 Skill，因此由它明确规定工具元数据与余量。

**先跑独立 preflight，让后续闸门更可能命中热缓存。** 否决：具备停止能力的动词有意拥有权威闸门，之后仍必须再跑。重复执行增加副作用与耗时，却不能消除调用方 deadline 契约。

## Consequences

- 较慢的 preflight 仍然 fail closed 并保留完整安全预算，而托管 agent 调用会等待足够久，取得真正的闸门结论和调度回执。
- 外部中断的调用可从部分 stdout 归因，无需持久化可能带 bearer 的 runner 输出；决定能否重试时仍以耐久 marker 为权威。
- 单测钉住刻意较慢的 preflight 尚未结束时 START 已可见；Skill 注册测试则钉住真正交付给 agent 的内容中包含 180 秒调用契约。
