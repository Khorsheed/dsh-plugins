# Agent Note: mission — bundle 导出、泄题闸、expectedNs 报告（里程碑 M2 后半）

Status: implemented

[English](2026-08-19-mission-m2-export.md) | 中文

## Problem

[mission 提案](../../../proposals/active/2026-08-19-mission-tasks.md)把分享 run 定为泄题闸（§5）之后的发起类人决定：收录 `modelFacing: false` 层的 bundle 会让该批题作废，所以导出需要交互式人确认、对非 TTY 调用方 fail-closed 拒绝、且只存在于人确实能确认的面上——绝不做成模型工具。同时 §6 要求 bundle 自包含、`expectedNs` 完整性报告如实标缺失（绝不顶替）。[M2 前半](2026-08-19-mission-m2-slash.md)交付了不含 export 的 slash 面；本切片交付 `dsh-mission export` + `/mission export` + 泄题闸 + 缺失报告。

## Decision

导出内核是 `src/export.ts`，与面无关：`planExport` 计算 bundle 将包含什么（收录层及其预先解析的 guarded 标记、`guardedLayers` 触发清单、ns 完整性报告），一字节不写；`exportRun` 落盘并信任调用方已过闸。bundle（`<outDir>/<runId>-bundle/`）按 §6：`manifest.json`（冻结的状态机、快照 `{repo, commit, dataset}` 引用、按排序 path+content 的逐层 sha256、如实重述 guarded 层的收录层清单、ns 报告）、`run.json`、`missions/<id>/attempt-N/{meta.json, annotations.json, artifacts/}`（产物字节从运行数据树摘入）、每个收录层的 `dataset/<layer>/`、以及 `methodology.md` 占位。已有 bundle 目录绝不覆盖（append-only 立场）。声明 `--layer` 必须带 `--snapshot-dir`——bundle 要么自包含要么不是。

**泄题闸**住在各面里，按每个面诚实的形态：

- **CLI**：guarded 层 → 经 readline 逐层 `y/N` 确认，但仅当 stdin 且 stdout 都是 TTY；非 TTY 以退出码 1 拒绝（fail-closed），列出层名并声明无 flag 可绕过。`runCli` 接受可注入的 `tty: { isTTY?, confirm? }`，测试驱动两个分支；bin 入口传真实流。
- **slash**：命令调用是单发文本，没有追问通道，所以 `/mission export` 对 guarded 层拒绝并指向 TTY CLI——拒绝正是闸在工作，不是缺失的功能。挂载 datasets 插件时，slash 面经 `ctx.get('datasets')` 探针（鸭式 `list({repo}, dataset, commit)` → `dataset.nonModelFacingLayers`）读层可见性；缺席或任何形状漂移 → 只靠显式 `--guarded` 声明。
- 无 guarded 层的导出在任一面都无需仪式直接完成。

**expectedNs 报告**（export.ts 的 `nsCompleteness`；`run status` 经共享的 `renderStatus` 打印，export 打印并嵌入 manifest）：逐格——`present`（全部 ns）、`expectedPresent`、`missing`（expectedNs 减去 present，如实标缺失，绝不顶替）、`onlyUnlisted`（有注解但无一来自 expectedNs——提案 llm-draft 例子的「看起来评过了实则只有初稿」，不硬编码场景词汇地标记）。

export 不在模型工具面注册；系统提示词段照旧声明这一点。

## Alternatives considered

- **`--include-guarded` 绕过 flag**——按提案否决：agent 会自己加 flag；只有交互式逐层确认才算人的决定，CLI 不接受此类 flag，拒绝信息说明原因。
- **slash 侧「输入 yes 确认」文本**——否决：slash handler 一次调用返回一个 CommandResult，无法在一次调用内提问并读答案；预先打字的 `--yes` 就是绕过 flag 的变种。拒绝 + 指向 TTY CLI 是诚实的映射。
- **CLI 直读 dataset.yml 取层可见性**——否决：CLI 在宿主进程外（无 ctx），mission 不带 YAML 解析器；CLI 用显式 `--guarded` 声明，宿主内面探 datasets 插件。
- **在 `exportRun` 内强制闸**——否决：内核无法知道调用方是否可交互；它只算触发清单（`planExport.guardedLayers`），交互归各面——M4 tab 的导出按钮因此能以确认对话框实现同一闸。

## Consequences

- 泄题闸在 v1 两个面都存在，测试钉住：非 TTY 拒绝（带不带 flag 一样）、TTY 逐层接受/中止、slash 拒绝并指 CLI、datasets 探针路径。
- bundle 可验证地自包含（测试只凭 bundle 读取全部事实），逐层与逐 attempt 产物树内容哈希。
- `run status` 新增 expectedNs 块——M1 note 正好把这项留给了 M2。
- 闸的「内核计算、各面确认」分工就是 M4 tab 导出按钮复用的合约：Remote 把 `guardedLayers` 带给浏览器，对话框逐层确认，确认清单随导出调用回传。

## Testing

`packages/mission/tests/export.spec.ts`（12 个测试）：bundle 形状与自包含（manifest/run/mission 格/产物/数据集层/methodology）、逐层与逐 attempt 内容哈希、ns 报告语义（完整格、只有未列 ns 的格、缺失不顶替）、run status 报告渲染、覆盖拒绝、有 layer 无 snapshot-dir 拒绝；CLI 闸——非 TTY 拒绝（一字节未写）、TTY 拒答在写前中止、TTY 确认导出且 manifest 含 `guardedLayers`、无 guarded 无需 TTY、用法错误；slash 闸——guarded 拒绝并点名 CLI、探针解析出的 guarded 拒绝、无 guarded 成功且输出带 ns 报告。`tests/bin.spec.ts` 新增构建产物 export 冒烟（spawn 即非 TTY：guarded 拒绝退出 1，无 guarded 写出 bundle）。套件：97/97。

## Cross-references

- [Mission 提案](../../../proposals/active/2026-08-19-mission-tasks.md)——本 note 实现的 §5（泄题闸）与 §6（bundle 格式、ns 完整性）。
- [mission M2 slash](2026-08-19-mission-m2-slash.md)——export 扩展的面；[mission M1](2026-08-19-mission-m1.md)——store 与服务内核。
