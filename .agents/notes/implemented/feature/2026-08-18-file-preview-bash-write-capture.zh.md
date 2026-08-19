# Agent Note：产物列表的 bash 写入采集

Status: implemented

[English](2026-08-18-file-preview-bash-write-capture.md) | 中文

## 问题

产物列表（`filePreview.list`）把会话日志折叠成以 `file_path` 为键的 `read`/`write`/`edit` 工具调用——agent 通过 `bash` 写的文件（heredoc、`>` 重定向、`tee`、`sed -i`）对它完全不可见。真实会话实测（whalesong 游戏设计）：十几个 HTML 产物几乎全走 `bash` `cat > … <<'EOF'` heredoc，产物列表一个都没有。fold 刻意是纯日志折叠：不碰文件系统、没有环境上下文，`$DSH_HOME/…` 这类路径它自己解析不了。

## 决策

在 file-preview 宿主半边落地上游缝登记处的 **S2** 绕行：宿主侧采集器把日志里的 `tool/call`（bash）→ `tool/result` 配对变成验证过的写入记录，存在按会话的内存登记表里，`list` 把它并入 fold 条目。

- **采集**（`src/bash-writes.ts`）：`tool/call` 的 `name === 'bash'` 时，从命令里用高精度扫描器提取写入目标——单 `>` 重定向（覆盖 `cat > path <<'EOF'` heredoc）、`tee`（追加形式跳过）、`sed -i … path`（内联脚本后的第一个非选项 token）。`>>`、`2>`、`>&`、`<>`、`&>`、heredoc 体内的一切（HTML 的 `>` 内容绝不能读成重定向）、以及暂缓形式（`cp`/`mv`/`python open`）全部忽略。目标按采集器自己的环境展开（`$VAR`/`${VAR}`——未设置的环境变量直接拒绝而非瞎猜）、`~`、以及相对路径按会话 cwd 解析；glob 与命令替换拒绝。
- **验证**（宁缺毋滥）：配对的 `tool/result`（按 callId 关联）触发 `fs.resolve` + `fs.stat`，只有真实存在且为文件的路径才记录。
- **登记表**（按会话、受 `maxFiles` 限制）：`session/created` 时重放会话自身历史重建——宿主重启不丢，且无需自有持久化；新事件经 `session/event` firehose 流入，订阅挂在 `ctx.effect`（fiber 卸载自动清理）。
- **合并**进 `list(agent)`：fold 已认识的路径保持其日志派生条目；只有真正的新路径才追加（op `write`，用发起调用的 seq/turn/step）。
- **配置**：`captureBashWrites`（schemastery，默认 `true`）——部署侧的开关。

**为什么不做登记文档原案里的"追加 log-only 会话事件"**：官方 `Session.append(type, data)` 无法写信封上的 `ignorable: true` 标记，而持久化读回对 `KNOWN_SESSION_EVENT_TYPES` 之外的未知类型**直接 throw**（"refusing to interpret the log"）。插件事件进日志会在下次读回时毒化整个会话。这本身是新的上游缝（known-event-types 注释说插件事件的注册面 "deferred until such a consumer exists"——我们就是第一个消费者），记为 S2 的第三个退役条件。侧登记表在不碰日志的前提下达成同样的用户可见结果。

## 备选方案

- **用 `Session.append` 追加派生事件**（登记文档的原案）。否决：核实后 `append` 写不了 `ignorable: true`，持久化读回拒绝未知的非 ignorable 类型——事件会让会话重载失败，而不只是折叠不到。
- **在 `list` 里扫文件系统。** 否决：扫描回答的是"现在存在什么"，不是"这次会话碰过哪些"；而且会把纯日志 fold 拖进 fs 领域。采集器让 fold 保持纯日志，fs 检查只发生在日志指出的地方。
- **在 fold 内部解析 bash 写入。** 否决：fold 没有环境（`$DSH_HOME`）、没有相对目标的 cwd 解析、也没法关联"调用 → 落定结果"；这三样采集器都有。

## 影响

bash 写入的文件（heredoc、重定向、`tee`、`sed -i`）现在会进产物列表，预览走 `read` 读当前内容——没有 diff 历史（与 Code Mode 派发同样的限制，见 S3）。误报被"模式集 + `fs.stat`"双重约束（验证前已被删的临时文件会被丢弃）。采集在宿主进程内存里；重启靠重放会话日志重建，但重放时已不存在的路径会被丢弃（宁缺毋滥）。会话日志绝不被改动，持久化、重放、"模型可见 ⟺ 已记录"不变式全部不受影响。客户端半边零改动——它只是看到更多条目。测试：解析/展开单测 + 采集器行为（采集、缺文件丢弃、非 bash 忽略、重放、dispose）+ `list` 合并，宿主 86 个测试全绿。
