# Agent Note: datasets → lab → mission 三包联调集成测试

Status: implemented

[English](2026-08-20-triad-integration-test.md) | 中文

## Problem

datasets、mission、lab 三包各自交付（M1）且各有单测，但从未联在一起跑过：datasets 的 `worktree_path` 产物交给 lab 的 `populate` 消费、lab 的 `MissionFace` 调用落进真实 mission store、mission 的 `file-check` guard 闸住 lab 的 `release`——这些链路从未端到端运行。跨包合约（[datasets](../../../proposals/active/2026-08-19-datasets-store.md)、[mission](../../../proposals/active/2026-08-19-mission-tasks.md)、[lab](../../../proposals/active/2026-08-19-lab-experiment-units.md) 三份提案）此前只在包内对着假件验证过。

## Decision

scripts 级集成对：`scripts/integration-triad.mts`（驱动——搭 fixture、跑整条链路、按步收集证据）与 `scripts/integration-triad.spec.ts`（对证据的十条断言）。它跑在仓库根的 `pnpm test:scripts` 下——根上没有源码平面别名预设，所以驱动按**相对路径**引用三包的服务内核（`../packages/*/src/…`，其传递值导入全部是 `node:` 或相对路径），不新增 package.json 依赖边。

链路（评测回路前半段，无模型）：临时 git fixture（层 visible/verify/grading，grading 标 `modelFacing:false`）→ `snapshot` → `worktree_path(layers:['visible'])`；bench 风 JSON run 模板 `pending → ws-ready → working → collected → archived → releasable → released`，进 `releasable` 带 `file-check` guard（`archive/output.txt`），`releasableStates: ['releasable']`；lab `acquire`（docker provider，经 node `child_process` 的 Exec 适配）→ 断言 `refs.resource` 与镜像 digest `fingerprint` 已落进 mission → `populate` 把 worktree 拷入 → `verify` 探测容器内只能看到 visible 层（sparse-checkout 沿链路生效）并产出 `out/output.txt` → `collect` 登记 artifact；随后门禁：过早的 `archived → releasable` 与过早的 `release` **都被拒**（且容器存活），驱动把归档文件写进该 attempt 的运行数据目录（模拟编排方导出），guard 通过，`release` 销毁容器，history/annotation 断言完整且 append-only。

docker 是软依赖：`probeDocker()` 探测 daemon、以有界超时拉 `alpine:latest`、失败回退本地任一镜像；两者皆无则整个套件跳过并打印原因（CI 兼容）。清理（`docker rm -f` 兜底 + 临时树删除）在 `afterAll` 保证执行。

## Alternatives considered

- **把三个插件挂到真实 cordis `Context` 上（commands/tools/subprocess 用 stub）**（各包自己的 `apply` 测试的形态）——否决：根级 `vitest run scripts` 没有 harness 源码平面别名，`@deepseek-ai/cordis` 无法从 `scripts/` 解析，除非新增根依赖；且 cordis 外壳对本测试要钉的东西没有增量——被测的跨包合约是服务面（`createDatasetsService` / `MissionService` / `LabService`），各包自己的测试已表明它们就是 cordis 提供的实例。每包的 `apply` 接线仍由每包自己的 spec 覆盖。
- **在驱动里内联断言**——否决：断言面会对 test runner 隐身，失败读起来像驱动崩溃；驱动/证据分离让每一步的期望是一个具名 `it`。
- **省掉容器内可见性探测、只在宿主侧断言 worktree 树**——否决：提案的保证是 sparse-checkout 机制沿整条链路生效到容器内；只做宿主侧断言会让 populate 这一腿失去验证。

## Consequences

- 三份提案的跨包合约点现在由一次绿色运行钉死：worktree 路径即接口、`MissionFace` 与真实 `MissionService` 的结构兼容、fingerprint 入 refs、file-check 闸住 release、annotation/history 审计形态。首跑结果：十条断言全绿，未发现包级 bug。
- 本测试立项时假设 lab M2 的 `checkpoint`/`verify`/`archive` 尚未实现，而 lab 提案的实现记录实际已列其交付；链路因此用 `verify` 做容器内探测与产出（顺带产出审计步骤断言的 `lab` ns annotation），而归档文件仍由驱动直写，保持 `file-check` 这一腿独立于 lab M2。
- 无网络时 alpine 拉取每次运行要烧掉一次有界超时才回退本地镜像；daemon 已缓存 `alpine:latest` 时无此开销。
- 本测试对三包的 cordis 挂载不持立场；将来若 bug 出在 `apply` 接线上，归各包自己的 spec 管。
- 评测回路**后半段**（submission、schema guard、export）的真 docker 冒烟仍开放，活 profile 冒烟同。

## Testing

`scripts/integration-triad.spec.ts`（10 测试）：snapshot 钉 commit 与 worktree 只含 visible 层；模板建 run 且 lint 无 error；refs（resource + `sha256:` fingerprint）经服务面写入；容器内可见性（`ls -R` 证据；grading/verify 缺席）；collect 回环与 artifact 登记；两个过早门禁的拒绝与容器存活；guard 通过 → release → 容器消失 → 终态 `released`；六条 history 按序、带 actor/时间、被拒的尝试不留幻影条目；两条 append-only 的 `lab` ns verify annotation。已在 docker daemon 28.1.1 上以本地兜底镜像 `postgres:16-alpine` 验证全绿（验证时无网络拉 alpine）。

**第二轮（失败路径，5 测试，`runTriadFailures` 驱动，lab ↔ mission 两腿）**：populate 打不存在的源目录——失败报错响亮，单元仍被跟踪（status 可见、容器存活，不静默泄漏），mission 停在 `working` 且 history 无幻影条目；该状态下 release 被 gate 拒绝。绑定到**未知 mission** 的单元——acquire 登记失败 warn，release 在查询异常上 fail closed，且 `force` 不构成绕过。attested 拆除路径——`attest teardown-approved` → 转 `failed`（可释放态）→ release 销毁容器。第二轮同样全绿（docker daemon 28.1.1）。

**第三轮（2026-08-24，lab 的评估刚需四条落地）**：失败模板改为状态链 `working → archived-failed`（attested）`→ failed`（file-check 查 `archive/crash-dump.txt`），套件由此钉死失败路径的「无崩溃转储不得 releasable」——与成功路径同款 gate 形状，用状态链表达而非新增 guard 组合机制。主链 populate 带上物化清单腿（断言返回哈希、登记 kind `materialization` 产物；计数含 worktree 的 `.git` 指针文件）。16 断言全绿。

## Related

- [datasets M1 Agent Note](../feature/2026-08-19-datasets-store-m1.md)、[mission M1 Agent Note](../feature/2026-08-19-mission-m1.md)、[lab M1 Agent Note](../feature/2026-08-20-lab-m1.md)、[lab M2 动词 Agent Note](../feature/2026-08-20-lab-m2-verbs.md)——本链路集成的各包交付。
