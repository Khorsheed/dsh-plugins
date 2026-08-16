# Agent Note: Message timeline plugin carries the community @khorsheed scope

Status: implemented

[English](2026-08-15-message-timeline-khorsheed-scope.md) | 中文

## Problem

消息导览插件最初以 `@deepseek-ai/dsh-client-message-timeline` 落地并带 `publishConfig.access: public`,但 `@deepseek-ai` npm scope 归上游厂商所有:本 fork 没有发布权限,而下一次按上游方式的发布会尝试把该插件发布到一个本 fork 无法控制的 scope 并失败。

## Decision

包改名为 `@khorsheed/dsh-message-timeline`——本 fork 另一个社区插件(`@khorsheed/dsh-ui-shortcuts`)已在使用的 scope——并标记 `private: true`,移除 `publishConfig` 与指向上游的 `repository` 字段。所有引用同步更新:web-app bundle 的 `cordis.patch.yml` 行与 `package.json` 依赖、包自身的 `cordis.patch.yml`、invariant 伴生包的 `PACKAGE_NAME`、tsdown bundle id、apply 规格的导入、双语 README 标题,以及 `tsconfig.base.json` 的显式 paths 条目(裸名、`/client`、`/invariant`)——`@deepseek-ai/dsh-*` 通配符无法映射外部 scope 的名字。这组显式 paths 还顺带修复了一个既有门禁违规:旧名的 `dsh-client-message-timeline` 后缀通过通配符永远映射不到 `packages/client/message-timeline` 目录,`verify-cordis-config` 的源码面解析对本插件一直在报错。

## Alternatives considered

**保留 `@deepseek-ai` 名字但不发布。** 否决:一个看起来可发布却发布不了的包是坏的承诺——发布机制把仓库内包都当 release 成员处理。

**把包迁到独立插件仓库**(dsh-ui-shortcuts 模式)。暂缓:该包的测试依赖仓库的 vitest workspace、tsconfig 基底与覆盖率门禁;包本身自洽,以后迁出成本低,且 `private: true` 期间 link/tarball 分发不受影响。

## Consequences

归属名实相符,workspace 约束门禁通过(`packages/` 下非 `@deepseek-ai` 包必须为 private,现在满足)。以 `@deepseek-ai/` 前缀为筛选条件的门禁——client bundle 纯度规格的条目过滤、发布基线——会静默跳过这个包;纯度检查的缺失可接受,因为该包的组合关系由其自身规格覆盖。分发仅限 `dsh plugin add link:`/tarball;若要在 `@khorsheed` 下做 npm 发布,需先完成上述迁出,并把 `@deepseek-ai/dsh-client-*` 同侪依赖从 `workspace:` 换成真实版本区间。
