# Agent Note: 评测家族收紧衔接，不在包之间搬能力

Status: implemented

## Problem

对四个评测核心包（datasets、mission、lab、eval）做了只读评估。结论是分工合理，但衔接松：

1. **eval 自己拼 mission 的磁盘布局。** 九个 eval 模块手拼 `runs/<runId>/data/<missionId>/attempt-N`。mission 一改布局，eval 的读写会静默失效。
2. **两个 CLI 适配器解析 mission 给人看的表格。** eval 的 finalize 路径和 lab 的 `cliMissionFace` 按列切 `dsh-mission list` / `get` 的输出，展示一改就坏。
3. **判题规则有两份，漂移了也没人发现。** eval 的 `judge.ts` 和 datasets 的 `rubric.ts` 实现同一套 rubric 路径、probe 路径和 criterion 规则，两边不一致时没有任何检查报出来。
4. **`run.ts` 一个文件装下整个跑测循环，约 2400 行**，eval 的 `src/` 也是平铺的（约 70 个模块）。
5. **运行级事实记在首个 cell 上。** 收口标记和导出记录都写成该运行第一个 mission 的 annotation：没有 cell 的运行收不了口，读的一方还得知道这个约定。
6. **eval 走旁路导出。** 它调 `missionRemote.exportRun(agent, …)`，再在外面重写一遍数据集层的泄题闸。
7. **mission 用的是 eval 的词。** `NsCellReport` 这类名字描述的是 mission 并不知道的编排方；datasets 还把判题可行性检查描述成「generic」。

## Decision

**不在包之间搬能力。** 分工不变：datasets 管内容与版本，mission 管账本与状态机，lab 管容器生命周期，eval 管编排、判分与报告。依赖已经只朝一个方向，四个包仍能各自单装，降级行为不变。T89 只收紧衔接。

1. **mission 的 service 和 Remote 提供 `attemptDataDir(runId, missionId, attempt)`。** 布局只由 mission 一家掌握，eval 所有自己拼路径的地方都改成问 mission。mission 没有这个动词时，`eval run` 拒绝并提示升级，读路径显示未知 hash，cell-artifact 拒绝。
2. **`dsh-mission list --json` / `get --json`** 输出 `{schema: 'dsh-mission.list/1', missions}` 和 `{schema: 'dsh-mission.get/1', runId, mission}`。eval（`parseMissionList`）和 lab（`parseMissionGet`）只解析 JSON，按列解析的代码删掉。旧 CLI 不认 `--json`（报「requires a value」，退出码 2），两个适配器都把它转成升级提示（`oldMissionCliHint`）。
3. **判题规则契约测试** `scripts/judge-rule-contract.spec.ts` 由 `pnpm test:scripts` 运行。它按相对路径加载两份实现，用同一份 fixture 跑一遍：rubric 选取、probe 发现、criterion 叶子读取。包之间不新增依赖边。两处已知差异写成显式用例，不跳过：
   - 「没有 rubric」一边是 `null`，一边是 `undefined`。
   - 叶子的严格度只差一个方向：datasets 会拒掉一些 eval 照样能读的叶子。

   两边源码都加了指向这个 spec 的注释。
4. **eval 的 `src/` 分成五个目录**：`contract/`、`run/`、`judge/`、`report/`、`design/`。
   - 先用一个提交纯移动，只改 import。入口、读取面和 conditions/provision 模块留在顶层；后者留着是为了让并行的 T91 合入不冲突。
   - `evalVersion()` 原样挪到 `src/eval-version.ts`。它在包根下一层，所以读 `../package.json` 在 `src/` 和打包后的 `lib/` 里都能解析到。
   - 第二个提交把 `run/run.ts` 拆成 `cell-shared.ts`、`unit-lifecycle.ts`、`judge-cell.ts`、`cell-once.ts`。`run.ts` 保留 `runPlan`、公开的 `Run*` 类型，并再导出 `EvalRunRefused`，所以包的导出没有变化。
