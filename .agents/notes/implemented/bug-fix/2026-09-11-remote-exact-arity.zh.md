# Agent Note: Remote 客户端严格校验参数个数——可选参数必须显式传

Status: implemented

[English](2026-09-11-remote-exact-arity.md) | 中文

## Problem

3080 生产实例上四个 local-agent provider 的设置卡片全部显示未登录，而凭证在各家 scoped home 里完好。链路是：命名 scope 特性（[84ce03d](https://github.com/Khorsheed/dsh-plugins/commit/84ce03d)）把家族 gateway 的 `status(name)` 扩成 `status(name, scope?)`（`sessions(name)` 扩成 `sessions(name, sessionId?)`），四张卡片仍按一个参数调用；api-gateway 客户端严格校验参数个数（`prepareInvocation`：`values.length !== expected` 即抛，"expected 2 argument(s), got 1"），于是每次状态探测都失败，卡片落成 unavailable 态。TypeScript 的可选参数在编译期放行单参调用，所以构建与测试都没抓住它。

## Decision

卡片显式传默认 scope：`gateway().status(name, undefined)`。`undefined` 在宿主侧读作缺省（默认 scope），同时满足参数个数校验。四个 provider 各带一个回归测试（`tests/client-apply.spec.ts`）：用假 gateway 驱动客户端 `apply`，钉住两参调用。gateway 的 `sessions(name, sessionId?)` 没有活体调用方（records 组件未挂载），不动。

## Alternatives considered

**上游放松参数个数校验，容忍省略的尾部可选参数。** 暂不上行：校验在宿主的 api-gateway 客户端里，本仓不动宿主本地分叉；上游提案仍可放松它，但显式传参的调用在每条宿主线上都正确，插件侧修复自足且可移植。

**把卡片 status 面扩成带 scope 选择。** 否决：卡片今天只报默认 scope，也没有 scope 选择 UI；最小修复恰好恢复回归前的行为。

## Consequences

四个 provider 的授权圆点与区块重新读到真实凭证状态（已在 0.1.5-rc.1 组合上活体验证：种入凭证后 kimi 卡片翻成已登录，空目录正确保持未登录）。要记住的坑：Typert Remote 方法的运行时参数个数是其声明的参数总数——宿主侧加一个可选参数对每个现有客户端调用都是 breaking，编译器不会说一句话。
