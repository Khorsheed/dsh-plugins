# @khorsheed/dsh-presets

[English](README.en.md) | 中文

社区 agent preset 的声明式 bundle：`dsh-dev`（开发模式）、`dsh-eval`（评测模式）、`dsh-writing`（写作模式）、`dsh-gamedev`（游戏开发模式）、`dsh-learning`（学习模式）、`dsh-video`（剪辑模式），各为宿主 0.1.7-rc.1 preset 机制里的一行 `@deepseek-ai/dsh-agent-preset` 声明（loader 行 id 约定 `preset-<id>`）。本包是 0.1.5 时代三个目录式 preset（`$DSH_HOME/.agent-presets/<id>/`）的迁移——rc.1 不再读取该目录，preset 改由 bundle patch 声明；新模式随版本入包。2026-10-18 起所有 preset id 统一带 `dsh-` 前缀（`dev`→`dsh-dev`、`learning`→`dsh-learning`，与官方 `standard`/`minimal` 等裸名区分命名空间）。

## 形态：纯声明包

- **无运行时代码、无客户端面**：`cordis.patch.yml` 的一个 `- insert:` 列表携带全部声明行；`src/index.ts` 只导出 `PRESET_IDS` 常量，让包有可构建的 `lib/`（pack-dist 的硬性要求）。清单以 `dsh.bundle.kind: 'preset-declarations'` 声明这一形态——check:plugins 据此改钉 preset 行约定（行名只能是 `@deepseek-ai/dsh-agent-preset`、行 id 必须是 `preset-<id>`），取代自挂载包的「自有运行时行」身份三角。
- **行由官方插件解释**：声明的激活、schema 校验、会话组合都归宿主的 `@deepseek-ai/dsh-agent-preset` / `-registry`（0.1.7-rc.1 起随官方 web-app bundle 发布，本包以 optional peer 声明）。
- **社区工具行按名引用、部署层解析**：preset 组合里的 `@khorsheed/dsh-local-agent-kimi/tool`、`-local-agent-codex/tool`、`-local-agent-claude-code/tool`、`-worktrees/tool`、`-room/tool`、`-typesafe/tool`、`-datasets/tool`、`-eval/tool`、`-canvas/agent`、`-canvas-novel/agent`、`-game/agent`、`-video-studio/tool`、`-library/tool` 行只命名模块——与旧目录式 preset 一样，这些包须装进同一个 profile 才能解析；它们是清单 `dsh.references` 里的数据引用，**不是** npm 依赖边。引用了装不上的模块的 preset 会带着诊断留在名册上（官方机制），不会炸掉宿主。

## 各 preset 的来源

