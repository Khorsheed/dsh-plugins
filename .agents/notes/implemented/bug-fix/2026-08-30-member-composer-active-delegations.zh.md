# Agent Note: 成员 composer 的 running 改为双源——外部 CLI 运行也能亮运行中徽标和 Stop

Status: implemented

[English](2026-08-30-member-composer-active-delegations.md) | 中文

## Problem

线上 bug（prod 3080）：CLI 成员运行期间，成员 composer 显示的是可用输入框和发送箭头——从不出现运行中徽标和 Stop 按钮——用户无法从成员会话自己的 composer 中止成员（"无法在子agent的composer停止一个子agent"）。根因：composer 只从会话摘要的 `running` 标志推导"运行中"，而该标志由 host 的 `agent/status` 驱动。外部 CLI 运行没有 host 侧 live agent，整轮运行期间标志恒 false（家族 gateway 文档早已注明："官方会话摘要的 `running` 标志是 agent-based，外部 CLI 一次性运行恒为 false"）。同一失效数据源还悄悄废掉了 2026-08-28 的 running 翻转重核路径：首轮 settle 时只读→可写的原地翻转在生产从未触发过。官方子代理目录行的"当前未运行"标签同根因，但那是 host 组件（修它要遮蔽 `conversation.session.header.lineage` 槽位或走 upstream seam——刻意不在本次范围内）。

## Decision

- **双源 running，taskpilot dock 已验证的模式。** composer 挂载期间每 1.5s 经 gateway 的 `activeDelegations` Remote 轮询家族在飞委派注册表（注入面新增 `activeDelegations`；RPC 失败映射为 undefined）。`running = summary.running || activeDelegations.includes(childId)`——dsh 成员的子实例仍原生驱动官方标志，外部 CLI 运行经注册表点亮。
- **轮询失败保持已知位。** 瞬时 RPC 错误绝不会在运行中途把 Stop 抖掉。
- 既有核实 effect 本就在 `running` 翻转时重跑，所以首轮只读→可写原地翻转在生产自然生效，无需额外改动（新测试钉住）。

## Verification

`tests/member-composer.client.spec.tsx`（+3，套件 30；包 167 绿，构建绿）：仅靠轮询位（摘要标志为 false）即出现 Stop 和运行中徽标，Stop 派发 `stopMember`；轮询失败保持位不抖；在飞位随 settle 落下时面板从只读翻成可写、重核拿到记录。已上线 prod 3080（canary PASS）。

## Alternatives considered

**从镜像 transcript 事件驱动 running UI**——否决：镜像只追加内容事件，host 的 agent-based 标志一个也不读；另造家族私有 running 投影等于重复 `activeDelegations` 已经发布的东西。

**遮蔽官方 lineage 下拉顺便修"当前未运行"标签**——范围外否决：那是要跟随上游演进的 host 组件；标签是观感问题，缺 Stop 是功能问题。留作可能的 upstream seam。

**推代替轮（家族事件总线）**——否决：gateway 已有拉式 Remote，taskpilot 的 1.5s 节奏已被证明廉价，总线只增生命周期表面、无用户可见收益。

## Consequences

成员 composer 现在在任何成员运行期间（exec 或 live，任意 provider）都显示运行中徽标和 Stop，Stop 经既有 `stopMember` 门面路径中断运行。每个打开的 composer 每 1.5s 一次 Remote 调用——本地流量可忽略；非成员一次性会话也会轮询（答案恒为"不在飞"）。官方目录的"当前未运行"标签不变（host 组件，见 Alternatives）。
