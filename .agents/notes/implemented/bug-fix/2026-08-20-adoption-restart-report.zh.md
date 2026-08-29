# Agent Note: 收编接管向建立监管的会话自动回报

Status: implemented

[English](2026-08-20-adoption-restart-report.md) | 中文

## 问题

新机首装测试暴露了一个首跑体验缺口：agent 装好插件、建立监管（`supervise`)、结束回合并承诺"服务恢复后我会验证并汇报"。收编弹换随后杀掉并替换实例——但接管既不写 restart 标记也不写 outcome 记录，报告机制没有可投递的东西：驱动会话停泊，而不懂协议的用户只能盯着停住的页面。计划重启路径早就通过 `last-restart.json` + initiator followup 自动回报；收编路径——每个部署的第一次重启——反而是沉默的那个。

## 决策

- `supervise` 捕获调用会话（`$DSH_SESSION_ID`）并以 `WD_INITIATOR` 传给 watchdog；收编还是首启在 spawn 时判定（端口上有存活 owner 则 `WD_ADOPTION=1`)——在 watchdog 里探测 owner 会与 owner 退出竞态（集成测试实测：host 在 watchdog 第一次 `lsof` 之前就死了）。
- 首次健康启动、尚无 boot 戳且 `WD_ADOPTION=1` 时，watchdog 调用新的 `record-adoption` CLI 动词写一条 `last-restart.json` outcome(`writeAdoptionRecord`，与 `record-unexpected-exit` 同款 pending 保护）。插件现有的报告机制随后唤醒建立监管的会话——首次重启和计划重启一样自动回报。
- 真正的首次启动（supervise 时无 owner,`WD_ADOPTION=0`）什么都不写：首接触不误报的守则保留，并有独立测试守护。

## 考虑过但未选

- **在 watchdog 里探测前主**（接管等待前 `lsof` 一次）——构造上必然竞态；CLI 在 supervise 时同步知道答案，事实随环境传递即可。
- **纯文档缓解**（在 skill/README 里教"首次弹换后发任意消息唤醒我")——把协议知识推给用户；报告机制本来就在，只是收编路径从没喂过它。

## 后果

- 人手工 `supervise`（无 `$DSH_SESSION_ID`）写的记录没有 initiator，由第一个被创建的 root agent 认领——与崩溃恢复记录的信使语义一致。
- 既有接管测试的"首 boot 不写记录"断言已更新：它把首启和收编混为一谈；两个情形现在各有独立测试（100/100 绿）。
- 2026-08-29 加固：initiator 默认值是权威，现在有了防线。3080 上一个 agent 调度退出时手填了一个 `--initiator`（从分支名造的 slug)：重启本身成功，但报告被路由到一个不存在的会话，真正的调度者从未被唤醒。skill 不再指示传 `--initiator`（写明"绝不要手传"),CLI 帮助同步修改，`restart` 和 `schedule-exit` 都经 `resolveInitiator` 解析 initiator——显式值与本 shell 的 `$DSH_SESSION_ID` 矛盾时打印响亮警告（只警告不拒绝：代别的会话调度是合法用途）。一个 CLI 测试钉住警告和匹配时静默两种情形。
