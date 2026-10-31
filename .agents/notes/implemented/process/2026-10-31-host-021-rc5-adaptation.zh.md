# Agent Note: host 0.2.1-rc.5 adaptation — reasoning display without plugin migration

Status: implemented

[English](2026-10-31-host-021-rc5-adaptation.md) | 中文

## Problem

rc4 适配完成但尚未进入生产或发布 npm 时，宿主发布了 rc5。发版决策需要精确的 rc5 源码基线和全新的兼容性结果，既不能重复做两批发版，也不能假定 rc4 的证据天然覆盖 rc5。

## Decision

开发依赖图和两个固定工作流的宿主都跟踪 `dsh-v0.2.1-rc.5`（`b830ec950faba0a46dda564be3e2d854afed94f1`），rc4 与 rc5 合并为一次部署和发布波次。

除发布元数据外，rc4 到 rc5 的变化集中在 reasoning 展示。`ReasoningBodyOwnerProps` 现在同时携带 `rawText` 和可展示的 `text`；Content Factory 的约定不变。社区包没有消费这个 Body 插槽，也没有手工构造它的 owner props，因此这次差异不需要插件源码迁移、提高最低宿主版本、开做此前受阻的包或退役兼容路径。reader 的自持 HTTP provider、file-preview mentions 和 mobile 的旧 View CSS 在其支持的宿主范围内仍然必要。local-agent 独立渲染的 reasoning 不会被默认视为继承了官方 signature 清理；目前没有证据证明那条路径存在缺陷。

## Alternatives considered

**先部署并发布 rc4，再为 rc5 重做一次。** 不采用：rc5 的完整差异很小，社区消费者无需迁移，一次生产观察窗口和 npm 波次即可覆盖两者，同时仍分别取得测试证据。

**把官方 reasoning 清理复制到每个社区展示组件。** 本兼容波不采用：官方 Body 约定在这里没有社区消费者，local-agent 使用独立展示路径，context-lens 则有意展示诊断原文。产品行为变化需要独立的复现和测试。

**复用 rc4 的全绿门禁。** 不采用：跨宿主验收会清除 TypeScript 缓存，并针对精确的 rc5 源码检出强制重新生成类型。

## Consequences

基线改动包括宿主固定版本、再生的锁文件、CI 引用和本记录，并保留完整的 rc4 源码适配历史。生产验收完成后，所有声明 `dsh.compat.verifiedHost` 的包（包括 private 包）都已将该字段前移至 `0.2.1-rc.5`；最低宿主要求、engines 范围和包版本保持不变。

npm 包尚未发布。发布前，3080 生产部署需要连续三天无事故运行。

## Testing

针对精确 rc5 检出清除 TypeScript 缓存并强制类型生成后，`pnpm gate --all` 的 17 步全部通过：所有包的构建和测试、401 个脚本测试、文档与卫生门禁，以及 42 个经过验证的包 tarball。官方 rc5 的九项构建门禁全部通过；装配后的 Web reasoning 浏览器测试覆盖普通流和带 signature 前缀的流，两者均通过，包括展开正文和不显示 signature 元数据。

生产验收已通过 `deploy:3080` 按依赖序向 3080 完整部署 42 个包。composition preflight 与 canary 均通过；launch receipt 已就绪，其中 `hostPackageVersion` 为 `0.2.1-rc.5`。线上 31 个社区 client bundle URL 全部返回 HTTP 200。ankh-guard 技能还通过了真实 `SkillRegistry` 的 list 与 get 往返。

## Related

- [Host 0.2.1-rc.4 adaptation](2026-10-27-host-021-rc4-adaptation.md)
