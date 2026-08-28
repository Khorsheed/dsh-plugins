# Agent Note: kimi 凭证哨兵（空壳备份 + 恢复 + 归因日志）

Status: implemented

[English](2026-08-27-kimi-credential-sentinel.md) | 中文

## Problem

kimi scoped home 的 `credentials/kimi-code.json` 已两次被抹成空壳（两个 OAuth token 都是零长字符串）——2026-08-22 一次，2026-08-27 18:52 又一次（两秒后 prod 3080 的委派即报 "Authentication required"）。我们的插件代码从不写这个文件（只有 config.toml 和登出删除），所以空壳是 kimi CLI 自己的失败路径——最可能是非原子的刷新写撞上我们的进程生命周期（空闲回收的 EOF→grace→SIGTERM 阶梯，或重启）。两次都靠手工从幸存副本恢复。

## Decision

`packages/local-agent-kimi/src/credential-guard.ts`——凭证读取路径上的哨兵：

- **有效即备份**：观测到双 token 非空的凭证就重写 `credentials/kimi-code.json.bak`（600 权限）。备份放在 `credentials/` 内——家族登出是整目录删除，登出不会留下可恢复的幽灵备份。
- **只认空壳恢复**：精确签名 = 双 token 均为空串。无法解析的内容留给人工（未知损坏形态绝不覆盖），文件缺失保持缺失。
- **归因日志**：每次空壳检测都 warn 记录文件 mtime、上次观测状态和一行 kimi/dsh 进程快照——下次复现能直接看到当时谁在场。有效→有效的 mtime 变化也留痕（token 刷新轨迹）。
- 三个接点：`kimiAuthenticated`（每次状态探测——顺带修正了探测本身：哨兵前"目录非空"把空壳也读成已认证）、exec provider 的 `onAuthFailure`、live driver 的 `reportAuthIfShaped`——运行中被抹也能在失败当下恢复，调用方的重试（或下一轮）即可成功。

刻意的窄化：别处吊销的凭证永远不会呈空壳形态；恢复到已轮换的备份最坏只是多一次响亮的 401——绝不产生静默错误。

## Alternatives considered

- **恢复后自动重跑失败的轮**——否决：settle 契约已触发，从错误路径重驱一轮有重复副作用风险。检测即恢复已能让主 agent 的自然重试（两次事故里父 agent 都会重试）成功。
- **在回收阶梯上加写锁预防**——否决，过度工程：我们无法暂停 kimi 内部的刷新，哨兵已把损害收敛到一次响亮失败。
- **备份放到 credentials/ 外**——否决：登出必须能清掉它；放目录内自清理。

## Consequences

- 空壳抹除现在会在下一次探测或失败上报时自愈并留 warn 轨迹；无备份的最坏情形与之前相同（响亮失败），外加一条"需要重新登录"日志。
- `kimiAuthenticated` 现在是内容感知的：不可恢复的空壳在委派失败**之前**就会显示未认证（红点）。
- 若空壳继续复发，日志里的进程快照给出具体嫌疑名单；真正的根治（原子写凭证）属于 kimi CLI 上游。

## Testing

`tests/credential-guard.spec.ts`（6 个）：有效备份、空壳恢复（文件内容 + warn 行）、无备份报 false、缺失报 false、不可解析不恢复、`kimiAuthenticated` 接线。套件：kimi 121/121。

## Cross-references

- [kimi live 镜像折叠修复](2026-08-27-kimi-live-mirror-fold-fixes.md)——暴露第二次空壳的验收轮。
