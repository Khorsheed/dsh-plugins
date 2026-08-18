# Agent Note: ankh-guard 发布身份——khorsheed 是发布渠道

Status: implemented

[English](2026-08-16-ankh-guard-publish-identity.md) | 中文

## Problem

ankh-guard 曾有两个名字：monorepo 里的 `@deepseek-ai/dsh-ankh-guard`（发布家族成员，由 base bundle 挂载）和 npm 上的 `@khorsheed/dsh-ankh-guard`。文档在两者之间摇摆——安装章节一度写了从未发布过的 scope,2026-08-16 的一次 README"修正"还把用户指到了错误的名字。官方渠道对维护者不可用：npm 的 `@deepseek-ai` org 和 GitHub 的 `deepseek-ai/deepseek-harness` 对工作账号都是只读，家族发布既无法从这里触发，也不应尝试。

## Decision

发布身份是 **`@khorsheed/dsh-ankh-guard`**，而且现在它是唯一的包名：包位于 `dsh-plugins` monorepo 的 `packages/ankh-guard`（单一事实来源，经 `scripts/pack-dist.ts` 发布），deepseek-harness 的树内家族成员已于 2026-08-16 移除（harness 提交 `48a9e1735d`,“chore: remove migrated plugin packages now hosted in dsh-plugins”）。安装文档一律写 khorsheed 名。版本线跟随官方家族（家族 rc.6 时跟 rc.6.x；家族发 rc.7 时跟 rc.7）。

## Alternatives considered

- **经家族发布走 @deepseek-ai**——不可用：没有 npm org 成员资格，也没有仓库写权限；维护者账号不得尝试官方渠道。
- **monorepo 包改名为 khorsheed scope**——否决：违反"每个 npm 包都是 `@deepseek-ai/dsh-<name>`"的仓库约定，破坏 base bundle 行，而且带不来独立发布仓没有的东西。
- **两个名字都不写进文档**——否决：那正是产生错误安装命令的状态。

## Consequences

- 一名通用：用户安装 `@khorsheed/dsh-ankh-guard`，且当前任何官方镜像都不挂载冲突行——已发布的 npm `@deepseek-ai/dsh-base` 线从未携带该行（抽查过 rc.6/rc.7 tarball）,upstream master 也从未有过；base bundle 行只存在于本地部署 fork，并已在迁移清理中移除。重复 id 风险只剩一种：组合仍通过其他方式挂着 `ankh-guard` 行；两份 README 和 `cordis.patch.yml` 都带了这条警告和 `--dump-config` 检查方法。
- 发布 = 在本 monorepo 经 `scripts/pack-dist.ts` 打包，然后 `npm publish`（账号有 2FA)。
