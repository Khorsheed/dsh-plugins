# member-channel 回调认证加固（member-channel-auth-hardening）

- **分类**：plugin
- **状态**：idea
- **最后更新**：2026-09-10
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`。最近邻：local-agent-member-channel（通道本体，verified）、2026-09-10 host-015 breaking 适配 note（pid 移除后 fail-closed 的出处）。无认证加固提案，新建。
- **官方依赖**：纯插件（主路径）；长期可附上游候选（spawn-scoped capability token，见下）。

## 目标

宿主 0.1.5 移除 `SubprocessHandle.pid`（刻意决策，上游 note 明确否决恢复）后，member-channel 的 bridge 回调认证失去第二因子。本提案跟踪「临时恢复 → 长期加固」两段。

## 现状

- 机制：per-run token 经 CLI 的 scoped MCP 配置下发；bridge 经 loopback unix socket 上报 `{token, to, text}`；宿主解析 token 得发送者身份，投递走 resume 新进程轮。
- 0.1.5 适配期按 fail-closed 处理（commit 0ba6dd0）：校验保留、无从供给，CLI 成员互发消息停摆。
- 威胁模型：token 落盘在 0700 scoped home——挡其他用户，**不挡同机同用户的兄弟成员 CLI**（其模型驱动的 bash 可读 A 的 token 回放）。原 pid 校验也是自报字段，防不了刻意伪造；它是第二因子 + 防配置错配。
- 官方无任何「外部进程回调宿主」先例（subagent-claude-code/codex/acp 全是纯 stdio、零回连）；Agent Teams 信箱只收宿主内 continuable agent。

## 方案

- **M1（临时恢复）**：回到 token-only 认证，威胁模型写进 local-agent README；fail-closed 相关代码与测试回调。
- **M2（加固，择一）**：
  - a. unix socket 内核级 peer 凭证（macOS `getpeereid` / Linux `SO_PEERCRED`）——比原 pid 自报更强，不需官方配合；成本是原生模块或 /proc 旁路。
  - b. 上游提案存档（docs/upstream-proposals/）：spawn 时宿主经 `DSH_*` 受信环境注入 spawn-scoped capability token，子进程回调出示即证身——正面回应上游否决 pid 的理由（token 只是凭证，不冒充 managed-range 身份）。官方不收 PR 期间仅留档。

## 验收标准（done 判定）

- M1：CLI 成员互发消息在活体恢复（token-only），测试覆盖 token 错误/未知 run/投递成功三路，README 威胁模型段落落地。
- M2 任一落地或明确放弃（注明理由）后关闭。