5. **mission 提供运行级 annotation。** `RunRecord.annotations` 是一组 `{ns, payload, createdAt, by}` 条目。
   - 只追加、按命名空间区分，没有修改或删除的动词。
   - `annotateRun` 写入完全相同的条目时幂等。
   - 有 service、Remote 读、CLI（`run annotate` / `run annotations`）和 bundle（`run.json`，非空时才带）几个面。
   - eval 的 `run-notes.ts`：mission 有这个动词时，收口和导出记录写在运行级；mission 是旧版时退回首个 cell。
   - 读的一方把运行级列表和所有 cell 的列表合起来，按旧的首 cell 约定收口的运行照样读成已收口，最新的条目为准。
   - 否决的方案：
     - `run.meta` 里放一个可改字段：丢历史，还容易写竞争。
     - 专门的「收口」动词：会让 mission 学到 eval 的概念。
6. **mission 的 service 提供带闸导出。**
   - `setLayerProbe` 用来装 datasets 的分层探针，`exportPlanGated` / `exportRunGated` 在 mission 内部过泄题闸和 TTY 闸。
   - eval 改调 `ctx.mission.exportRunGated`，删掉了 Remote 旁路和自己那份闸。
   - 不带闸的 `exportRun` 留给 mission 自己的 CLI 和斜杠命令，它们本来就各自过闸。
   - 选择新增动词而不是原地给 `exportRun` 加闸，是为了不让现有调用方的行为在脚下改变。
   - 闸本身留在 mission，迁移它不在本任务范围内。
7. **中性词汇。**
   - `NsCellReport` 改名 `NsAttemptReport`，旧名保留为 `@deprecated` 类型别名。
   - 局部变量改称 entry / attempt。
   - `expectedNs` 是存进 meta 的键，保留原名，在文件头注释里说明来源。
   - datasets 把判题可行性检查如实描述为「eval 判分所用的规则」，不再叫 generic。

## Alternatives considered

- **把泄题闸或导出挪进 eval，或者把 rubric 可行性检查挪出 datasets。** 评估否决：它们各自和所守护的数据在一起，挪动会加一条方向反了的依赖边。
- **给判题规则建一个共享 npm 包。** 为了约一百行代码，要新增一个发布单元和一条依赖边；契约测试不需要这两样就能报出漂移。
- **按版本解析表格，不做 `--json`。** 等于把给人看的格式继续当 API 用。

## Consequences

- mission 成了唯一知道 attempt 目录布局的模块，以后改布局不再需要动 eval。
- 新 eval 配旧 mission 时会明确降级，不会静默出错：
  - 跑测拒绝，导出拒绝。
  - 标记落在首个 cell 上。
  - CLI 适配器提示升级。
- 仓外直接引用 eval 深路径（`src/<module>.ts`）的代码要跟着新目录改；包的导出表不变。
- 旧的 `lib/` 里还留着平铺时的文件，打包前要清掉 `lib/`。
- 公开 API 的变化：
  - eval：
    - `parseMissionRow` 换成 `MISSION_LIST_SCHEMA` / `parseMissionList` / `oldMissionCliHint`。
    - `MissionExportRemoteFace` 改名 `MissionExportFace`。
    - 辅助函数 `attemptDataDir` 改名 `attemptDirOf`。
    - `recordExportNoteOn` 接受 mission id 为 undefined。
  - lab：新增导出 `cliMissionFace` 和 `parseMissionGet`。

## Testing

- mission、eval、lab、datasets 四个包的测试套件，含下面这些新增测试：
  - mission：`attemptDataDir`、运行级 annotation（追加、幂等、持久化、bundle）、带闸导出、`list` / `get --json`。
  - eval：`run-notes` 的运行级写入，以及对旧首 cell 写法的读取兼容。
  - lab：`parseMissionGet` 和旧 CLI 提示。
- 契约测试的变异证明：七处单行变异逐个让 spec 变红，测完复原。
  - eval 侧：rubric 路径改成最长者胜；probe 路径接受 `.js`；criterion 要求带 weight。
  - datasets 侧：rubric 路径不认 `.yaml`；probe 路径倒序排序；叶子字段丢掉 `evidence`；`nonEmptyString` 不再 trim。
- 门禁：`pnpm test:scripts`、`pnpm check:hygiene --all`、`pnpm check:plugins`。
- 在一个临时 0.2.0 实例上验证：一个从 lab 实例只读拷来的旧运行和一个新运行，结果页、导出、收口标记都正常。

## Related

- 之前的一次纯形态整理：[评测家族把工具包折进核心包](2026-10-01-eval-family-tool-fold-and-bundle.zh.md)。
- 文案：profiles/web-eval/docs/iterations.md 里的 T89。
