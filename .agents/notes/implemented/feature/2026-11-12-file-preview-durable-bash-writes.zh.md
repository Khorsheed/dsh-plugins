# Agent Note: file-preview 把已验证的 bash 写入事实持久化到会话日志

Status: implemented

[English](2026-11-12-file-preview-durable-bash-writes.md) | 中文

## Problem

此前 bash 写出的产物在宿主重启后可能从产物视图消失，因为采集器的事实源只是一张按会话保存的内存表。`session/created` 再从工具事件重放重建这张表。官方已能持久化插件自有事实后，重建不再必要；两份事实源也让产物视图依赖进程寿命，而不是会话日志。

## Decision

保留现有高精度 bash 提取与 `fs.stat` 验证，只有确认是常规文件的候选才追加版本化 `plugin:file-preview/bash-write`，包含路径、turn、step 和源调用序号。失败命令、缺失文件和不支持的命令形式不产生记录。记录写入失败只降级/跳过，不伪造工具结果。

`FilePreviewService.list` 与 `turnFiles` 用 `pluginRecordOf` 读取并校验记录，保持首次出现顺序、去重和按回合归属，不再在 `session/created` 重建内存事实表。没有持久记录的旧日志只在读取时回放旧的工具事件，保证升级不会抹掉旧产物。采集器在进程内只保留待验证命令候选。

新的持久化路径把 file-preview 的 minHost 前移到 0.2.2-rc.2。记录为 `ignorable: true`，不进入模型 surface，也不唤醒 Agent。官方 bash 仍不报告写入路径，因此采集器在上游提供该事实前继续保留。

## Alternatives considered

**内存表仍作事实源、插件记录作镜像。** 否决：会保留双源不一致。持久记录为权威；旧日志回放仅是兼容读取路径。

**扩大命令推断范围提高覆盖率。** 否决：`cp`、`mv`、Python 等不确定命令会制造假产物，现有保守集合不变。

**用插件记录承载助手文本或模型上下文。** 否决：这些是给人和视图看的文件事实，不是提示词或助手消息。

**现在退役整个采集器。** 否决：官方 bash 仍不报告写入路径。退役的只是内存事实表；S2 继续跟踪原生 bash 写入元数据。

## Consequences

产物现在可以在真实 JSONL 重启后找回，不依赖进程内存。普通 write/edit 折叠、内容读取、diff、回合归属与删除行为不变。无记录旧日志仍可通过兼容回放读取；异常载荷被忽略，不伪造文件。

minHost 只在新 API 必需处前移。源码变更不代表已经部署生产或发布 npm。

## Testing

在 rc.2 通过 file-preview 24 个测试文件、233 项测试。持久化 5 项覆盖 stat 验证与部分成功、真实 JSONL 重启、list/turnFiles 直接读取、旧日志回放和异常载荷拒绝；现有采集器、折叠、读取与预览测试全部通过，覆盖正式 V4 工具生命周期。宿主与浏览器 bundle 构建均通过。

## Related

- [eval 生命周期通知](2026-11-12-eval-lifecycle-notifications.zh.md)
- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.zh.md)
- [官方能力路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [上游接缝登记处](../../../../docs/upstream-seam-registry.md)