| preset | 名称 | order | 来源与核对结果 |
| --- | --- | --- | --- |
| `dsh-dev` | 开发模式 | 10 | 官方部分以 rc.1 `standard.patch.yml` 全文重基（0.1.5 复制件已漂移：`workflow-worker-thread` 改名 `workflow-ptc`、`tool-ralph` 上游默认停用、新增停用的 `tool-plugin-manager` 行），末尾逐字追加现行 dev 的六条社区工具行（3× local-agent 委派 + worktrees/room/typesafe）。2026-10-18 由 `dev` 改名 `dsh-dev`（命名空间统一）。 |
| `dsh-eval` | 评测模式 | 0 | `profiles/web-eval/presets/eval` 逐行迁移，官方包名对照 rc.1 名册**零改名**；附 `datasets-tool` 与 `eval-tool`（`tools: all`）两条伴生行；`eval-planning` 技能随 `eval-tool` 行注册（T100）。T100 起组合以 web-eval 的 `preset-eval` 为正本，`scripts/eval-preset-parity.spec.ts` 比对两份解析后的 `plugins:`，任一边漂移即红。T102 把题集整理并进来：挂 shell（整理要跑 git 与转换脚本）、`tool-web` 开 fetch、`datasets-tool` 取 `tools: organize`（读 + `put_item` + 只写申请的 `datasets_propose_registration`，并注册 `dataset-authoring` 技能），persona 合并评测口径与整理的工作方式；仍不挂工作流引擎与 plan-mode。冻结决策 12 随之改写：docker socket 仍只归编排器，但不再靠预设保证。 |
| `dsh-writing` | 写作模式 | — | `profiles/web/presets/dsh-writing` 逐行迁移（唯一改名 `workflow-worker-thread` → `workflow-ptc`），附 `canvas/agent` 行。写作场景调优：2026-09-29 移除 goal 两行；2026-09-30 作家 persona 升级为完整双语写作契约（本文件持有的提示词段全部单一英文，宿主提示词本身的语言），同日参考官方 `minimal` 做工具精简——plan-mode、delegation/workflow 整组、fs-search、jobs、present、agent-instructions 移出，保留 shell（写作 skill 会调脚本，观察期）、fs 读写、Skills、compaction、ask-user、todo、web 与按会话授予的画布工具。2026-10-06 并入 `canvas-novel/agent` 行（原 bundle-writing 的「写作」preset，该包退役）：会话绑定长篇小说画布时才出现 `novel_*` 工具。 |
| `dsh-gamedev` | 游戏开发模式 | — | 2026-10-09 新增：游戏开发者兼策划导师的 persona（一个 agent，不另设策划 agent），工具与写作模式同一份精简（shell、fs 读写、Skills、compaction、ask-user、todo、web），外加 `game/agent` 行（`game_open` / `game_read` / `game_publish`、`gamedev` 与 `game-design` 两个技能）。没有测试工具：测试脚本随代码一起写，每轮结束由插件自动检查。 |
| `dsh-learning` | 学习模式 | 12 | 2026-10-12 自退役的 `@khorsheed/dsh-bundle-learning` 整行并入：精读教练 persona，官方 standard 的严格精简（无 fs/todo/goal/plan-mode/delegation；skill 面为白名单——不挂 skill-filesystem，只见能力目录受管投递的技能；shell 走会话自身沙盒 + 逐条批准），外加 `@khorsheed/dsh-library/tool` 授予行（`tools: all`，并以 hideSections/denyTools 在本 scope 静音根上与学习无关的段落与 `list_capabilities`）。2026-10-18 由 `learning` 改名 `dsh-learning`（命名空间统一）。 |
| `dsh-video` | 剪辑模式 | — | 2026-10-06 新增（剪辑台 M1），不来自旧目录式 preset。persona 是剪辑搭档：混录不能只剪一个人、所有修改都是待确认的提议、时间用原始录音的秒数且成片时间戳由工具算；工具组合是剪辑流程自带的精简集（fs 定位素材、skill 加载器、compaction、ask-user、todo，无 shell 无 web），末尾一行 `video-studio-tool`（`@khorsheed/dsh-video-studio/tool`）授予 `video_*` 工具与 `video-studio` 技能。服务核心由 profile 根的 video-studio 行提供，未装时该行 pending、零注册。 |

展示字段（`name`/`description`/`order`）来自各旧 `preset.yml`（`dsh-learning` 的来自 bundle-learning 的清单），描述文字保持中文原文；`dsh-eval` 的描述 T100 起跟随 web-eval 那份（比对测试连 `name`/`description` 一起钉）。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-presets
```

挂载后这些 preset 出现在会话的模式选择里。评测相关的东西（datasets / eval 工具、`/eval` `/datasets`、两个评测技能、实验室与题集的会话面）全部挂在 `datasets-tool` / `eval-tool` 两条伴生行上，只有 `dsh-eval` 点名它们——开发、写作会话里一样都没有（`tests/presets.spec.ts` 钉住）。各 preset 引用的社区伴生包按需安装（例：开发模式的委派工具需要 local-agent 家族的三个 provider 包同装一个 profile——各自的 `./tool` 组合入口随包解析；学习模式的图书馆工具需要同装 `@khorsheed/dsh-library`；剪辑模式的 `video_*` 工具需要同装 `@khorsheed/dsh-video-studio`）。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5`）**：❌ 不可用——`@deepseek-ai/dsh-agent-preset` 行类型在 0.1.5 不存在（0.1.5 的 preset 是 `$DSH_HOME/.agent-presets/` 目录，本包正是来替代它们的）；在 0.1.5 上本包连挂载都谈不上，非 degraded。
- **源码线 / npm 0.1.7-rc.1+**：✅ 完整（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿：六个预设（开发/评测/写作/游戏开发/学习/剪辑）的 persona 行不再使用 `{{cwd}}`（上游 0.2.1 已删该变量）。行类型随官方 web-app bundle 发布（minHost `0.1.7-rc.1`）。preset 里引用的社区伴生行可用性取决于对应包是否同装（缺则该 preset 带诊断留在名册，其余 preset 不受影响）。

**版本线对照**：`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。
