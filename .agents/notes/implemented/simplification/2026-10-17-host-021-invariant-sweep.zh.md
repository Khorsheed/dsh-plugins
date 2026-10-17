# Agent Note:host-021 清扫——invariant 伴随件全仓退役，engines.dsh 全仓声明

Status: implemented

## 问题

宿主 0.2.1-rc.1(npm `next`,2026-10-17)整包删除 `@deepseek-ai/dsh-invariants` 及所有 `./invariant` 子路径(`f028f256`)。我们的身份约定曾让每个自挂载包带一个 `src/invariant.ts` 伴随件（`PACKAGE_NAME` 常量 + 可选 boot 探针），配套 `./invariant` 导出、peer 依赖、devDep、tsdown entry，以及 12 个包的 `tsconfig.host.json` `files` 钉项。对着 0.2.1 类型面这些全部编译失败。同期 0.2.1-alpha.3 让 `engines.dsh` 在声明时独占兼容裁决（peer 规则忽略），而我们通行的 peer range(`^0.1.0-rc.6`)在 0.2.x 下系统性误判。

## 决策

- **纯拆除，不建替代**:35 个包中的 34 个（message-tools 因在飞分支留给 wave 批次 3）删除 `src/invariant.ts`、`./invariant` 导出、peer/meta 条目、tsdown entry、tsconfig 钉项。AGENTS.md 的身份三角退化为两腿;`check-plugin-independence.ts` 的 PACKAGE_NAME 检查保留（existsSync 门控，对残留件仍有效）。
- **拆掉的 boot 探针是记录在案的接受损失**（逐包写进 commit body):worktrees 的 git-on-PATH fail-loud、datasets 的物化根完整性（检查本体留在 `src/materialize.ts` 且有独立单测）、ankh-guard 的状态文件解析检查、local-agent 家族的 harness 契约审计、capture/dsh-reader/context-lens 的运行时 sanity、mission 的 run 文件解析检查、canvas(-novel) 词汇往返自检、quote/sidechat 词汇自检、video-studio 的 spawn 探针。11 个包本来就是 `() => {}` 空仪式件。官方整个删除了 invariants 体系且无替代钩子；在每包里重建等于重开一条 seam。失败模式退回各包自身降级路径(AGENTS.md「degrade, don't explode」)。
- **`engines.dsh` 口径**:每个清扫包声明 `"engines": { "dsh": ">=<dsh.compat.minHost> <0.3.0-0" }`。下限保持 minHost 地板不动（016 波原则）;`<0.3.0-0` 上限连下个小版本的预发布一起排除（已对宿主的 `includePrerelease` 语义实测验证）,让未验证的宿主线在安装期 fail-closed 而不是运行期炸。地板只在 npm `latest` 前滚后前移。
- **双轨波次策略**:双线安全的机械改造（本次清扫）经六个并行 worktree(`chore/host-021-sweep-1..6`）直接上 main;0.2.1-only 的改造（message-tools 聊天 slot 迁移、pin 升级、重验）进 `feat/host-021-adaptation` wave worktree，对着专用检出 `~/code/deepseek-harness-021` 门。共享 `~/code/deepseek-harness` 与 3080 停在 0.2.0-rc.2，等用户拍板合线（沿用 016 波 rc 纪律）。全案见 `proposals/active/2026-10-17-host-021-adaptation.md`(proposals 按设计不入 git，文件在共享检出内可见）。

## 放弃的备选

- **把有价值的探针折进各包 `apply()`**：否决——会把机械清扫变成逐包行为设计；探针是 boot 期断言而非功能，且官方自己放弃了这套概念。
- **`engines.dsh` 只写 `>=` 不加封顶**：否决——历史上每个 0.x 小版本都破过我们；无上限等于声称未验证的兼容。
- **单 agent 顺序清扫**：成本否决——34 包 ×(build+test）顺序跑要数小时；六个 worktree 并行在 CPU 争抢下约两小时完成。

## 后果

- 34 个包双线干净：对 0.2.0-rc.2（当前共享检出）可构建，同时带上 0.2.1 要的 manifest 声明。message-tools 是唯一残留的 invariant 携带者、也是唯一的聊天 slot 破坏点，两者都归 wave 批次 3。
- wave 分支现在可以把 `pnpm-workspace.yaml` pin 升 0.2.1-rc.1，摸底红单里不会再有 invariant 噪音。
- **给下一波并行清扫的流程教训**（均为 sweep agent 实录）:
  - gen-typert 鲜度缓存（`$DSH_HOME/scratch/typert-cache.json`）在并行 worktree 间乒乓——任一 worktree 的全量 regen 会让其它全部 miss;scoped `GEN_TYPERT_ONLY=<pkg>`(deploy 路径）完全绕开共享缓存与锁。
  - `tsconfig.host.json`/`tsconfig.client.json` 的 `files` 数组可能钉着 `src/invariant.ts`——删件不删钉就是 TS6053。
  - package.json 清扫规格必须列 `devDependencies`（只删 peer 会留下 34 条陈旧 devDep，已在根层收尾统一清）。
  - `git rm` 会把删除立即入暂存——逐包提交前必须重查 `git status`，否则下一个包的删除会卷进当前 commit（两起事故均已自愈）。
  - ankh-guard 集成 lane 与 datasets 的 git fixture 测试在清扫负载下（loadavg 28–40）会 flake，隔离重跑均绿；ankh-guard 的红与 016 波记录的 EADDRINUSE flake 一致（基线同样红、更糟）。
- `pnpm-lock.yaml` 里残留的 `@deepseek-ai/dsh-invariants@0.2.0-rc.2` 引用全是官方包自己的 peer 解析后缀（0.2.0 官方图谱），非我方引用；wave 升 pin 线时自然消失。
