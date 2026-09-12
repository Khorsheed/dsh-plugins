# Agent Note: deploy-3080 不得把用户名当作重启报告的路由会话

Status: implemented

## Problem

此前每一次 `deploy:3080` 重启都会让重启报告变成孤儿。deploy 脚本把 `--initiator` 默认成 `$USER`（"zhuyudan"）并无条件传给 `ankh-guard schedule-exit`——但 guard 的 `--initiator` 契约是报告要路由到的**会话 id**（它自己的默认值 `$DSH_SESSION_ID` 本来就是对的）。initiator 是用户名的记录只能被 id 恰好等于该用户名的会话认领——这样的会话永远不存在——于是记录一直 pending，直到被下一次重启覆盖：报告静默丢失，跑部署的会话只收到"回合被中断、请继续"的续跑提示，永远拿不到 canary 回执（2026-09-12 file-preview / inline-html-render / ui-file-preview 部署；缺陷报告附完整证据链：deploy 日志里 guard 的警告、`last-restart.json` 无 `reportedAt`、restart-context.ts 里记录只有两条退休路径）。

## Decision

`scripts/deploy-3080.mts` 不再有默认 initiator：`--initiator` 标志只在操作者显式给出会话 id 时才传给 `schedule-exit`。不传标志时，ankh-guard 把报告路由给它调用方的 `$DSH_SESSION_ID`——真正跑了这次部署的会话——这正是流程本意的那次唤醒。通报里需要的人类归属是另一回事：通报行现在直接打印 `操作者:$USER`，"谁跑的"和"回执发给哪个会话"不再共用一个变量。spec 对两条路径都有断言：默认重启运行的 `schedule-exit` 调用不带 `--initiator`；显式 `--initiator session-abc` 原样透传。`docs/ops.md` 的 deploy 用法块写明了为什么非会话 id 会让报告变孤儿。

## Alternatives considered

- **把默认值显式改成 `$DSH_SESSION_ID`**——效果与不传完全相同（那本就是 guard 自己的默认值），但等于把 guard 的契约抄了一份进 deploy 脚本，日后会漂移；省略标志是把路由委托给契约的 owner。
- **保留 `$USER` 默认值、靠 guard 警告**——那正是旧行为：guard 的 resolveInitiator 会大声警告但不拒绝（"代人调度"是记录在案的合法用例），所以这个地雷在每一次部署上都会踩响。默认值必须路由正确，覆盖入口保留。
- **给标志改名**（`--report-to`）——更清楚，但这个标志本就是 guard `--initiator` 的透传；保留名字让透传关系诚实，而且危险出在默认值，不在名字。

## Consequences

- 重启报告（canary 结论、回执）重新会唤醒跑了部署的那个会话；"回合被中断"的续跑提示不再是唯一反馈。
- `last-restart.json` 记录的 initiator 是真实会话 id（或缺省），记录因此在投递后退休，不再挂到被下次重启覆盖。
- 代价：无——通报照样归属人类操作者，只是直接取 `$USER`。

## Testing

`scripts/deploy-3080.spec.ts` 新增上述双臂断言；`pnpm run test:scripts` 通过。
