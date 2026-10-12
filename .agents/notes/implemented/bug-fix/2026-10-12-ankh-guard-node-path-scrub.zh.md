# Agent Note: 3080 preset 名册整天冻结——看门狗把 NODE_PATH 遗传给实例，解析被劫持到主检出

Status: implemented

## Problem

2026-10-12 全天，3080 的 preset 名册与插件清单冻结在旧内容（游戏开发模式在、剪辑模式不在），多次部署与重启均无效。磁盘上的组合（profile patch、已装包内容、dump-config、逐字节克隆起的对照实例）全部正确且为最新——线上进程与用户浏览器的原始 RPC 却只有 9 个 preset，组合树里独缺 `preset-dsh-video` 一行。

## Root cause

看门狗（dsh-watchdog.sh）是被一个 tsx 包裹的 shell 拉起的；tsx 会把 `NODE_PATH` 钉到调用方检出的 pnpm 仓（`<repo>/node_modules/.pnpm/.../node_modules`）。看门狗的 `launch_instance` 只 scrub `WD_*`，于是 `NODE_PATH` 遗传给每一代实例。Node 的 `require.resolve` 会查 NODE_PATH：bundle 解析（`resolveBundleDir` 经 `createRequire(anchor).resolve.paths`）在查完安装锚点之后、回退到 profile 之前，先在 NODE_PATH 命中了**主检出的 workspace 副本** `@khorsheed/dsh-presets`（main 分支内容：4 行、含 gamedev、无 video）。装在 profile 里的 0.3.1 从未被读到，组合树与名册便停在主检出的内容上，与部署、重启全部无关。

实锤方式：同一个 home、同一个二进制，带与不带这串 NODE_PATH 各起一次——带则名册 9（与线上一致），不带则 10（剪辑模式在）。一正一反复现后结案。

## Decision

三处启动路径在清 `WD_*` 之外同步清 `NODE_PATH` / `NODE_OPTIONS`（同一泄漏类的全部已知向量）：看门狗 `launch_instance`、ankh-guard CLI 的 bare-restart spawn、supervisor spawn（看门狗自身也别带着，免得经 `guard_cmd` 的 node 子进程再传下去）。测试在既有「WD_* 不泄漏到实例」用例上扩展同模式断言（探针值注入 + 实例 env dump 比对）。ankh-guard 升 0.4.3（npm 已发 0.4.2）。

## Alternatives considered

- **只重启不清环境**：当天已证明无效——只要看门狗还带着 NODE_PATH，它 respawn 的每一代实例都复发。
- **在 harness 的 resolveBundleDir 里禁用 NODE_PATH 回退**：更治本，但 harness 是只跟踪不修改的上游；已记录为 upstream 提案方向（解析锚点应是显式的，不该被环境变量静默加锚）。
- **launch 命令里显式 `NODE_PATH=` 置空**：治标不治本——每个新 shell 包装器（tsx、 bun、未来的工具）都可能注入新变量，scrub 是面向类的防御。

## Consequences

- 从任何 shell 拉起的看门狗/重启，实例环境都不再携带调用方的 Node 解析变量；bundle 解析回到「安装锚点 → profile」两个显式锚点。
- 已部署的 3080 实例在干净环境下重立监督后名册恢复（10 个 preset 全在）；presets 0.3.1（剪辑模式 + 恢复的游戏开发模式）随之真正生效。
- 当天另一处修复（分支追平 main 恢复 gamedev 行，见 `2026-10-12-presets-branch-sync-gamedev`）仍然是必要且正确的：它修的是 tarball 内容缺失，本 note 修的是解析劫持；两个故障叠加才让症状如此反常。

## Testing

带/不带 NODE_PATH 的受控启动对照（名册 9 vs 10）复现根因；干净环境重立监督后，线上 RPC `agentPresets/list` 返回 10 个 preset、插件清单显示 dsh-presets v0.3.1 五个组件。self-restart-guard.spec.ts 扩展用例随包测试通过；ankh-guard 全量测试见提交记录。
