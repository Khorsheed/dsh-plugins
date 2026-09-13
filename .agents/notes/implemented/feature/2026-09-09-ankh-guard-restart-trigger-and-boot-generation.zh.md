# Agent Note:ankh-guard 进程内重启触发缝与 boot 代际刷新通道

状态:已实现

[English](2026-09-09-ankh-guard-restart-trigger-and-boot-generation.md) | 中文

## 问题

两个缺口挡住了 UI 级重启流程(mode-switcher 的 profile 切换)。其一,重启的唯一触发通道是 CLI:进程内的 `selfRestartGuard` 服务只有验证与登记,没有发起重启的方法,设置页按钮无路可走。其二,浏览器 handoff(长轮询 → 遮罩 → 刷新)只覆盖 reconfigure cutover,因为 readiness 判定建立在 cutover receipt 上;普通重启或 watchdog 崩溃救回之后,打开的标签页只是 WebSocket 静默重连,永远拿不到已变更的客户端 bundle。

触发缝还必须避开两个已知陷阱。有活 watchdog 时,`restart` 带显式 `--start` 不会被拒——它正好撞进 fallback 拒绝要防的 double-start 竞态:watchdog 只会用烤住的旧命令 respawn,新旧两条命令抢同一个端口。另外,手填 `initiator` 已经两次把重启报告路由到不存在的会话。

## 决策

**`ctx.selfRestartGuard` 增加 `requestRestart({ start, profile, initiator })`。** 校验 fail-fast:三个字段全部必填,`initiator` 绝不允许缺省——UI 调用方拿着真实 session id。端口从 instance launch 记录取,从不由调用方传。分派按监督状态:无活 watchdog → `restart` 的自包含 stop→start→canary;受监督 → `reconfigure`(事务化 cutover,`--on-failure restore-previous`),这是唯一不与 watchdog respawn 打架的换命令通道。触发缝壳出到本包自己的 CLI(source/built 从模块文件路径解析),完整闸门链——cutover 冲突、凭证、沙箱、组合 preflight、待决 marker、重启锁——只有一个行为源,detached driver 也保持已验证的生命周期规则。拒绝记录机器可读判定(`CliRefusal`,首个拒绝为准),CLI 把它写进调用方指定的 verdict 文件(`DSH_ANKH_VERDICT_FILE`,并从调用方派生的每个长生命周期子进程环境里擦除);服务把退出码加判定映射成 `{ accepted, stage, reason }`。终端的人类 stderr 文本与退出码逐字不变。拒绝绝不停机。

**boot 代际浏览器通道。** 普通重启不写 cutover receipt,handoff handler 因此增加第二条 readiness 信号:服务进程自己的 pid + start token 就是 boot id,挂在每一个 200 poll 响应上。标签页把上次见到的 id 存进 sessionStorage,作为 `knownBootId` 随 poll 带上;id 陈旧且无 active cutover → 回 `ready/reload`——它认识的那个进程已经没了。一次性语义成立,因为标签页在 reload 前就从 ready 响应里学到了继任者的 id;不需要 capability 注册与 ack(那是为 cutover 的双监听器窗口和 token 颁发准备的)。active cutover 永远优先:cutover 期间旧标签页的 known id 本就陈旧,代际分支若应答会与 receipt 协议的 pacing 赛跑。进程身份不可用(ps 被拒)时降级为代际前的流程,与旧客户端逐字一致。客户端另在持续失败约 5 秒后挂中性「连接已断开」遮罩——按时长而非重试次数,因为指数退避已把重试拉到秒级,按次数会在瞬时抖动时闪屏;文案不承诺自动恢复(裸退出可能永不回来)。受监督的模式切换继续走 receipt handoff;代际通道覆盖无监督重启与崩溃救回——那正是静默 WS 重连拿不到新 bundle 的场景。

持续失败遮罩部分由[回前台恢复](../bug-fix/2026-09-13-mobile-foreground-connection-recovery.zh.md)细化：普通前台失败现使用带重试按钮的轻量提示，后台挂起时间不计入失败时长。重启与 boot 代际协议仍保持上述设计。

## 放弃的替代方案

**把 caller 侧闸门序列抽成共享模块,CLI 与服务共同 import。** 放弃:restart/reconfigure 两臂刚被三拨独立工作加固过(事务化 cutover、执行绑定 preflight、重启证据),移动这些代码换来的是更纯的分层,代价却是全包最安全关键路径上的 churn 与合并风险。

**把 CLI 模块 import 进插件运行时、进程内驱动 `runCli`。** 先这么做了,发现它会把构建版 CLI 打残后回退:插件图里的一条运行时 import 边会让 tsdown 把 cli.ts 从 `lib/cli.js` 抽进共享 chunk,入口的 `isDirectInvocation` 守卫(以及 `cliInvocation` 的自身路径)对着 chunk URL 求值,于是每次 `node lib/cli.js …` 都静默退出 0 什么都不做——两条集成泳道抓住了它(退出 0 的 control writer 留不下任何 marker;watchdog 的 guard 调用全部空转,反复失败后 give-up 停出崩溃页)。子进程设计没有这条边;`restart-request.ts` 的模块文档挂着这个警告,只保留会被擦除的 type-only import。

**有活 watchdog 时连显式 `--start` 也拒掉 `restart`。** 本次不做;分派规则让触发缝永远选对路,而加固 CLI 的显式 flag 路径是另一个独立的行为决策。

**为普通重启合成 cutover receipt 复用现有协议。** 再次放弃,这次落到代码:receipt 语义(`awaiting-user`、target/restored ownership、recovery、launch-url 颁发)全是 cutover 专属,`cutoverBlocksWake()` 会把普通重启误读成 cutover、压制 followup 注入。

**代际通道只覆盖守卫发起的重启。** 放弃:崩溃救回同样把标签页困在旧 bundle 上,而且 boot id 本就分不出意图——信号只是「你认识的那个进程没了」。

## 后果

- 旧客户端 bundle 不带 `knownBootId`,升级后的第一次重启不自动刷(退化为本改动前的行为),之后才进入自动循环。
- 受监督的 `requestRestart` 要求 durable launch spec(`configure-launch` / `supervise` 状态);缺失时拒绝文本指明缺的前置条件,而不是半截行动。
- 崩溃循环期间每次 respawn 都会刷新标签页,直到 watchdog give-up 停泊;give-up 路径兜住它。
- mode-switcher(M1)消费 `requestRestart` 与两条刷新通道;本改动不需要任何宿主/harness 改动。

