# Agent Note: capability-catalog 技能凭据展示区分为 metadata 凭据与环境变量引用

Status: implemented

[English](2026-08-30-capability-catalog-credential-refs.md) | 中文

本说明记录 `@khorsheed/dsh-capability-catalog` 技能详情弹窗的凭据展示重构，方案经代码评审对话（Codex）成形。

## 问题

技能详情弹窗的「凭据配置」区把凭据列表由**两个来源合并**而成：`metadata.credentials`（显式声明）+ 从技能正文扫描的环境变量引用（`$X` / `process.env.X` / `{{env:X}}`）。对 `dsh-self-restart-guard`，正文引用 `$DSH_HOME`、`$GUARD`、`$DSH_SESSION_ID`，于是弹窗把 `DSH_HOME` 当成用户可配置凭据，甚至显示「已配置」——因为 `DSH_HOME` 在 agent 自身环境里已存在。这些是 agent 的运行时输入，不是用户机密，把它当成可配置凭据表单（徽标 + 掩码输入 + 保存）是误导。

## 决定

**`metadata.credentials` 是用户可配置凭据的唯一权威来源。** 正文检测出的环境变量引用单独、只读、折叠地呈现，绝不作为凭据表单。

- 数据模型（`types.ts`）：`CatalogSkillDetail` 增加 `environmentRefs?: readonly string[]`。
- `loadSkillDetail`（`skills.ts`）：可编辑的 `credentials` 数组只来自 `metadata.credentials`；环境变量推导出的 key 放进 `environmentRefs`。
- 弹窗（`SkillDetailModal.tsx`）：「凭据配置」表单只渲染 `data.credentials`；新增折叠的「引用的环境变量」`<details>` 把 `data.environmentRefs` 以只读 chip 列出，并提示这些由运行环境/调用方提供、不能在此配置。
- 文案：新增 `envRefs` / `envRefsHint`（中英）。`credentialsHint` 不变，因为现在它只描述声明的 metadata 凭据。

## 备选方案

- **保留合并列表但给推导出的引用重新贴标签。** 否决：合并会丢失来源，弹窗一旦合并就无法可靠区分「声明的机密」与「正文扫描的环境变量引用」。
- **给每个凭据状态加 `origin: 'metadata' | 'body-env'`。** 考虑过；单独的 `environmentRefs` 数组对消费者更简单，且不改动 `CredentialField` 表单。
- **尝试把 shell 局部变量（如 `GUARD`）从 refs 里过滤掉。** 本次否决：通过 Markdown 正则无法把 `$GUARD` 与真实环境变量可靠区分，而只读 chip 列表以「引用的变量」诚实呈现，比一个做不到「完美」的过滤器更好。

## 影响

- agent 自身的运行时环境（DSH_HOME、DSH_SESSION_ID、GUARD）不再显示「已配置」/ 保存表单，而是一份只读引用列表；声明的机密保留完整 `CredentialField` 表单（徽标 + 掩码输入 + 保存）。
- `shellEnv`/`envHint` 未改动——它们仍为自动检测出的引用注入/别名 `$DSH_<KEY>` 环境变量，让模型能读取；仅 UI 展示变化。后续兼容性审计可把这些收窄为仅显式声明。
- build + 68 个宿主侧测试 + `check:plugins` 全绿；无组件测试（由部署冒烟验证）。
