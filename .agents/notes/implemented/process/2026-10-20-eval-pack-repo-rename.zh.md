# Agent Note: 评测 pack 的仓层改名（dsh-web-eval → dsh-eval）

Status: implemented

## Problem

评测 pack 的镜像仓原是 `Khorsheed/dsh-web-eval`，用户拍板公开名收短为 `Khorsheed/dsh-eval`（GitHub 侧改名由用户操作，旧 URL 带跳转）。`scripts/sync-mirror.mts` 由 monorepo 目录名推导镜像仓名，所以这次改名有仓内一半：`profiles/web-eval` → `profiles/eval`，外加全部活引用。风险在于改过头：pack 的**运行时**身份——已装实例的 `$DSH_HOME/profiles/web-eval`、`dsh --profile web-eval`、profile 清单的 `name`、npm 包名（`@khorsheed/dsh-eval-suite`、`@khorsheed/dsh-web-eval-preset`）——对每个已装实例都是承重的，明确不在范围内。

## Decision

只改仓/目录层；运行时层一个字节不动。

- **改了**：`profiles/web-eval` → `profiles/eval`（普通 `mv`）；下次 `sync:profile eval` 推出镜像仓 `dsh-eval`。pack 的显示名跟随仓名：README H1（`# dsh-eval`）、脚本头注释与 `dsh-eval:` 日志前缀（basic/dev 的惯例是两者都等于仓名）、clone 指引，以及 `scripts/web-eval-preset-bundle.spec.ts` → `scripts/eval-preset-bundle.spec.ts`。活文件里所有 `profiles/web-eval/…` 仓内路径——spec、checker、README 链接、`docs/`、包注释——一律改为 `profiles/eval/…`；`docs/packages.md` 由 `pnpm map:packages` 重生成。
- **没改**：运行时 profile（`dsh-profile-web-eval`、`--profile web-eval`、`$DSH_HOME/profiles/web-eval`、`restart-into-web-eval.sh`、install/update 的 `DEST`）、全部 npm 包名、CHANGELOG 历史、带日期的文档（iterations.md、各 t-任务记录、handoff 叙事），以及指运行时实例的裸 `web-eval`（「web-eval 实例」「web-eval 冻结决策 N」）。Agent Notes 保留原文，只把指向本仓的链接目标改到 `profiles/eval/…`，sidecar 已重录。
- preset bundle 的 sha256 pin（`scripts/eval-preset-bundle.spec.ts`）因一次纯注释编辑而移动：被哈希的 `plugins:` 块里有一条出处注释写着旧路径。摘要更新与原因记在该 spec 的注释史里；组成未变。

## Alternatives considered

- **运行时层一起改**（`$DSH_HOME` 下的 `profiles/eval`、`--profile eval`）。用户否决：这会把每个已装实例的 home 变成孤儿，换不来任何功能收益；运行时名是用户侧状态，不是仓结构。
- **npm 包名跟着改。** 用户否决：包名是已发布的身份；短名已被编排器 `@khorsheed/dsh-eval` 持有，而 `@khorsheed/dsh-web-eval-preset` 是 profile 内的私有 bundle，从不发布。
- **把所有裸 `web-eval` 行文一并清扫。** 否决：剩余命中大多指运行时 profile/实例，那个名字仍然存在；改写带日期的记录等于篡改历史。

## Consequences

- `git grep` `dsh-web-eval` 现在只命中 npm preset 包名、CHANGELOG 历史、带日期的笔记/文档与 scratch 日志；`profiles/web-eval` 只命中运行时（`$DSH_HOME`）路径与历史。
- 改名前开出的 worktree 仍带着 `profiles/web-eval/`（2026-10-20 时有 16 个在途）：它们合入时要对改名后的树做路径感知的 rebase——内容合并不难，但在旧路径下新增文件的分支会撞上纯改名冲突。
- 两份带日期的笔记在行文里引用旧 spec 文件名 `scripts/web-eval-preset-bundle.spec.ts`，按原样保留——该 spec 现位于 `scripts/eval-preset-bundle.spec.ts`。
