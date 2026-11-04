# Agent Note: 宿主 0.2.2-rc.1 适配——执行器拆分与兼容的文件变更

Status: implemented

[English](2026-11-04-host-022-rc1-adaptation.md) | 中文

## Problem

宿主 0.2.2-rc.1 把工具注册表的 native/PTC 模式换成独立挂载的执行器，把工具派发改为批处理，删除手工模型选择 ref，并收紧 Session 发布和历史投影的生命周期。它还加入了 `apply_patch`，其展示元数据省略 Add 操作和新建移动目标。社区需要基于精确源码做兼容波，不能只放宽 peer 区间，也不能假设 rc5 的证据已经覆盖这些变化。

## Decision

开发依赖图和两个固定工作流跟踪 `dsh-v0.2.2-rc.1`（`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）。cordis 钉在 4.1.0，配套 loader/include 钉在 1.1.0，schemastery 钉在 3.19.0。rc1 与旧 0.1 preset 回退共用同一份 schemastery 3.19.0；旧包的 `^3.18.1` 依赖已允许这一版本。扩展官方 peer 区间，但不统一提高所有包的最低宿主。

DSH 子 profile 删除 `tools.config.mode`：默认 native，`DSH_TOOLS_MODE=ptc` 选择 PTC，未知模式不挂任何执行器。`local-agent-dsh` 及其 headless bundle 的地板提高到 rc1，因为同一份 patch 无法保留旧 `tools.mode` 的 PTC 路径。父侧 local-agent 核心改为探测公开 `executable` 方法：rc1 用批处理，旧宿主保留单调用。

provider、model 和 reasoning effort 移入 `agentOptions`。测试组合挂载官方 Session 投影服务，并等待异步服务初始化；手工 enter 的 Session 在 append 前先 announce。`context-lens` 用泛型透传展示值，使观察器同时兼容旧的完整装配结果和新的工具前展示结果。

file-preview 使用官方 `dsh-fs-patch` 解析器和纯文本补丁应用函数，按需可选加载，旧宿主不会在模块求值时失败。成功结果中的 Add 恢复正文，Update/Delete 保留真实结果 diff。移动目标若未出现在元数据中，则在官方应用函数能证明结果时从源文件文本推导；新建目标没有旧文本，删除行数为 0。绝对元数据路径只在后缀唯一时映射回补丁路径。停止或失败的提交不凭空新增文件。Remote 与直读面板共用同一 fold 和可选解析器。

移动端现有公开 Session 和展示接口已通过首轮 rc1 构建与测试，无需修改源码。真机和完整浏览器检查与这一机械结果分开记录。Quote 保持现有交互，由用户在 Chat 中比较官方与社区设计后再决定。Forge、Stats、Team、Speech 等官方能力整合留到 3080 的 rc1 验收之后。

## Alternatives considered

**统一提高所有包的最低宿主。** 否决：local-agent 的公开能力探测保留父侧旧调用路径，file-preview 的可选解析器让无法解析补丁的宿主保留旧行为。只有 DSH 子 profile 相关包需要提高地板。

**自己写补丁解析器，或把 oldText 为 null 的文本都当作新建。** 否决：官方解析器和应用函数避免第二套语法，也能区分已确认的新建与未知旧内容。部分执行无法证明 Add 已完成。

**用官方新能力整包替换 quote 或其它社区包。** 本兼容波不采用：quote 的侧边对话、来源预览和扩展动作保留，更大的整合另有后续波次。本轮没有整包退役。

**把 alpha 差异或 rc5 的全绿门禁当作 rc1 的最终证据。** 否决：所有验收使用精确的 rc1 tag，清除 TypeScript 缓存，真跑执行器和浏览器检查，不用 alpha 发布物替代。

## Consequences

开发依赖图和工作流钉版前移到 rc1，包的发布版本不变。DSH 子 profile 的地板高于 local-agent 家族其它包。file-preview 保留原最低宿主，没有可选解析器时回退为仅使用元数据。Session 生命周期与历史控制器变化在相关测试中显式处理，不用类型断言掩盖。

全仓干净门禁、quote 浏览器对比、移动端浏览器/真机矩阵和 3080 部署仍待完成。本记录不代表 npm 发布或 push。只有实际验收覆盖 rc1 的包才前移 `verifiedHost`；移动端未验证的设备路径继续明示。

## Testing

聚焦测试已通过：headless 56 个、local-agent 496 个、file-preview 228 个、context-lens 311 个、mobile 168 个。覆盖真实 native/PTC 调用、`apply_patch` 的新增/更新/删除/移动、直读面板与 Remote 一致性，以及新的历史控制器。file-preview、mobile 和 headless 的最终构建也通过。全仓干净门禁和生产验收仍待完成。

## Related

- [宿主 0.2.1-rc.5 适配](2026-10-31-host-021-rc5-adaptation.zh.md)
- [file-preview PTC dispatch diff 修复](../bug-fix/2026-10-27-file-preview-ptc-dispatch-diffs.zh.md)
