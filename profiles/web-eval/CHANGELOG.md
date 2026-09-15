# Changelog

## Unreleased

- I0 规划版本：22 个成员的评测模式 profile（基础体验 12 + 本地 Agent 家族 6 + 评测机制 3 + 运维守护 1）。编排器 `@khorsheed/dsh-eval` 尚未存在，随 I2 加入成员清单。
- M4'③：mission / datasets / eval 拆成 core + companion。按域档位（`read` / `authoring` / `all`）从 profile 根的 core 行移到 `eval` 预设的三条伴生行（`mission-tool` / `datasets-tool` / `eval-tool`）；三个 core 行不再写 `tools`。此后本 profile 中非 `eval` 预设的会话不携带这三套模型工具（服务 / CLI / slash / tab 仍是全局的）。
- I5 · T34：第 2 步「一句话起草」在界面与会话里走通。新增 `skills/eval-planning/`，两个脚本按 `SKILL_IDS` 整目录覆盖到 `$DSH_HOME/skills/eval-planning`（`dsh-skill-filesystem` 的 `user-dsh` 根；`eval` 预设里那行 `skill-filesystem` 把它带进评测会话的技能卡），与 `presets/eval` 同款——技能教的是 `eval_plan_draft` 这一个起草动词与「批准 / 登录 / provision / 终评都不是 agent 的」，属装置不属偏好。`@khorsheed/dsh-eval-tool` 的 `tools: all` 随之从四个工具变五个（加 `eval_plan_draft`）；「实验室 › 新建实验」从占位变成真表单，与工具走同一个服务面动词。顺带修了两个脚本收尾处的一个既有 bug：`[ -d "$X" ] && rm -rf "$X"` 在 `set -e` 下当 `$X` 不存在时会直接结束脚本，全新安装因此从不打印自己的成功行；改成 `if` 块。
- I5 · T46：`presets/eval` 摘掉 `mission-tool` 行（界面规格 R6「评测模式下 mission 这个词不出现」）。原先由它授予的四个只读工具（`mission_run_list` / `mission_run_status` / `mission_list` / `mission_get`）随之消失，逐格细节改由 `@khorsheed/dsh-eval-tool` 新增的 `eval_cells` 读——投影算在 eval 的服务面（`cells(runId)`，经 `hosts.get('mission')` 的结构面），模型侧与前端都不碰 mission。同一行还是宿主任务 tab 的自隐判据，所以评测会话的任务 tab 自此不出现；`mission` 仍是这条线的账本与释放闸，包也照装（覆盖层预设可自行加回这一行）。
- `presets/eval` 的 persona 行改用 0.1.5 线的配置键 `prefix`（原 `text` 是 0.1.2 线的键，让 capability-catalog 在 0.1.5 上量不了 `eval` 预设：`$.prefix missing required value`）。
- README 立住理想架构、依赖插件、理想流程、最终 UI 与迭代计划（I0–I6），每个迭代带完成判据。
- 同端口交接脚本 `restart-into-web-eval.sh`，与 web-dev 同款（仅改名），走 ankh-guard 守卫通道；评测实例应使用独立的 `$DSH_HOME`。
- 安装路径可从源码走通（I1 · T5，缺口 G5/G6）：`install.sh` 增加 `--source <dsh-plugins 检出>` 源码模式——构建未上架成员、按 `--family` 打 tarball 进 profile 的 `tarballs/`、写 pnpm overrides 钉住家族边，再标准安装；npm 模式行为不变（成员全部上架的 I6 前会撞 registry 404）。
- I5 · T49：源码模式给 `pack-dist` 的 `--family` 改成逐个成员写 `name=version`。pack-dist 自 2026-09-12 起要求出现在依赖边上的家族成员自带版本（边按**目标包自己的版本**定范围），而 `install.sh` 仍只拼名字，打到 `local-agent-tool-subagent` 即停在 `peerDependencies entry @khorsheed/dsh-local-agent is a family edge but no version was given for it`，源码模式在 main 上整条不通。现在先把检出的 `packages/*/package.json` 扫成一张「包名 → 自身版本」表，循环里逐个成员查表；查不到版本的保持光名字并打一行 warn（只做改写的成员本就不需要版本）。
