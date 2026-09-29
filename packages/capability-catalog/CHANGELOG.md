# 变更记录

## 0.1.97（2026-09-30）

- **设置面直接调用 schemastery 的类型化 `.volatile()`**：0.2.0 开发线解析到 schemastery 3.18.4，其 `Schema` 已声明 `volatile()`——手写的 `VolatileCapable` 强转探测不再类型重叠（TS2352）。运行期双线行为不变：探测在 0.1.5 的 schemastery 3.18.2（无 `volatile` 方法）上仍回落到普通字段
- 加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0

## 0.1.96（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2——3080 生产实证线随宿主基线切到 rc.2；rc.1→rc.2 对本包无破坏性变更，逐类清点见 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-27-host-017-rc2-breaking-changes.md)），全量构建+测试双绿。

- **默认模式的 chip 不再加高亮**：技能详情「生效的 preset」区块与对比卡片的 chip 行回答的是「哪些模式加载它」，而默认 preset 的 chip 此前带主色底，读起来像「仅该模式可用」。现在所有 chip 同一权重；默认性移到 chip 悬停提示（新增 `modeChipDefaultHint`），并保留在模式下拉的「（默认）」后缀
- README 中英统一为中文主版；截图整理——详情弹窗与 MCP 两张从未存在的引用删除、MCP server 管理弹窗实拍落地，全部图片引用可解析

## 0.1.95（2026-09-26）

首个公开发布。
