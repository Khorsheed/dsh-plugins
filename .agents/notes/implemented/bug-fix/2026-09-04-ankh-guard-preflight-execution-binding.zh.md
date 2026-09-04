# Agent Note: ankh-guard preflight execution binding

Status: implemented

[English](2026-09-04-ankh-guard-preflight-execution-binding.md) | 中文

## Problem

launch cutover 用一条命令启动 successor，却从 guard 进程和目标 checkout 选择 composition preflight 的模块图。于是实际由官方 npm built CLI 启动的候选，仅因 guard runner 使用 tsx 就可能被拿 checkout TypeScript 做 preflight；由此得到的导出错误既不描述将要启动的 candidate，也不描述它安装的依赖。反过来，独立 composition preflight 不解析最终启动 argv，放错位置的 launcher 参数会一直活到 previous 已停止之后。

恢复证据还复用一个顶层 canary 字段。target canary 失败、previous 在没有 previous-scoped 新鲜凭证时恢复后，终态回执会把 previous readiness 与 rejected target 留下的无主语 canary failure 并排展示。

## Decision

- 新启动配置显式记录 composition-preflight 契约：`source` 或 `built`、runner executable/runtime arguments/path/content SHA-256、作为模块解析锚点的真实 dsh 安装 manifest，以及完整 target-command SHA-256。source 只导入 checkout source；built 只从指定 npm 安装解析。runner 模式绝不从 `process.execArgv` 推断。
- `reconfigure` 除 composition preflight 外还强制要求一条 one-shot candidate probe command。probe 与 target command 摘要在同一 target spec 中提交。两个检查都在要求 previous supervisor 让权之前，对 target home 的隔离副本运行。耐久回执只记录脱敏 binding、摘要与 PASS 结果，不复制任一命令。
- candidate probe 仍由调用方提供。Guard 证明提交的 probe 与 target command 在绑定后没有漂移，但不证明任意 shell 文本在语义上由 target argv 派生。随包 Skill 使用相同 executable 与 launcher argv 的 one-shot `--dump-config` 形式构造官方 DSH probe。
- isolated-home copier 对每个物理节点只复制一次，再把 pnpm/Cordis 边重建为指向 snapshot 自有节点的相对链接，保留合法依赖循环。canonical 外部 target 在哈希命名物化区去重；外部 `node_modules` 树保留祖先查找层。最终 `realpath` 审计证明每个可写链接 target 均在 snapshot 内。悬空/不可解析链接、特殊文件、可写逃逸以及复制/读取失败都会在 candidate 运行、cutover 创建或 previous 停止之前中止。
- candidate/composition 诊断在进入 CLI 输出前脱敏 bearer 形态的 `token`、`grant` 查询值。
- target readiness/canary 放在 `targetValidation`，恢复后仍保留；previous readiness 及其 canary 分类放在 `recovery.validation`。如果只有 rejected target 的单例凭证，recovery canary 明确记为 `skipped`，同时仍强制要求稳定 child/listener ownership。ownership 发生变化属于恢复失败，绝不跳过。
- launchd/systemd 首次初始化要求 operator 提供 execution surface 与 install anchor。已有 `--if-absent` 状态保持不变，不重新解释 installer-time 默认值。

## Alternatives considered

**从 `process.execArgv`、扩展名或 `DSH_HARNESS` 推断 source/built。** 拒绝，因为这些描述 guard 进程或 checkout，不一定描述 successor。生产故障正是 built npm successor 配上 tsx-started runner。

**保留独立 composition preflight，再启发式解析启动命令。** 拒绝，因为 shell command 无法安全、通用地解析，不同插件宿主也可能有不同 probe 模式。一等 caller-supplied candidate probe 保留宿主特定验证，target-command 摘要则阻止随后启动漂移。

**让 candidate 直接使用 live home。** 拒绝，因为即使名义只读的 launcher 模式也可能修复链接或重写生成的 profile root。两个 pre-stop 检查统一使用 isolated-home 边界。

**原样复制源 symlink 文本或禁止全部链接。** 拒绝，因为 Node 非 verbatim 的递归复制会把相对 target 重写为绝对源路径，verbatim link 又可能逃出副本根；candidate 经任一种方式写入都可能触达 live 字节。反过来禁止链接会破坏真实 pnpm/Cordis 图及其合法循环。图感知重建加 contained-target 审计既保留运行语义，也执行真正的写入边界。

**把 target credential 检查失败当成 previous canary 失败。** 拒绝，因为该 credential 的仓库 provenance 错误。恢复将不可用的 credential proof 单独标为 skipped，并继续强制 runtime ownership proof。

## Consequences

- cutover caller 必须识别 successor 的真实 toolchain，并用同一 executable 与 launcher argv 构造 one-shot candidate command。这条 caller trust boundary 是显式的：无关命令可以被哈希绑定，却不构成等价证据；随包 Skill 提供安全的 DSH 构造。malformed final command 会在旧宿主仍可用时失败。
- 旧耐久 launch spec 仍可读取。新的 `configure-launch` 或 target `reconfigure` 建立显式 binding；一旦选中，same-launch preflight 会复用它。
- runner 文件受内容摘要约束。配置后重建或替换 runner 必须有意 reconfigure，不会静默改变 gate 实现。
- 测试覆盖 pre-stop candidate rejection、bearer 脱敏、binding 持久化、target 与 recovery 回执语义、live 与外部 link target 字节不变、真实 pnpm 创建的 workspace 循环、DSH 生成的 Cordis/toolchain 链接，以及既有完整 watchdog 生命周期。built DSH launcher 先生成全新 home，随后同一 launcher 的 candidate `--dump-config` 直接对保留链接图的 snapshot 通过。
