# Agent Note: 插件独立性检查——包约定转为机械门禁

Status: implemented

[English](2026-08-18-plugin-independence-check.md) | 中文

## Problem

本仓库的包约定（自挂载、身份三角、除两对特许组合外禁止跨插件依赖、缺能力降级而非爆炸）是"每个插件都能独立安装、运行、卸载"成立的前提——整合包分发的叙事正依赖这个性质。此前这些约定只靠评审维持，而 2026-08-18 对全部 17 个包的审计表明漂移会累积：taskpilot 曾手搓 client bundle 且 invariant 名不一致，身份清扫又在五个包的 README 和 patch 注释里发现 `@deepseek-ai/dsh-*` 的滞后自引用。多个 agent 并发改这个仓库时，只存在于 AGENTS.md 文字里的约定会悄悄被侵蚀。

## Decision

`scripts/check-plugin-independence.ts`(`pnpm check:plugins`）扫描 `packages/` 下每个包，发现以下情况即失败：

1. **自挂载**——缺 `dsh.bundle.patch`、patch 文件不存在、或 patch 未列入 `files`（家族内部行包经 `NO_OWN_PATCH` 豁免，目前只有 `local-agent-tool-subagent`)。
2. **身份**——`cordis.patch.yml` 里未加引号的 `name:` 值、没有与包名匹配的 patch 行、`src/invariant.ts` 的 PACKAGE_NAME 与包名不一致、浏览器半未走共享的 `clientBundle` 助手（或 id 不匹配）。
3. **外部 scope**——README 和 patch 文件以 `@deepseek-ai/` 引用本仓库自己的包（整合前的旧身份）。
4. **跨插件边**——源码 import 或 package.json 依赖指向 `@khorsheed/*` 且不在 `ALLOWED_EDGES`(local-agent 核心/伴侣家族与 ui-file-preview 客户/宿主对）之内；仓内依赖规格必须恰为 `workspace:*`。
5. **inject 纪律**——不得 inject 任何 `@khorsheed/*` 包；社区提供的服务（`localAgent`、`localAgentDshHeadlessStartup`、`shortcuts`）只允许其所属家族 inject(`COMMUNITY_SERVICE_INJECTORS`)，其余包一律用 `ctx.get` 探测并降级。
6. **发布元数据**——非 private 包的 `repository` 必须指向本 monorepo 且 `directory` 正确，`keywords` 必须含 `dsh-plugin`。

该检查是全树的（跨包边和外部 scope 引用无法按暂存文件评估），因此不进 pre-commit 钩子；改由它的 vitest spec 对真实 `packages/` 树重跑 `scanTree`，使 `pnpm test:scripts`——按 AGENTS.md 本就是提交前义务——在违规时失败。白名单（`ALLOWED_EDGES`、`COMMUNITY_SERVICE_INJECTORS`、`NO_OWN_PATCH`）是执行点：任何新的跨包需求都要在引入它的提交里刻意加入白名单。

## Alternatives considered

- **并入 `check-repo-hygiene`**——否决：hygiene 检查器是接在 pre-commit 钩子上的暂存集内容扫描器，独立性检查是全树结构审计。合并要么拖慢每次提交，要么被迫用暂存集近似、漏掉跨包边。
- **仅靠评审维持**——否决：本次审计发现的正是评审漏掉的漂移。
- **只做 CI 门禁**——暂不采纳：仓库还没有 CI 工作流；spec 挂进 `test:scripts` 已能在本地给出同样的失败信号，未来 CI 可直接调 `pnpm check:plugins`。

## Consequences

- 约定漂移从事后复盘发现变成测试失败；特许组合仍然可行，但必须显式改白名单——这正是 AGENTS.md 要求的评审时刻。
- 检查器只在结构上认识当前包清单（扫描 `packages/*`)，新包自动被覆盖；新*种类*的例外需要改白名单并补 spec 用例。
- 它不做运行时共存干扰检查（slot id、locale 命名空间冲突）——那些仍属审计范畴；它所强制的 manifest 层约定正是让冲突难以发生的部分。
