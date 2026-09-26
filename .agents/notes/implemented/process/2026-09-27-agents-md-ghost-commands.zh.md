# Agent Note:AGENTS.md 幽灵命令——`build:lib:host` 与 `dsh preflight` 点了两个在这里不存在的东西

Status: implemented

[English](2026-09-27-agents-md-ghost-commands.md) | 中文

## 问题

owner 报告:AGENTS.md 的 build contract 让 agent 在干净 worktree 里以 `pnpm install && pnpm run build:lib:host` 开局,而本仓并不定义这个脚本——这个名字只在上游存在(`deepseek-harness/package.json`:`build:lib:host = tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`),抄过来后从未适配。这行位于 build contract 顶部,干净 worktree 里的 agent 在被告知要跑的第一个命令上就会绊倒。

当天对 AGENTS.md 引用的每条命令/路径做了一次全量审计(正是 owner 随后点名要的扫查),又发现一个幽灵和两处陈旧:

- **Ops**:「Restarts are gated by `dsh preflight --profile web`」——`dsh` CLI 没有 `preflight` 子命令(`apps/cli/src` 零命中,`--help` 里没有)。真正的闸是 ankh-guard CLI 的 `preflight` 动词(`bin: dsh-ankh-guard → lib/cli.js`),`deploy:3080` 在闸⑤会自动跑它。
- **Build contract**:「the other nine invocations」——typert 包的数量早已漂到 15 个。
- **Repo hygiene**:截图规则只覆盖了文档页(`docs/screenshots/`),没覆盖包 README 的图——后者由 dsh-web-basic 镜像仓的 raw URL 承载,不跟踪进 `profiles/web-basic/docs/screenshots/` 就会被镜像 sync 抹掉(见[README 截图托管](2026-09-27-readme-screenshot-hosting.zh.md))。

其余引用——全部 `check:*`/`test:*`/`deploy:3080`/`hooks:install` 脚本、`scripts/gen-typert.mts`(含 `GEN_TYPERT_FORCE`/`GEN_TYPERT_ONLY` 与 `$DSH_HOME/scratch/typert-cache.json` 路径)、`build/tsdown.client.ts` 的 `clientBundle`、`build/vitest.ts`、`.githooks/pre-commit`、`docs/{development,ops,publishing,plugin-visibility,upstream-seam-registry}.md`、ops.md 的「构建卫生」节——逐一核实存在且准确。

## 决定

当天落地四处 AGENTS.md 就地修改(owner 指定本会话即文档维护人并要求直接修):

1. 干净 worktree 首命令改为 `pnpm install && pnpm run build`——递归工作区构建按依赖序执行,每个包的 `gen-typert → tsc → tsdown` 先落 host 产物再轮到依赖它的 client tsc,这句话要给的顺序保证不变。
2. 重启闸改写为:ankh-guard 的组合 preflight 由 `deploy:3080` 在闸⑤自动执行;手工形态是 ankh-guard CLI 的 `preflight` 动词,并明确警示「不存在 `dsh preflight` 子命令」。
3.「the other nine invocations」改为「every later invocation」,句子不再随 typert 包增加而腐烂。
4. 截图规则补上 README 分支:包 README 的图跟踪进 `profiles/web-basic/docs/screenshots/`(`git add -f`),因为镜像 sync 会抹掉此外的一切。

## 备选

**经 proposed note 移交给文档维护人。** 先试过(note 按 owner 的移交要求起于 `proposed/`);随后 owner 指定本会话即文档维护人并下令落地,note 随本次改动迁入此处。

**把干净 worktree 首命令指向 `tsx scripts/gen-typert.mts`。** 不作默认值:它更轻,但完全不能证明各包 tsc/tsdown 链——干净 worktree 从未跑过它们;完整的 `pnpm run build` 才是诚实的第一证明,也正是 pre-commit 门禁本就要求的脚本。

## 影响

AGENTS.md 点名的每条命令现在都在本仓真实存在;两个幽灵命令不会再浪费干净 worktree 的第一步,也不会再让人去翻一个不存在的 `dsh` 动词。上文审计清单同时就是下一次文档扫查的核对表。

## 验证

纯文档改动。验证为机械核对:枚举根 `package.json` 脚本;对宿主 CLI 的 `apps/cli/src` 与 `--help` 输出 grep `preflight`;逐个 `test -e` 所有被引路径;`grep -l '"./typert"' packages/*/package.json` 数 typert 包。迁移后的 note 通过 `verify-agent-note-format`/`verify-agent-note-classification` 与配对校验。

## 相关

- [README 截图托管在 profiles/web-basic](2026-09-27-readme-screenshot-hosting.zh.md)——第 4 处修改背后的镜像 sync 机制。
- [ankh-guard 自部署 reconfigure](2026-09-26-ankh-guard-self-deploy-reconfigure.zh.md)——真实 preflight 调用所在的 runbook。
