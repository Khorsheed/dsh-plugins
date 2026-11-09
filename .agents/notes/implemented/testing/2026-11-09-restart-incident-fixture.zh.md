# Agent Note: 2026-11-09 重启事故的合成夹具

Status: implemented

[English](2026-11-09-restart-incident-fixture.md) | [中文](2026-11-09-restart-incident-fixture.zh.md)

## Problem

重启恢复收敛（设计稿 `proposals/active/2026-11-09-restart-recovery-consolidation.md`，R1–R5）改变了房间、local-agent 核心和正式目标读「被重启打断的一轮」的方式。促成它的事故（房间 6a56367b，2026-11-09）在磁盘上留下了一组特定的形状：`uncertain` 的投递边、排给协调者的英文「结果不确定」回报、「按没做完处理」的取消、绕过目标写下的「被取代」取消、核心里人点的「确认已完成」、五条重复的释放提醒，以及一个卡在 `paused` 的目标（一次尝试 `uncertain`、一次 `queued`）。每一步都要证明自己能正确读这组形状和更早日志里的形状，又不能把真实会话复制进公开仓库。

## Decision

R0 只加夹具，不碰产品代码：

- `packages/room/tests/fixtures/restart-incident.ts`：`seedRestartIncident(room, cast)` 往一个已有这几位成员的房间里追加事故的事件形状（注释写明每条对应事故里哪个 seq），返回投递 id、种下的目标（#1613 的形状）和两位成员在 #1613 时的核心账本行。名字和文字全部虚构（总编排 / 地图匠 / 剧情师，task-a / task-b）。
- `packages/local-agent/tests/fixtures/restart-ledgers.ts`：旧核心在重启后刚写下的账本文件（`uncertain` 行、`pausedBy: 'restart'`）、宿主在一轮中途死掉时的账本，以及把它写到核心读取位置的 `writeLedger`。
- `packages/room/tests/restart-recovery.host.spec.ts`：后续各步扩展的测试台；第一个用例固定夹具回放出来的形状（目标暂停、task-a 的尝试 `uncertain`、task-b 的 `queued`、作废的回报还排着）。

房间的核心替身（`tests/run-entry-shim.ts`）允许种下的行带 `interrupted` 和 `reconciledAt`。

真实日志只用 `zstd -dc … > /tmp/…` 读，不提交任何内容。

## Alternatives considered

**提交一份裁剪过的真实房间日志。** 否决：仓库公开，裁剪后仍带会话内容。各步依赖的是事件形状，手写就能复现。

**每步一个夹具。** 否决：各步对「事故长什么样」必须一致；一个夹具让 R2–R5 回放同一段历史。

## Consequences

后续各步对着同一段历史断言，设计稿 G 节（升级后房间的样子）成了可执行的用例。夹具记录的是 2026-11-09 对事故形状的理解；它漏掉的形状是夹具的缺口，不代表代码已经处理了。
