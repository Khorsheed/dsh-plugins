# Agent Note: give-up 崩溃页必须在端口被占时存活

Status: implemented

[English](2026-08-31-crash-page-eaddrinuse-park.md) | 中文

## Problem

一个 e2e 升级 rig(2026-08-30）抓到 give-up 路径退化成 boot 循环互殴。看门狗在累计失败后 give-up 并拉起崩溃页——但此时端口仍被占（失败类别本身就是 EADDRINUSE，这是 give-up 的常见形态），而 `page_script` 的 `server.listen` 没有 `error` 处理器。崩溃页因未捕获的 `error` 事件死亡，watchdog 的 `wait $page_pid` 立即返回，循环 `continue`——回到 boot 尝试；此时 `failures` 已 ≥4，每轮都重新进入 give-up、再拉一个立刻崩溃的页。"驻留等人工"的设计悄悄变成了"永远继续尝试启动"，而且每次端口竞态重试都会杀掉它刚刚宣告放弃对抗的健康占用者。

## Decision

崩溃页现在把绑定失败当作 give-up 的常态而非致命错误：撞 `EADDRINUSE` 时打一行日志（"crash page cannot bind … SIGUSR1 re-arms the boot loop"）并每 5 秒用新 server 重试绑定。页进程因此存活，watchdog 的 `wait` 按设计阻塞，give-up 成为真正的停泊：不再有 boot 尝试、不再有 `free_port` 强杀，SIGUSR1（或绑定成功后的页内重试按钮）重新武装循环。计数失败与端口竞态逻辑均不变。

## Alternatives considered

- **页面绑不上时直接停泊 watchdog 本体**（不起页，睡到 SIGUSR1)——否决：give-up 状态会裂成"有页停泊"和"裸停泊"两种形态，而让页自己坚韧已经覆盖这个角落；单一停泊机制更简单。
- **give-up 时退出 watchdog**（贴合 rig 报告对设计的误读）——否决：退出的监督者无法被 SIGUSR1 重新武装，端口还会失去监督；崩溃页的意义恰恰是保有一个活的、可重试的存在。
- **页死后给 boot 循环加退避上限**——页不再死后已无必要；为不再发生的路径加第二重保险是死代码。

## Consequences

- 端口被占的 give-up 现在可观测地停泊：日志只有一行 "cannot bind"，而不是每循环一次的未捕获异常栈；占用者不受打扰。回归测试（`give-up parks when the crash page cannot bind`）用裸 TCP 占位者占住端口、真实 watchdog 跑满四次计数失败，断言：尝试次数冻结、日志无未捕获错误、占位者存活、SIGUSR1 后恢复尝试。该测试对修复前脚本失败。
- rig 的另两个观察也对日志核实过：本端口 EADDRINUSE 分类一直是正确的（attempt 1–4/5 都是释放重试不计数）;watchdog 进程在页崩溃后**没有**死（它继续 boot 尝试——rig 观察到的"进程没了"是它自己的 teardown)。
- 有意保留的残余缺口：计数失败来自"实例被杀到来不及写日志"的尝试日志（无 EADDRINUSE 行）时仍计入 give-up——这个分类缺口是读日志的固有边界，组合回滚层管这个失败类别。
