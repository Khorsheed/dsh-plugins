# Agent Note: deploy-3080 放宽 preflight/canary 窗口——超时约束的是挂死，不是慢

Status: implemented

## Problem

在这台共享的 8 核/16GB 部署机上,`pnpm deploy:3080` 间歇性地因 gate 超时失败,但组合本身其实是健康的。2026-09-23 的排查发现机器 load average 约 32、swap 已用 19.9GB / 总共 21.5GB(仅一个残留 9 天的 headless Chrome 就烧了约 1.5 个核);然而手动跑一次完整 profile 的 composition preflight 只用 26.5 秒就 PASS,此前两天里每次 watchdog 重启也都在 17–35 秒内就绪并 canary PASS。gate 的两个期限——guard 的 120 秒 `DEFAULT_PREFLIGHT_TIMEOUT_MS`(deploy-3080 没有覆盖它)和 deploy 脚本自己的 180 秒 canary 窗口——都是按空闲机器校准的,多 agent 的 build/test 叠加把"慢但干净"的运行挤成了拒绝。这两种拒绝在设计上都是安全的(都在停实例之前触发),但每次都要付出一次完整部署重试的代价。

## Decision

`scripts/deploy-3080.mts` 现在向 `schedule-exit` 传 `--preflight-timeout-ms 300000`,并把重启后的 canary 窗口设为 300 秒(原为 180 秒)。guard 自身的默认值不变——面向共享生产机的调用方显式选择更宽的窗口。两处都在现场记录了语义:这些超时是用来抓"挂死"的 preflight 或重启的,不是抓"慢"的。

拒绝语义不变:窗口耗尽仍然在停实例之前拒绝,失败形态保持为"重试部署",永远不会变成"服务在未经验证的情况下被停掉"。

## Alternatives considered

**负载感知排队(部署前先等机器负载降下来再开始)。** 暂不采纳:有了 300 秒窗口,实测 26.5 秒的 preflight 有约 11 倍余量,而"先拒绝、实例不停"的设计让残余的超时只是一次廉价重试。排队会在等待期间一直占着 deploy 锁(把其他部署串行排在一次空等后面)、让调用方 agent 的 shell 无限期挂起,还要为"宽窗口已经吸收"的情形引入额外状态。如果 300 秒下仍出现超时,再回头评估。

**上调 guard 自己的 `DEFAULT_PREFLIGHT_TIMEOUT_MS`。** 否决:120 秒默认值对 `dsh-ankh-guard` 的交互式/独立使用场景是合适的上界;共享机的资源竞争是这个部署环境的属性,因此由部署编排器携带覆盖值。

**削减 preflight 本身的工作量(比如改用 built 面 dry-run)。** 否决,超出范围:源码面是刻意的(dry-run 的正是源码启动会踩到的东西),而且 26.5 秒本身没问题——问题出在余量,不在速度。

## Consequences

- 部署能扛住过去造成 gate 假失败的负载尖峰;这台机器真正的修复仍是卫生问题(残留浏览器已被杀掉,立即释放了约 2.7GB swap)。
- `scripts/deploy-3080.spec.ts` 把 schedule-exit 调用上的 `--preflight-timeout-ms 300000` 参数对钉住了。
- 一个真正挂死的 preflight 现在最长要 5 分钟才被拒绝(原为 2 分钟)——接受:挂死是罕见情形,慢才是常见情形。
