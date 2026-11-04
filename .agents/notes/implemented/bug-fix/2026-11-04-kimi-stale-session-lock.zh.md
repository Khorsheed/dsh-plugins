# Agent Note: kimi 成员能从死进程留下的会话锁中恢复

Status: implemented

## Problem

Kimi Code CLI（`kimi acp`，2.4.x）持有会话期间会占用 `<KIMI_CODE_HOME>/locks/sessions/<sessionId>.lock`。锁文件是 JSON，写明持有者的 `pid`、`hostname`、`token` 和客户端。宿主在一轮中途重启后，成员下一次 `session/load` 失败，返回 JSON-RPC `-32603 "Internal error"`，`data.details` 是 "This session is in use by another Kimi Code CLI instance…"。几处问题同时发生：

- 驱动丢掉了 `data`，房间只显示 `subagent-kimi live: Internal error`。
- 驱动完全不看锁文件，只能手工把锁挪走。
- 之后每一轮都在几毫秒内失败，不拉起任何进程。核心的成员配置控制（`packages/local-agent/src/member-control.ts`）把原生启动失败持久化成 `status: 'failed'`，此后每次准入都直接抛出这条存下的错误，直到用户重试。只有准入自身检查拒绝的情况才会自动重查。

用本机 kimi 2.4.1 实测，确认了 CLI 的锁行为：

- stdin EOF 正常退出会释放锁，即使在一轮进行中也是如此，约 40 ms。
- SIGTERM 和 SIGKILL 会把锁留下，因为删锁的退出处理在信号退出时不会执行。
- hostname 相同且 pid 已死的锁，kimi 自己会回收。hostname 不同、pid 还活着（EPERM 也算活着）、或者持有者在本次开机后启动且仍在运行时，它会拒绝。

所以出现这条拒绝，说明 kimi 当时判断持有者还活着，或者锁上写的是别的 hostname。

## Decision

`packages/local-agent-kimi/src/session-lock.ts` 读取会话锁并分类：

- `absent`
- `unreadable`：读不出、解析不了，或 pid 不是正整数
- `foreign-host`
- `alive`：`kill(pid, 0)` 成功，或失败但错误不是 ESRCH
- `stale`：本机 hostname，且 pid 已不存在

`setAsideKimiSessionLock` 把失效的锁重命名为同目录的 `<name>.stale-<时间戳>`。挪完后重读被挪走的文件；如果期间 token 变了，就用 link 把锁放回原处，不覆盖已有文件。

常驻驱动的 `loadSession` 包住每一次 `session/load`：轮次开始、压缩、prepare、立即载入、重新载入都经过它。

1. 载入前，把可证明已失效的锁挪开，除非本驱动拥有的其他 runtime（不含正在载入的这个）持有该会话。同时打一条宿主 warn，写明会话、已死的 pid 和挪去的文件名。
2. 遇到 kimi 的 "in use" 拒绝时（按 `data.details` 匹配）：
   - 如果持有者是本驱动自己的、正在退场的 runtime，最多等它 5 s 退出，然后重试。
   - 否则重查锁文件。如果此时已失效（随即清掉）或已不存在，重试一次。
   - 否则以 `KimiSessionOccupiedError` 失败：kimi 的原话，加上谁持有该会话（"process N on this machine still holds it"、"held from another machine: H"、"its lock file could not be read"）。错误带 `beforePrompt: true`。

所有 JSON-RPC 错误响应都转成 `AcpRequestError`，带 `code` 和 `details`。消息为 `subagent-kimi live: <data.details | data.message | data | message>`，kimi 自己的话能传到房间。

`session/load` 失败的 runtime 会清掉自己的 `sessionId`。万一被复用，下次 ensure 会重新载入，而不是去 prompt 一个没载入的会话。原有的准入失败后回收逻辑照样把它移除。

退出卫生：回收本来就先关 stdin（这是会释放锁的退出方式），等 1 s 后才走 SIGTERM 阶梯。阶梯真的走到时，runtime 的 `onForcedExit` 钩子会把它留下的失效锁挪开，因为被信号杀掉的 kimi 会把锁留下。

## Alternatives considered

- **直接删除失效锁。** 否决：重命名同样是原子的。kimi 只读精确的 `<id>.lock` 路径，挪走的副本不会产生影响，还能留下“谁持有过该会话”的证据。代价是 `locks/sessions/` 里多几个小文件。
- **只要 kimi 拒绝就清锁，pid 活着也清（假定 pid 被复用）。** 否决：活着的持有者可能真是一个孤儿 `kimi acp`，还在写这个会话。抢占会让两个写者交错写同一条 wire，kimi 自己的界面也警告这样 "may mix up the history"。这个决定应交给用户。
- **hostname 不同也算失效。** 同理否决。多台机器共享 home 是正当用法，kimi 自己也把这种情况当作持有者活着。
- **在驱动里修掉毫秒级失败。** 做不到：存下的失败在核心的成员控制里（S4 的范围）。在原生启动内部完成恢复，失效的锁就不会走到那里。真正被占用的失败仍会落到那里，但现在带可读原因，还带 `beforePrompt` 标记，核心可以据此判定为可自动重试。

## Consequences

- 本机已死的成员进程留下的锁不再卡住成员，不管 kimi 自己的失效检查能否识别。
- 会话确实被占用时，失败信息是用户能据此行动的一句话，而不是 "Internal error"。
- 核心仍会持久化原生启动失败。在核心读取 `beforePrompt` 或错误类型之前，被活着的持有者拒绝的成员，要等持有者退出后由用户重试。
- 每恢复一次，kimi home 的 `locks/sessions/` 目录里就多一个 `.stale-*` 文件。

## Testing

`packages/local-agent-kimi/tests/live-driver.spec.ts` 的 describe "kimi session lock left by a dead process"，用 mock ACP 服务和临时 home：

- 本机 hostname 加真实的死 pid：锁被挪开，载入成功，打出 warn。
- kimi 拒绝后重查：期间死掉的持有者被清掉，重试一次。
- 活 pid（测试进程自己）：锁不动，错误带 kimi 原话和持有者，不留下 runtime。
- 别的 hostname：不动。
- 解析不了的锁：不动。
- 非锁类 ACP 错误也带出 `data.details`。
- 失败后下一轮重新拉起进程并载入。
- 忽略 EOF 的进程被终止，它留下的锁被清掉。
