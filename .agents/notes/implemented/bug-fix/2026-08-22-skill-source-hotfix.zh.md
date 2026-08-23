# Agent Note: hotfix——随包 skill 加载失败（注册缺 `source` 字段）

Status: implemented

[English](2026-08-22-skill-source-hotfix.md) | 中文

## 问题

已发布的 8.9 在 skill catalog 里能列出 `dsh-self-restart-guard`，但调用时炸：`loaded skill "dsh-self-restart-guard" source must be a string`。注册表在**加载时**而不是注册时校验 `source`:catalog 路径从不检查，所以之前所有验证都不可见（列出都正常；直到有用户在演示实例上输入"重启你自己"才暴露）。我方根因：结构体 `SkillRegistrySlice` 窄类型把注册收窄成 `{ name, description, content }`，绕过了真实的 `SkillRegistration` 类型——那里面 `source: SkillSource` 是必填。

## 决策

- 注册传入 `source: 'runtime'`(runtime 桶——与注册表自己的 runtime provider 默认值一致）。
- 新增对**真实 `SkillRegistry`** 的往返测试（`@deepseek-ai/dsh-skill`，加为 devDependency):catalog 列出 + `registry.get` 正文加载。已做负向验证：回退修复后精确复现生产错误。
- 便宜的契约断言（`source: 'runtime'`）保留。

## 考虑过但未选

- **改在 harness 里修**(`register()` 默认 `source`)——那是更治本的上游加固，走上游变更管道；但已发布产物无论如何需要显式带上该字段。两者都值得做，我们这侧先发。
- **等组合回滚分支一起**——不行：8.9 已发布，skill 对社区是坏的；这是独立 hotfix 分支，从 main 直接切出。

## 后果

- 任何地方的 runtime skill 注册都必须带 `source`；对真实注册表做 list + get 往返是这类注册的测试模板。
- 本 hotfix 需要在 8.9 之上发补丁版；版本裁剪仍归维护者。
