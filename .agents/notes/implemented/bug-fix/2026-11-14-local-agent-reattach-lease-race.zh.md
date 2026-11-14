# Agent Note: 重挂等待恢复中的子会话写句柄收尾

Status: implemented

## Problem

`packages/local-agent/tests/run-entry.spec.ts` 的重启续跑场景在 Linux CI 上失败：`SessionAlreadyOwnedError: session "member-r" is already owned by an active write handle`，但同一个包的完整测试在 macOS 上通过。

后缀同步失败后，`syncChildSessionWithRecovery` 会释放缓存的写句柄，再从磁盘重试。旧句柄还在关闭时，`resumeStaged` 可能同时重挂同一个子会话。调用轨迹显示的顺序是：恢复同步打开句柄、开始关闭、`reattach` 开始打开、前一个句柄才关闭完成。Linux 把独立打开的文件描述视为互相竞争的持有者，所以即使都在同一进程里，第二次打开也会失败。同样的时序在 macOS 上通过，不代表这个生命周期是正确的。

这不是死进程留下的失效锁，宿主的 `SessionWriteLease` 正在正确执行单写者规则。问题在于 `packages/local-agent/src/index.ts` 自己的两个操作让“关闭旧句柄”和“打开新句柄”重叠了。

## Decision

注册表用 `childWriteHandleReleases` 记录每个子会话正在进行的释放。`releaseChildWriteHandle` 移除缓存句柄后，把关闭 Promise 保留到关闭完成；之后每次 `acquireChildWriteHandle` 都必须先等这个 Promise 收尾，才能 stat、create 或打开会话。并发获取仍复用现有缓存中的同一个 Promise。

插件卸载也走同一个释放入口，并等待所有未完成的释放。串行点因此是关闭本身，不再依赖某个调用方等待全局同步集合。重挂不需要等待其他成员的同步工作。

不重试抢锁、不加超时、不删除锁文件，也不放宽单写者约束。测试 fixture 先释放 local-agent fiber，再释放其余 Cordis context，保证会话存储卸载前写好执行结束记录；仅调整 fixture 清理顺序并不能解决这个运行时竞态。

## Alternatives considered

- **只在重挂时等待 `childSyncs`。** 在 Linux CI 再次失败后否决：并非每条关闭和获取路径都由这个集合表示，关闭仍可能与下一次打开重叠。必须由待完成的释放本身提供共享的先后顺序。
- **重试获取锁，或把竞争当作暂时现象。** 否决：两个持有者来自同一个注册表的操作，真正的问题是关闭和打开的顺序。重试会掩盖这个生命周期错误，也不能防止其他顺序错误破坏日志。
- **删除锁文件或强制抢锁。** 否决：锁仍在正确使用。删除文件会破坏 inode 所有权检查，还可能放进一个真正并发的写者。
- **只释放测试用的整个 context，生产代码不动。** 否决：这样不足以解决问题，完整释放 fixture 后 Linux 仍然失败。释放顺序确实关系到执行结束记录能否保留，但它不能让之后的同步恢复与重挂串行。
- **在 Linux 上跳过重启场景。** 否决：这是受支持平台上的真实续跑缺陷，不是某个可选的平台能力。

## Consequences

同一子会话的新写入必须等上一次关闭完成，其他成员不会因为全局等待而互相阻塞。单写者保证与真实的跨进程占用错误都保留，不需要迁移数据或修改配置。

## Testing

`packages/local-agent/tests/child-session-sync.spec.ts` 新增用例，用测试闸门暂停上一次关闭，证明第二次获取在闸门放开前不会调用 `open`，并发获取共享同一个 Promise，释放记录随后会被移除。子会话同步与重启入口的定向测试均通过：12 + 9 项。

现有重启续跑场景仍覆盖“恢复同步后重挂”。本机全包测试通过：59 个测试文件、598 项测试，包含上述确定性的关闭与获取闸门用例。Linux CI 仍是发布前必须通过的检查。

## Related

- [本机 Agent 提供方共用一个镜像步骤写者](../simplification/2026-11-02-local-agent-shared-mirror-writer.md)
- [kimi 成员能从死进程留下的会话锁中恢复](2026-11-04-kimi-stale-session-lock.md)
