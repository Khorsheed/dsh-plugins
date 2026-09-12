# Agent Note: 伴生工具包与 core↔companion 依赖环——冷构建竞争的根因与修复

Status: implemented

## Problem

冷态全仓构建确定性失败：伴生工具包（`mission-tool` / `datasets-tool` / `eval-tool` / `worktrees-tool` / `room-tool`）在其 core 的 `lib/` 产出之前就起跑 `tsc`，解析不到 `@khorsheed/dsh-<core>`，构建即死。热 checkout 因 core 的 `lib/` 已在盘上而掩盖了问题；CI 每次运行都是冷装冷建，伴生行合入的那一刻就会转红。

最初的假设——"pnpm `-r run` 的拓扑排序只认 prod `dependencies`，dev/peer 边对排序器不可见"——是错的。pnpm 的项目图（`createProjectsGraph`）建边时同时读取 `peerDependencies`、`devDependencies`、`optionalDependencies` 和 `dependencies`。真正的成因：每个 core 还反向声明了自己的伴生（一个 optional peer + devDep，当初是为了让 pack-dist 的 family-edge 闸接受 core 客户端包里的伴生模块名字符串）。双向声明使 core⇄companion 构成依赖环，而 pnpm 的 `graphSequencer` 会把环上的成员编进同一个 chunk 并发执行——伴生的 `tsc` 于是与 core 的 `gen-typert + tsc + tsdown` 赛跑。实验证实：删掉某一对的反向边后，core → companion 的严格构建顺序即刻恢复；typecheck 探针还显示过滤展开（`--filter pkg...`）能看到边而排序器并不按它排序——这正是环的特征，而不是缺边。

## Decision

跨包清单边只走一个方向：companion → core（伴生在构建期确实 import core 的 `./tool` 工厂与类型）。

- 五个 core（`mission`、`datasets`、`eval`、`worktrees`、`room`）删除其对伴生的反向清单边（`peerDependencies` + `peerDependenciesMeta` + `devDependencies`）。`room` 保留无关的 `dsh-local-agent` 可选对。
- 包仅以数据形式提及的兄弟名——客户端包里命名伴生行的 preset 可见性 / 徽标门禁常量——声明在清单的 `dsh.references` 数组里。pack-dist 的 `verifyTarball` 在做 family-edge 检查时把 `dsh.references` 并入已声明集合，闸对未声明的 family 引用照摔不误。`mission`、`datasets`、`worktrees`、`room` 带该条目；`eval` 不需要——它的伴生名只活在注释里，而闸在扫描前会剥掉注释。
- `scripts/check-plugin-independence.ts` 从 `ALLOWED_EDGES` 删除反向条目，并在注释里记录为什么数据提及永远不能变成依赖边。`AGENTS.md` 的"默认无跨插件依赖"条目写入了单向规则。

## Alternatives considered

- **伴生用 `dependencies` 声明 core（local-agent 范式）**——修不了：反向 peer/dev 边照样把环闭上，图里本来就双向都有边（peer 和 dev 边都算数）。缺陷在环，不在边的种类。
- **伴生的 build 脚本先建 core（`pnpm --filter <core> build && tsc ...`）**——只有同时删掉反向边才能保证顺序（否则两个包仍落在同一 chunk，嵌套的 core 构建会与 chunk 自己的 core 构建在同一个 `tsbuildinfo` 上竞争）；而且每次全仓构建都重复建一遍 core，是把拓扑问题藏起来而不是修好。环断掉之后，pnpm 自己就能把这对排对。
- **tsc project references**——core 的构建是 `gen-typert && tsc -b && tsdown`；project references 拉得起 `tsc`，拉不起 typert 生成和打包步骤，伴生仍然需要 core 的完整构建先跑完。
- **root build 分两阶段（先 core 后伴生）**——只修好 root `build` 一个入口；gate 的过滤构建和 CI 只要过滤器覆盖到一对就仍然竞争，未来每一对新对子都得重复这套编排。

## Consequences

- 冷构建恢复确定性：无论 root 脚本、`pnpm gate` 的过滤构建还是 CI，pnpm 自己的排序都会把每个 core 排在其伴生之前。
- pack-dist 的 family-edge 闸锋利依旧：发货产物里未声明的 `@khorsheed/*` 引用照样让 pack 失败；数据提及改为在 `dsh.references` 里显式声明，不再偷渡成依赖边。
- deploy:3080 按包的 `@khorsheed/*` deps+peers 推导 pack-dist 的 `--family`，所以给 core 打包时 `--family` 不再带伴生名——这是一次恒等改写，因为源名与发行名同处 `@khorsheed` scope（pairs 把名字改写成它自己）。部署伴生从来都是显式 `--package packages/<伴生>`；注册与 profile 行为均无变化。
- 代价：反向 peer 假装携带的（从来不真实的）loader 层信号没有了。profile 本来就以直接依赖安装 core 与伴生；那个 optional peer 从未被任何安装真正需要。
- 早前"pnpm 排序不认 dev/peer 边"的论断（记在[内存上限 Agent Note](../../implemented/process/2026-09-12-test-memory-concurrency-caps.md)）已在那里更正，并由本笔记取代。

## Testing

- 在 `mission` 对上复现冷失败（删两边 `lib/`，`pnpm -r --filter` 同选两者跑 build）——伴生并发起跑并失败；删反向边后，core 完整建完伴生才起跑。
- 全仓冷 lib 构建（删掉所有 `packages/*/lib` 后跑 root `pnpm run build`）通过。
- 按 deploy 的 `--family` 推导对五个 core 逐一 pack-dist——全部通过 `verifyTarball`（四个 `dsh.references` 条目被认可，eval 无需条目）。
- `pnpm run test:scripts` 通过，含新增 pack-dist spec 用例：经 `dsh.references` 声明的 family 名能通过 family-edge 检查。
