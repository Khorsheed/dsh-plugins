# Agent Note:kimi 空流预约不再留下 step 空缺

Status: implemented

## 问题

Context Lens 读一个 kimi 成员子会话日志时报 `stored log is corrupt: SessionFormatError: step/start does not match the open turn and next step`(bf220f56,turn 2):日志从 step 1 直接到 step 3,step 2 从未写入。根因:一个 think/text 流预约了 step 2 却始终没有任何内容(那个 wire step 只有推理 + 工具调用,没有该种类的文本)。`finalizeStep` 在块为空时提前返回——既不释放预约也不写任何东西,而折叠早已在 step 2 被预约的前提下算好了坐标,于是写到了 step 3,留下 released-log 读取端拒绝的永久空缺。

## 决策

两半保一个不变量——日志的 step 必须稠密且严格递增:

- `finalizeStep` 的空块分支现在释放坐标:从 `reservedSteps` 移除该 step(没有其他未决流共享时),条目标记 sealed(之后再有 delta 会开新预约),live 预览收尾。空预约绝不允许钉住一个它永远不会写的 step。
- 镜像折叠在 `finalizeBefore` 之后,用最新会话账本 + 剩余预约重算坐标,取 `min( provisional, sequential)`:下方被 finalize 的预约已入账本,被释放的预约让出编号。`nextFoldStep` 不再提前占位(只在最终坐标处 mark 一次),坐标调小后也不会与同批后续单元撞号。

## 备选方案

- **写一条空 step 三元组补空缺**:没有内容的 assistant 消息就是幻影请求记录,比空缺更糟。释放 + 重算才保住诚实。
- **每次选坐标前把所有在途流都 finalize**:每次工具折叠都提前封掉实时文本,只为空预约这一种情形牺牲 live 节奏,不值得。
- **只释放不重算**:provisional 坐标是在预约仍被占用时算的,折叠照样写到被释放 step 的上方——空缺依旧。两半缺一不可。

## 影响

- 新的 kimi live 轮次不会再因无内容流预约产生 step 空缺;released-log 读取端(以及 Context Lens)恢复可读。
- 已损坏的历史日志保持原样(只增不改;要不要重镜像旧 wire 是另一个工具问题)。

## 测试

`pnpm --filter @khorsheed/dsh-local-agent-kimi test`(285):新增 session-mirror 用例让 step 2 被空内容流预约,再把整条 wire 折完——写出的 step 必须恰好是 1..N 无空缺,且日志通过 released-log 校验(旧代码会跨过空预约写到 step 3)。
