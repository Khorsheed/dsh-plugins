# 撤回可选回滚文件状态（withdraw-file-rollback）
- **分类**：plugin（社区 v1 子集纯插件；完整性原语需契约扩展）
- **状态**：planned
- **最后更新**：2026-08-21
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——无同意图提案。datasets-store 的「snapshot」是数据集版本固化（git 对象 pin），lab 的「checkpoint」是容器/实验单元回溯点，均与本意图（**工作区文件状态回滚**）不同生态位。与 message-tools 撤回（surface 隐藏，模型侧）是同一能力的后半段：本提案是其**文件侧**扩展，实施会落到 message-tools / file-preview / ui-file-preview 三个既有包。
- **官方依赖**：需契约扩展（upstream 候选）。完整性需要两项上游能力（见 Track B）；社区 v1 子集（Track A）为纯插件，可在官方提供前先行交付，但**必须带覆盖判定护栏**（见 A3）。

## 目标

message-tools 撤回目前只把 [目标..surface 尾] 从**模型上下文**隐藏（surface replacement + 分隔线 + DOM 隐藏聊天行 + 草稿回填），**完全不感知文件状态**：回合内工具调用写过的文件原样留在磁盘。本提案让撤回**可选**地回滚文件状态（每回合 checkpoint），核心动机是消除「**关键文件没回滚 → 整体出现新 bug**」的风险——半回滚（改了一些、漏了一些）比不回滚更糟，因此方案的硬约束是：**完整性不可证明时，不提供回滚选项**。

## 现状（官方契约实测，2026-08-21）

1. **无任何工作区快照/回滚能力**。`packages/workspace` 只管理注册表记录（会话归属、排序），不碰文件内容；全仓库无 checkpoint / 快照 / 文件日志。
2. **唯一持久化的 diff**：会话日志 `tool/result` 事件的 `meta` 字段（`packages/core/session/src/types.ts`，注释明确「durable log reproduces the identical card on replay」）。但**只有 fs write/edit 工具**会附：`meta.diffs` = `computeHunkDiffs(before, after)` 的**上下文 hunk diff**（`packages/fs/tool-fs/src/{write,edit}.ts` 的 `presentationMeta`）：
   - create → `[]`（`before === null`）；
   - overwrite 超大文件（> `diffBasisMaxBytes`）或二进制旧文件 → `before: null` → **无记录**；
   - `FileDiff.oldText` 在 overwrite 时是 `null`（`packages/core/tools/src/presentation.ts`）——**事后无法从日志反推完整旧内容**。
3. **关键事实**：`LocalFileSystem.writeText` / `edit` 在写入时**已经捕获完整 before/after**（`FsWriteOutcome.before: string | null`，`packages/fs/fs-local/src/index.ts`），但**用完即弃**——日志里只留了 hunk diff。恢复的可靠来源是这份 before/after，不是日志 diff。
4. **bash/execute 结构性不可见**：不经过 `ctx.fs`，任何内容级记录都没有。file-preview 的 `BashWriteCollector` 只能事后按命令串启发式猜路径、`fs.stat` 验证、封顶 8 个候选、只记路径不记内容——它的存在本身就是这个缺口的证据。
5. **既有可复用构建块**：`SandboxedFileSystem extends LocalFileSystem` 证明「替换 fs 后端」是可行范式（`packages/fs/fs-sandbox`）；`BashWriteCollector` 证明「旁路侧注册表（不碰会话日志、`session/created` 重放重建）」是可行范式（`packages/file-preview`）；message-tools 的 withdraw Remote + RiskConfirmation 是现成集成点；ui-deliverables / ui-file-preview 已按回合推导/展示产物路径。
6. **官方近期 rc**：harness 最新 `0.1.0-rc.8`（2026-08-21 核）；fs / session / agent-loop / tools 无 checkpoint / snapshot / rollback / journal 相关提交。官方**当前未提供**类似能力（见「决策门」的复查约定）。

## 核心约束

- **完整性只能来自「基线」，不能来自「逐文件推断」**：逐文件捕获必然漏（bash 不可见、delete/move 不在展示谓词里、overwrite 无 before、大小/二进制上限），漏出来的半回滚就是新 bug 的来源。
- 回滚 = 破坏性操作（丢弃 agent 的磁盘成果）：只对**有基线**的文件生效；恢复前比对当前内容（防覆盖用户手改/并发）；**要么全回滚，要么一个都不动**（事务化应用）。

## 方案

### Track A：社区 v1（纯插件，可在官方提供前先行）

- **A1 捕获（fs 工具）**：仿 `SandboxedFileSystem` 范式提供带日志的 fs 后端（`extends LocalFileSystem`，`writeText`/`edit` 的 `before/after` 落进按会话侧注册表），或监听 fs seam 结果；沿用 `BashWriteCollector` 的侧注册表模式（不碰会话日志，`session/created` 重放重建路径；before 内容为活体捕获，重启后降级）。
- **A2 整树基线（git 工作区）**：回合开始时 `git stash create`（增量对象成本≈变更文件数）+ untracked 清单；回滚 = 还原整树。兜住 bash 写入。保留/裁剪：侧注册表记录 sha，按最近 N 回合裁剪（悬空对象由 git gc 回收，裁剪后不可再回滚）。
- **A3 覆盖判定（安全护栏，核心）**：按回合从日志判定工具集——
  - 仅 fs write/edit → fs 日志**完全覆盖**；
  - 用了 bash/execute 但工作区是 git → 整树覆盖；
  - 非 git + 用了 bash/execute → **判定「无法完整覆盖」，不提供回滚选项**（宁可不给，不给半套）。
  回滚选项的 UI 上如实显示覆盖判定与受影响文件数（与产物同一套推导）。
