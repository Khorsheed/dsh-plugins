# Agent Note:AGENTS.md 的干净 worktree 首命令指向一个只在上游存在的脚本

Status: proposed

[English](2026-09-27-agents-md-build-lib-host-ghost-script.md) | 中文

## 问题

AGENTS.md「Build contract」节告诉每个 agent:「在干净 worktree 里,第一个命令永远是 `pnpm install && pnpm run build:lib:host`」。本仓没有这个脚本——根 `package.json` 的脚本集是 `build`、`test`、`test:scripts`、`typecheck`、`check:*`、`deploy:3080` 等,`packages/*/package.json` 里也都没有。照做会直接报 pnpm 的 "Missing script" 错误;而这句话位于 build contract 的顶部,干净 worktree 里的 agent 会在被告知要跑的第一个命令上就绊倒。

这个名字只在**上游**存在:`deepseek-harness/package.json` 定义了 `build:lib:host = tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`(与 `build:lib:client` 配对)。这一行是从 harness 的构建文档抄来的,从没适配成本仓的脚本名。2026-09-27 已核实:枚举根脚本、`packages/*/package.json`、`scripts/`、`docs/` 全文 grep,唯一出现处就是 AGENTS.md:20 自己。

## 建议

AGENTS.md「Build contract」节改一行:把 `pnpm install && pnpm run build:lib:host` 换成 `pnpm install && pnpm run build`。根 `build` 是 `pnpm -r --workspace-concurrency=2 --if-present run build`,pnpm 按依赖序跑工作区包,每个包自己的 `gen-typert → tsc → tsdown` 链会先落 host 产物再轮到依赖它的 client tsc——这正是那句话要给的顺序保证。如果原意是比全量递归构建更轻的第一步,就点名写出来:`tsx scripts/gen-typert.mts`(可像 deploy:3080 那样用 `GEN_TYPERT_ONLY=<pkg>` 收窄),再 `pnpm run build`。

按用户要求(2026-09-27:「这条请转给维护文档的人修」)立项移交,上报会话未就地修改。

## 备选

**就地立刻修掉。** 按用户明确的移交要求不采纳——改动有意停在本文,由文档维护人落。

**把首命令改成 `tsx scripts/gen-typert.mts`。** 已在「建议」里作为更轻的变体覆盖;默认仍推荐完整的 `pnpm run build`,因为它同时验证每个包的 tsc/tsdown 链——干净 worktree 还从未跑过它们。

## 验收标准

AGENTS.md「Build contract」节只点名本仓根 `package.json` 里真实存在的命令;干净 worktree 里的 agent 按所述首命令执行不再报 missing-script。

## 风险

无——纯文档改动。唯一的残余风险是根脚本集日后改名导致这行再次腐烂;建议文本点名的 `build` 正是 pre-commit 门禁已经要求每个 agent 跑的那个脚本。

## 相关

- 这行抄自上游的脚本定义:`deepseek-harness/package.json` → `build:lib` / `build:lib:host` / `build:lib:client`。
