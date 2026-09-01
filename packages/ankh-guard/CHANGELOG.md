# 变更记录

## 未发布

- 重启凭证改为执行证据：CLI `record` 默认拒绝自我声明，`--run -- PROGRAM ...` 以原样 argv 执行并只在 exit 0、HEAD 不变且工作树全净时记录；任何 staged/unstaged/untracked 输入都会让 verify/restart/canary 拒绝
- checkpoint 在干净树上直接记录现有 HEAD，不再造空提交；脏树默认拒绝，复核后显式 `--include-dirty` 才用临时 index 提交完整快照，hook/commit 失败不污染调用者 staging area
- `schedule-exit` 无存活 watchdog 时从警告升级为硬拒绝；稳定态从耐久 active launch spec 取 repo/harness/profile/port，并拒绝冲突参数或过期 supervisor command，防止复活已拒绝的启动配置
- detached `supervise` 等到 watchdog 已持久化 pidfile claim 才返回成功，关闭“刚 supervise 就 schedule-exit”竞态；输出区分 `exit-agent pid`，watchdog 生命周期日志带时间戳
- 新增通用启动配置事务切换：`configure-launch`/`reconfigure` 持久化并原子选择 previous/target 完整 launch spec，分别记录 credential/rollback repo 与宿主 `harnessRoot`；资料不足时拒绝从旧 command record 或目标 repo 伪造 previous
- launchd/systemd 前台等待者在 successor 退出后重新读取耐久 launch state 与回执；target 失败恢复 previous 后，外层 supervisor 不会复活等待前缓存的 target
- watchdog 就绪探针区分 transport-up 与 ready：裸 401 不再健康；最终进程输出的同 authority 启动 URL 必须完成临时 Cookie jar 的 303 交换、认证后 `/` 200 与一次浏览器交接，Bearer URL 不进入耐久日志/回执
- 新增脱敏耐久回执 `launch-cutover.json`，记录 supervisor/child PID、配置摘要、认证、重试、canary 与恢复结果；会话仅在回执终态后唤醒

## 0.1.1（2026-08-23）

- 修复：schedule-exit 与 restart 的竞态——schedule-exit 现在全程持 restart.lock（读→写→拉起），不再误杀并发重启刚拉起的新实例
- 修复：随包 skill 在目录里可见、调用即炸——宿主在 load 时才校验注册的 `source` 字段，之前没传；已补 `source: 'runtime'`，并加了真实 SkillRegistry 往返测试（list + load）防回归

## 0.1.0（2026-08-22）

首个公开发布。

- 重启凭证闸门：构建与测试全绿后记录凭证，绑定当时的 git HEAD 并带有效期，重启前逐条校验，改坏的代码在造成伤害之前被拦下
- preflight 组合闸门：重启前在子进程里对完整 profile 组合做深度干跑，组合起不来就绝不停止运行中的实例
- watchdog 托管重启：实例退出自动拉起，连续启动失败回滚到最后已知可用版本，每次回滚留下恢复锚点
- checkpoint/reset：批次前把整个工作树提交为回滚点，可硬重置恢复
- 重启后金丝雀自动复检，被重启中断的会话自动恢复续跑
- 完整 CLI（verify / record / preflight / restart / supervise 等），实例宕机时也可用
