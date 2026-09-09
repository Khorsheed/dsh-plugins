# Agent Note:preflight 快照跳过运行时条目与 scratch

状态:已实现

[English](2026-09-10-ankh-guard-preflight-snapshot-runtime-entries.md) | 中文

## 问题

reconfigure cutover 的 preflight 在逐字节复制的隔离 `$DSH_HOME` 上干跑目标组合,而复制对任何特殊文件系统条目硬拒绝。在跑部署自己的运行时端点——prod 的 `local-agent/member-bridge.sock`,由运行中实例持有的 unix socket——让所有带 member-channel 的部署在 reconfigure 时必挂(还没停任何东西就被拒:`preflight snapshot refused a special filesystem entry …`)。唯一绕行是先 unlink 在跑的 socket,这比跳过更危险:bridge 在服务中途断开,而 socket 没有可复制的内容,下一个 boot 会自己重建。

同一份复制还不分大小地包含一切。0.1.2-rc.1 翻线时,一棵 24 GB 的 `scratch/` 把 prepare+canary 拖过了凭证的十分钟有效期:target 已经 ready,canary 的凭证复检失败,cutover 触发了 restore。

## 决策

`createPreflightSnapshot` 对没有可复制语义的条目改为跳过而非拒绝:socket 与 FIFO 被丢弃(并计数),指向 socket/FIFO 的符号链接一并丢弃——否则以链接形式出现的运行时端点仍会撞上拒绝。设备节点和更异类的条目继续 fail-closed;可写逃逸、悬空链、环、包含性检查全部不动。顶层 `scratch/` 树不进复制(按定义就是瞬时空间,且它主导 home 体积)。被跳过的条目计数会返回,供观测。

`reconfigure` 动词给快照步骤计时;复制超过凭证有效期一半时,CLI 提前打印警告,点名这对矛盾和解法(切流前紧挨着重新 record;保持 home 精简)。

## 放弃的替代方案

**保持拒绝并把 unlink 绕行写进文档。** 放弃:为了满足安全机制而摧毁活的运行时状态,把机制的意图颠倒了,而且跳过不削弱快照的任何保护。

**调用方可配置的 exclude 清单。** 放弃:没有消费者的表面积——已知的超大树只有约定的顶层 `scratch/`。出现第二个需求时再加。

**设备节点也跳过。** 放弃:dsh home 里出现设备节点是真正异常的信号,异类情形保持 fail-closed 是对的。(无 root 不可测;该拒绝分支代码未动。)

## 后果

- 带 member-channel 的部署可以 reconfigure 了,不用再碰活的 socket;unlink 绕行作废。
- 带大 scratch 树的 home 不再与凭证有效期赛跑;剩余的慢复制会提前得到可行动的警告。
- 测试描述新行为:原来的 fifo 拒绝用例改写为跳过覆盖(socket + fifo + socket 链接 + scratch)。
