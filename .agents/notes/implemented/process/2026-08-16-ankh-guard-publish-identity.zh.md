# Agent Note: ankh-guard 发布身份——khorsheed 是发布渠道

Status: implemented

[English](2026-08-16-ankh-guard-publish-identity.md) | 中文

## Problem

ankh-guard 曾有两个名字：monorepo 里的 `@deepseek-ai/dsh-ankh-guard`（发布家族成员，由 base bundle 挂载）和 npm 上的 `@khorsheed/dsh-ankh-guard`。文档在两者之间摇摆——安装章节一度写了从未发布过的 scope,2026-08-16 的一次 README"修正"还把用户指到了错误的名字。官方渠道对维护者不可用：npm 的 `@deepseek-ai` org 和 GitHub 的 `deepseek-ai/deepseek-harness` 对工作账号都是只读，家族发布既无法从这里触发，也不应尝试。

## Decision

发布身份是 **`@khorsheed/dsh-ankh-guard`**；发布源是独立仓库 `Khorsheed/dsh-ankh-guard`（本地镜像在 `$DSH_HOME/scratch/ankh-guard-ref`)，发布时从 monorepo 包同步。monorepo 包保留 `@deepseek-ai` 家族名——在 fork 里改名会冲撞 monorepo 命名约定并搅动 base bundle 引用。安装文档一律写 khorsheed 名。版本线跟随官方家族（家族 rc.6 时跟 rc.6.x；家族发 rc.7 时跟 rc.7)。

## Alternatives considered

- **经家族发布走 @deepseek-ai**——不可用：没有 npm org 成员资格，也没有仓库写权限；维护者账号不得尝试官方渠道。
- **monorepo 包改名为 khorsheed scope**——否决：违反"每个 npm 包都是 `@deepseek-ai/dsh-<name>`"的仓库约定，破坏 base bundle 行，而且带不来独立发布仓没有的东西。
- **两个名字都不写进文档**——否决：那正是产生错误安装命令的状态。

## Consequences

- 一名一家：用户安装 `@khorsheed/dsh-ankh-guard`;monorepo 经 base bundle 组合 `@deepseek-ai/dsh-ankh-guard`。两个 patch 插入的行 id 都是 `ankh-guard`，把 khorsheed 包装到已含家族成员的镜像上会因重复 entry id 炸 boot——README 里有这个警告。
- 发布 = 从 monorepo 包同步到独立仓，然后在那里 `npm publish`（账号有 2FA)。
