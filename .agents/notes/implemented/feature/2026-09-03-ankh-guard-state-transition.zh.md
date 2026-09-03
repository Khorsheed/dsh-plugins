# Agent Note: ankh-guard 可逆状态隔离

Status: implemented

[English](2026-09-03-ankh-guard-state-transition.md) | 中文

## Problem

[启动配置切换协议](2026-09-01-ankh-guard-launch-cutover.zh.md)可以原子选择并恢复一份完整 launch spec，却假定 previous 与 target 都能读取同一份 dsh home 字节。一次宿主升级打破了这个假设：target 在监听端口前就拒绝旧格式写下的可重建投影缓存。手工删除缓存虽能让这版 target 启动，却不能证明 preflight 看到相同 remediation、删除只发生在 previous 停止以后，或 target 失败时 previous 一定取回逐字节相同的状态。

## Decision

- `reconfigure` 接受可选的 schema-v1 transition plan。计划包含 canonical home 与一个或多个互不重叠的 home-relative `quarantine` 操作，并同时列出 target 不应看到的旧输入，以及恢复后 previous 不应看到的 target 输出路径，包括准备计划时尚不存在的路径。每个操作声明 `expect: present|absent`；隔离 preflight 与 live apply 都必须观察到该状态，因此准备期间路径出现或消失会直接拒绝，不会静默改变 rollback 含义。执行器还拒绝 traversal、符号链接、非目录祖先、guard state 重叠、跨文件系统 source、重复路径、未知字段与未知操作类型。计划经过规范化后持久化到 cutover id 名下并绑定哈希；后续执行会复核完整字节与操作数量。
- 准备 cutover 前，guard 把 live home 复制到私有临时目录并优先使用文件系统 copy-on-write，在副本中执行相同 transition，然后以该副本作为 `DSH_HOME` 运行 target composition preflight。失败会删除副本，previous 与 live home 保持不变。这只验证 boot acceptance，不构成隔离用户数据的授权：调用方只能用于已经证明可重建的状态。需要内容转换的迁移仍是独立机制。
- successor 取得监督权并停止已捕获的 previous child/listener identity 后，watchdog 才调用内部 transition 执行器。每一项都通过同文件系统 rename 移入 cutover-scoped `previous/` 树。逐项 journal 会在每次 rename 前记录意图、完成后记录结果，因此新 watchdog 可以区分被中断的 rename 与尚未开始的操作，并幂等续跑。
- transition applied 以前，target 不能取得 `child-started` 或终态 `ready` 回执。恢复会先停止所有已证明的 target identity，再逆序 rollback。target 在受影响路径生成的替代内容会先 rename 到 `rejected-target/`，然后恢复 previous 的原始字节。回执确认 rollback 完成以前，previous 不能取得 `restoring`、`child-started` 或 `ready`。apply 或 rollback 任一步失败都会记入回执并让 watchdog 停留等待，而不是让任一宿主读取含义不明的状态。
- target 成功切换后，previous 的隔离内容继续保存在 cutover 目录。guard 不会自动删除实质性状态；后续保留策略由 operator 决定。

## Why quarantine is the first operation

guard 需要一个安全属性不依赖具体宿主版本的小型执行器。把可重建缓存移出 candidate namespace 可以用原子 rename 逆转，也不需要理解其编码。通用 JSON patch、任意命令或内嵌 JavaScript transformer 会在最敏感的 stop/start 区间执行版本定制代码，并且无法提供标准逆操作。未来升级若必须转换内容，应新增具备显式校验、journal 与 inverse 语义的操作，而不是削弱 `quarantine`。

## Alternatives considered

**在 target 启动命令里删除或移动状态。** 否决：wrapper 没有权威的 previous/target 进程顺序、耐久逐路径 journal、标准 inverse 或回执门禁，target 失败后可能留下无法恢复的 previous 状态。

**停止 previous 后，直接在 transition 过的 live home 上做 preflight。** 否决：缓慢构建或 composition 错误会把只读的 candidate 检查变成不必要的停机。隔离副本让 acceptance 工作发生在 takeover 前。

**让 guard 内置 Alpha.4 缓存文件名或 record schema。** 否决：ankh-guard 是监督基础设施，不是宿主迁移目录。升级 agent 从两份 codebase 推导路径与可重建性；guard 只校验并执行通用文件系统语义。

**允许任意迁移程序外加一条 rollback 命令。** 否决：命令文本不能证明输入确定、crash recovery、部分完成工作的 inverse 或排除权威数据。未来内容转换操作需要专门的校验与 journal 语义。

## Consequences

- 不支持 copy-on-write 的文件系统可能需要完整复制 home。健康的 previous 会在此期间继续服务，失败仍发生在 takeover 之前。
- live transition 要求 guard state 目录与每个存在的 source 位于同一文件系统，使每次变更都只是一条 rename。跨文件系统部署会在 previous 停止前失败。
- 耐久回执只暴露计划 digest、操作数量、phase 与失败详情。路径只存在于 mode-0600 launch state 与 cutover plan；命令、浏览器 capability 与 bearer URL 仍不会进入回执。
- 单测覆盖恶意路径、计划篡改、rename 中断恢复、source 缺失、target 替代内容保留、原字节恢复与隔离 preflight。真实 watchdog 生命周期覆盖 previous 读取旧状态并提供服务、transition 后 target 写入不兼容替代状态并重试、rollback 与 previous 恢复。另一轮 npm host 演练把带旧 schema v3 projection record 的隔离端点从 0.1.1-rc.2 切到 0.1.2-alpha.4：无 transition 对照在产生部分 per-record 文件后失败，guarded cutover 则在副本完成 preflight、只 apply 一次，以 retry zero 达到认证 readiness 与 canary，并逐字节保留原 whole-unit 文件。
