# Agent Note: 委派端点可观测性与自定义端点文档

Status: implemented

[English](2026-08-16-delegation-endpoint-observability.md) | 中文

## Problem

一次 3080 委派失败（claude 报模型不可用）追溯到长驻 dsh 宿主**隐式继承了启动 shell 里陈旧的 `ANTHROPIC_BASE_URL`**——宿主环境是启动时快照，且有效端点无处可查。社区用户也普遍想把委派路由到自托管模型路由器。

## Decision

端点处理保持现状（不新增配置面）：claude 用 cordis `baseUrl` 配置或宿主 `ANTHROPIC_BASE_URL` 环境；kimi 和 codex 经各自作用域 `config.toml` 路由，手动编辑、预置逻辑尊重不动。本次新增的是**可观测性与文档**：

- 每个 harness provider 每次运行解析一次有效端点并以 info 级别记录（`subagent-<h>: delegating via <endpoint>`），不含 key。失败运行的报错文本点名它使用的端点——路由异常的委派从日志和报错即可诊断，正是 3080 事故暴露的缺口。
- 三个 bundle 的 README 各加"自定义端点"节：写清路径（配置 vs 环境 vs 作用域 config.toml）、**长驻宿主的启动快照坑**、OAuth/凭据暴露警告（自定义端点会收到作用域 token），以及 codex 特有的——内置 provider 不可覆盖、`OPENAI_BASE_URL` 不被认，必须新增 `[model_providers.<name>]` 条目并配 `model_provider` 选择。

## Alternatives considered

- **三个 harness 的 settings 驱动自定义端点 UI。** 本批经实测否决：codex 拒绝覆盖内置 provider（必须新增自定义 provider + 模型选择），kimi 凭据绑定对路径敏感，完整 provider 编辑器（端点 + 模型 + 认证键）是更大的独立任务。文档化手动路径满足当前需求。
- **白名单委派环境、剔除继承的 `ANTHROPIC_*` 名。** 重新考虑后否决：社区"终端 export 即用"是合理预期，剔除会破坏它；修复方向是可观测性（记录有效端点）而非隐藏继承。

## Consequences

- 路由异常的委派现在在 info 日志与失败报错中点名端点，补上 3080 级诊断缺口。
- 环境快照坑与自定义端点的凭据暴露风险在三份 README（双语）中均已文档化。
- kimi 的有效端点读作用域 `config.toml` 的 `[providers."managed:kimi-code"].base_url`；codex 读 `model_provider` 选中的 `model_providers` 条目。两处读取仅用于诊断，容忍缺失/损坏的 config。

## Verification

- provider 单元套件在新增端点读取/日志后全绿（claude 17、kimi 37、codex 19 测试）。
- 翻译配对：重录三份 README 编辑后 25 对同步。
