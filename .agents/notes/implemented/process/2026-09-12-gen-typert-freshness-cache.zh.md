# Agent Note: gen-typert 保鲜缓存——每次构建只生成一次，不再每包一次

Status: implemented

## Problem

每个包的 build 脚本都跑 `tsx ../../scripts/gen-typert.mts`，而一次全量（full-mode）运行约 45–50 秒就能生成全部十个已注册 typert 包的产物。全仓构建于是把这笔批处理成本付了十遍（约 450 秒工作量），实测约占冷态全仓构建（16GB/8 核机器、workspace-concurrency 2 下墙钟 5m47s）的三分之二。CI 每次运行都在付这笔钱；每个 agent 的本地全量构建即使生成器读取的输入毫无变化也在付。

## Decision

全量运行在搭 overlay 之前先查 `$DSH_HOME/scratch/typert-cache.json` 里的保鲜戳：

- 缓存键覆盖一个批次读取的全部输入：本脚本自身内容、每个入选包的 `package.json` + 宿主 tsconfig + `src/` 树（正是 `copyTypertPackageSources` 复制进 overlay 的东西），以及 harness 检出的 git 状态（`HEAD` + `status --porcelain`——harness 有未提交改动即未命中）。任何输入变化都会未命中并重新生成。
- 戳里还记录它产出的每个输出文件的 sha256；输出被删或被改写（冷 `lib/`、手改产物）即未命中。
- `GEN_TYPERT_FORCE=1` 强制重新生成。带 `GEN_TYPERT_ONLY` 的限定运行（部署路径）不读也不写这个戳：部署必须对着活源生成，且限定运行的输出（兄弟包从已构建 `lib/types` 解析）与全量输出不同，不能污染它。
- 并发调用（workspace-concurrency 2）用 `typert-gen.lock` 目录锁串行；没抢到锁的一方重读戳，通常发现已新鲜。生成器崩溃留下的陈锁等 15 分钟后破除——最坏情况不过是重复生成一遍内容相同的输出。

效果（16GB 机器实测）：冷态全仓构建（无戳、全部 `lib/` 已删）5m47s → 1m08s（一次生成批 + 九次命中）；热构建 12 秒；单次缓存命中约 0.8 秒应答。正确性不变量：命中要求输入逐字节一致且盘上输出逐字节一致，因此命中只可能发生在重新生成也会产出相同文件的情况下。

## Alternatives considered

- **每个包的构建都限定 `GEN_TYPERT_ONLY=<自己>`**——结构上消除了 10× 冗余，但每次限定运行仍要搭 overlay 并分析（几十秒 × 10 包），而且限定生成从已构建 `lib/types` 解析兄弟包，冷构建会因此新增"被引用的兄弟 lib 必须先存在"的排序约束——清单图并没有完整表达这类（纯类型）引用。缓存保留了全量模式的健壮性，并把"重复"变成免费，而不只是变小。
- **只按 repo HEAD 做缓存键**——太粗：脏工作树（多 agent 仓库的常态）必须重新生成，而文件级输入哈希成本不到一秒，精确的键很便宜。
- **让部署路径也吃缓存**——部署的意义就是证明当前源码能绿着构建；跳过生成会削弱看门狗绑定到 git HEAD 的凭证。限定运行保持不走缓存。

## Consequences

- 冷态全仓构建提速约 5 倍；剩下的长杆是 32 个包的 `tsc -b` + tsdown。CI 不依赖任何 runner 状态也能拿到同样收益：第一个 typert 包的批次让同一次运行里的另外九次调用全部命中戳。
- 戳放在仓外（`$DSH_HOME/scratch`），`git clean`、worktree、打包 tarball 的行为都不变；戳陈旧只会导致重新生成，绝不会产生错误输出（每次检查都对输出做哈希校验）。
- 代价：无行为变化；调试生成器本身时可用 `GEN_TYPERT_FORCE=1` 恢复"总是生成"的旧语义。

## Testing

- `scripts/gen-typert.spec.ts` 新增缓存套件：src 改动使输入哈希变化、无改动时稳定；戳在键与输出完好时通过，在键漂移、输出被改写、输出被删、戳缺失时拒绝；非 git 的 harness 检出按"不可缓存"处理而不是崩溃。
- 实测：第一次全量运行写戳（约 49 秒），第二次 0.8 秒应答；删戳后删全部 lib 的冷构建 1m08s 全绿，期间恰好一次生成批、九次锁后命中；`pnpm run test:scripts` 通过。