- **A4 回滚执行**：只动有基线的文件；恢复前比对当前内容与回合结束时状态（不一致→拒绝该文件或整体中止）；临时文件 + rename 交换，任一失败整体中止；完成后校验。
- **A5 撤回集成**：`MessageToolsWithdrawRequest` 加 `rollbackFiles?: boolean`；RiskConfirmation 加勾选（默认关，实时显示受影响文件数）；分隔线显示「已撤回 · 已回滚 N 个文件」；restore 仍只重放消息、不重放文件副作用（现规则），恢复出的 mention 若指向被回滚文件则标记「已回滚」或保持 inert。
- **A6 产物tab 联动**：ui-file-preview 感知撤回 span（与 DOM hider 同源：读 replacement 的 `sourceEventSeqs`），落在被回滚 span 内的回合文件行标记「已回滚」/置灰——`turnFiles` 路径仍会列出，但 `read` 读的是回滚后内容，必须避免「列表→打开→内容对不上」的割裂。
- **A7 生命周期**：侧注册表内存 + 可选落盘（`$DSH_HOME` 状态目录或工作区 .dsh 目录）；插件卸载时清理；重启后 before 内容丢失 → 覆盖判定自动降级（该回合不再提供回滚）。

### Track B：上游原语（upstream 候选提案，走 upstream 变更流程）

- **B1 fs seam 持久化**：`FsWriteOutcome.before/after` 已在写入时存在，官方只需持久化为按会话存储/日志——近零成本，让 fs 工具捕获完整且可跨重启。
- **B2 shell/containment 层捕获点**：bash/execute 写入的内容级捕获（sandbox / containment 层是最自然位置）——这是社区永远补不齐的结构性缺口。
- **B3 语义归属**：保留/裁剪策略、跨会话共享工作区冲突、与 compaction / withdraw 的 surface 机制联动——动核心会话/工具语义，宜官方定。
- **B4 理想形态**：官方出「会话文件日志」原语 + checkpoint/restore 能力（如 `session/checkpoint` 或 fs 日志 RPC），社区只在 UX 层消费（A5/A6）。

## 决策门（等官方 rc，防止重复造轮子）

- **社区 v1 开工前**：评估官方近期 rc（当前 rc.8 无相关能力）。每发一版复查一次（fs / session / agent-loop / tools 的提交与 release notes）。
- 若官方提供 → 社区只做 UX 集成（A5/A6），本提案走「官方吸收」关闭路径。
- 若迟迟不出 → 按 Track A 落地（带 A3 护栏），Track B 作为 upstream 提案并行提交。

## 里程碑（Track A）

- M1：fs 日志后端 + 侧注册表 + 覆盖判定（host，单测覆盖 before/after 捕获、判定矩阵、回滚执行、并发守卫、事务化）
- M2：message-tools `rollbackFiles` 集成（withdraw Remote + 对话框 + 分隔线/回填）
- M3：git 整树基线 + 裁剪
- M4：ui-file-preview 产物tab「已回滚」标记
- M5：真实 profile 验收（含 bash 回合的覆盖判定降级实测）

## 实现记录（随实施追加）

- 前置讨论与现状盘点（2026-08-21，本会话）：fs seam 已捕获 before/after、日志仅 hunk diff、bash 结构性不可见、官方 rc.8 无相关能力。
- （实施时登记相关 Agent Note / PR / 包名）

## 验收标准（done 判定，绑定可插拔交付）

- 独立插件形态交付（`dsh plugin add/remove` 一条命令，零官方改动）：fs 日志后端以可替换 fs 后端或独立 host 服务交付；message-tools/file-preview 改动随各自包版本发布，卸载后行为回退（撤回无回滚选项）。
- 覆盖判定矩阵有测试钉死：fs-only / git+bash / 非 git+bash 三态；「不完整不提供」是硬断言。
- 回滚安全性测试：并发/手改守卫（恢复前内容不一致→拒绝）、事务化（模拟中途失败→整体中止、无半套）、create/overwrite/edit 三型文件正确还原。
- 产物tab 联动：被回滚回合文件行出现「已回滚」标记，read 内容与标记一致。

## 风险 / 放弃的东西

- **放弃**「tool/call 时逐文件读 before」：必然漏 bash/delete/move，正是半回滚源头（已论证）。
- **放弃**「靠日志 hunk diff 反推恢复」：hunk 是上下文截断的展示数据、create=[]、overwrite 大文件无 before，反推脆弱。
- git 悬空对象膨胀：靠裁剪 + gc 兜底；裁剪后不可回滚是接受的降级。
- 跨会话共享工作区：A 会话回滚整树可能影响 B 会话——覆盖判定 + 内容比对守卫能检测并拒绝已变化的文件，但「回滚到过去」固有边界需在 UI 讲清（二次确认文案明确「还原到该回合开始时状态」）。
- 逻辑一致性是整树方案的优点：还原到回合前 = 自洽状态；半套方案才有「文件 A 回了、依赖它的 B 没回」的混血问题——这正是本提案拒绝半套的原因。
