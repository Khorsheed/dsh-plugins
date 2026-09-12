# Agent Note: 检查器 spec 声明自己的真实耗时，不再在 5s 上抖动

Status: implemented

## Problem

两个仓库根级检查器 spec 是门禁最常见的红色，而且都是误报：`scripts/deploy-3080.spec.ts`（3080 部署流程集成套件）和 `scripts/check-build-scripts-declared.spec.ts`（install 脚本声明扫描）在机器有负载时撞 vitest 默认 5 秒超时，单独跑又通过。这种失败教会 agent"script tests 阶段红是正常的"，而真正的回归恰恰会这样被放过去。

两者都有具体缺陷而非天生慢。deploy spec 的 fixture 用 `spawnSync` 跑真实编排器，内部进程超时是 15 秒——一个设计上合法耗时可達 15s 的测试永远塞不进 5s 默认值。build-scripts 检查器 glob `node_modules/.pnpm/*/node_modules/**/package.json`：`**` 遍历会下钻每个已安装包自己的嵌套 `node_modules` 树，读几千个 manifest 再用两段式过滤器丢弃；spec 还把这场遍历跑了两遍。

## Decision

- `vitest.scripts.config.ts` 为仓库根级 script specs 设 `testTimeout: 30_000`——它们是集成测试（子进程编排器、实树扫描），30s 给 deploy fixture 内部的 15s spawn 超时留足余量。本来就快的 spec 不受影响：超时是上限不是下限。
- `check-build-scripts-declared.ts` 改用两个按段精确的 glob（每个 `.pnpm/<key>/node_modules/` 下的 `*/package.json` 与 `@*/*/package.json`），消除嵌套树下钻。旧的两段式过滤器还会漏进并非已安装包的子路径 manifest（`zod/v4-mini/package.json` 等 35 个）；精确模式把它们排除。前后对照：真实包零丢失，检出集合不变。
- spec 的两个用例共享一次扫描，不再重复遍历 store。

## Alternatives considered

- **逐 spec 设超时**——知识放对了文件但散在 N 个 spec 里，下一个集成 spec 还会忘；目录级上限与"这个目录里的 spec 都是集成测试"的事实一致。
- **改大内部 spawn 超时**——15s 已经很宽；错配在 vitest 先杀测试。
- **删掉或降级抖动测试**——两者分别是部署流程与 allowBuilds 契约唯一的回归网（2026-09-01 的 koffi CI 断裂就冻在其中一条里）；抖动才是 bug，测试不是。

## Consequences

- `pnpm run test:scripts` 在同一台此前必红的机器上连续多次全绿；build-scripts 用例从 >5s 降到毫秒级。
- 门禁的 script-tests 阶段不再在负载下误拦无关合并，消除了"绕着红门禁合并"的压力。
- 放弃的东西：无行为变化——检查器在同一检出集合上执行同一契约，没有 spec 获得新的跳过路径。
- 门禁内存压力（整仓 scope 时 pnpm `-r` 并发 × 各包 vitest worker）是另一个独立问题，归门禁调优，不归这两个 spec。

## Testing

worktree 内 `pnpm run test:scripts` 连续三次全绿；用 node 对照脚本 diff 了新旧 glob 覆盖（427 对 462 个 manifest，35 个差异全是子路径 manifest，真实包零丢失）。
