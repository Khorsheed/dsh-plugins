# Agent Note：历史 v0 会话被 0.1.5 迁移器拒收——message-tools 的 `source.op` 是规格外成员

Status: implemented

[English](2026-09-11-session-source-op-repair.md) | 中文

## 问题

3080 宿主切到 0.1.5-rc.1 后，大量历史会话加载失败：`session-format-v0-to-v1 refuses this format … source has unexpected member "op"`。根因：message-tools 的编辑/撤回功能往插件 source 里多写了一个判别字段（`{kind: 'plugin', plugin: 'message-tools', op: 'edit' | 'edit-trigger' | 'restore-assistant'}`）。0.1.2 时代的写入路径容忍未知成员；0.1.5 的 v0→v1 迁移器按「已发布 v0 键」严格校验、拒绝整个文件（payload-validation.ts：plugin source 只允许 `kind`/`plugin`，compact 另有例外）。prod HOME 下 375 个 v0 日志有 49 个中招——凡是用过消息编辑的会话都在列。

现行（v3 时代）格式的写入和读取路径容忍该成员——已在 0.1.5-rc.1 上活体验证：编辑消息、重载、会话正常重开、「已编辑」角标正常。严格的只有历史文件迁移闸。所以事故是数据形态的，不是代码形态的：message-tools 今天不需要为正确性改动，但任何未来的格式升级只要沿用同一套 released-keys 规则，就会拒收现在写出的会话。给上游提「插件 source 扩展成员的合法通道（或迁移时容忍未知成员）」的提案属于 docs/upstream-proposals。

## 决策

修数据，不动代码。`scripts/repair-session-source-op.ts` 删除受影响 v0 日志中 message-tools 行的 `source.op`（默认 dry-run，`--apply` 才写），原件保留在 `sessions-backup-source-op/`。两条布局规则让这个修复不那么显然：

- 日志是串接的 Zstandard 容器，**第一帧必须恰好是 header 行**（session-persistence-jsonl/src/zstd.ts）。整文件单帧重写对读取端就是结构性损坏——脚本初版正是这么干的，被开发实例的启动扫描当场抓住；修正版运行前已用备份把 49 个文件全部还原。最终版逐字节复制 header 帧，正文单帧按宿主写入端的原样配方（`zstdCompress` + `ZSTD_c_checksumFlag=1`）压缩。
- 验收跑在重写后的字节上：帧结构扫描、除被删成员外的明文等值、以及对每一行 message-tools 记录跑宿主自己的 `assertReleasedEventPayload`——就是当初拒收这些会话的那条规则。

在 0.1.5-rc.1 开发实例上端到端验证：一个 21 天前、内含编辑与撤回的历史会话修复后打开即迁移、完整渲染（含撤回展开器）。

## 考虑过而未选

**把判别字段挪出 `source`（比如每个 op 一个独立 plugin 名）。** 暂不：现行格式读得好好的，窄化谓词本来就把无 `op` 当作 legacy 撤回情形，在未来的迁移器重复这个严格性之前，改编码买不到任何东西——上游提案才是持久的修法。

**让宿主跳过坏行。** 否决：迁移器刻意 fail-closed（「source v0 artifact remains unchanged」），未知成员容忍与否正是该由宿主做的决定，不是插件侧分叉的理由。

## 后果

prod HOME 下 375 个 v0 日志复扫全部干净；49 个曾被拒收的会话恢复可读。这些历史会话里，修复过的编辑替换会按「撤回」归档投影——历史区的表面性误标，用户已接受。给插件作者的经验：会话记录是已发布格式——往里写扩展成员是前向敌对的，下一次严格迁移就是账单到期日。
