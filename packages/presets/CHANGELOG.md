# 变更记录

## 未发布

- **新增剪辑模式 `preset-dsh-video`**（剪辑台 M1，2026-10-06）：剪辑搭档 persona（混录不能只剪一个人、修改都是待确认的提议、成片时间戳由工具算），工具组合照写作模式精简版，末尾 `video-studio-tool` 行授予 `@khorsheed/dsh-video-studio/tool` 的 `video_*` 工具与 `video-studio` 技能。`PRESET_IDS` 加 `dsh-video`，`dsh.references` 加 `@khorsheed/dsh-video-studio`
- **题集整理并进评测模式（T102）**：删除 `preset-dataset-authoring`（题集整理）行，`PRESET_IDS` 回到三个；`preset-dsh-eval` 照 web-eval `preset-eval` 的新组成改：加 `tool-bash` / `tool-pwsh`（整理要跑 git 与转换脚本）、`tool-web` 开 fetch、`datasets-tool` 从 `authoring` 换成 `organize`（读 + put_item + 只写申请，挂 `dataset-authoring` 技能），persona 合并评测口径与整理的工作方式，描述同步。用过「题集整理」的旧会话在续接时找不到预设，见 T102 的 Agent Note
- **评测线迁 3080（T100）**：`preset-dsh-eval` 的 persona 同步成 web-eval `preset-eval` 的现行版本（只认 `datasets_list` 登记的题集、版本歧义问人且跳过即停、「新建实验」表单的逐项询问、路径不是题集、草稿不写进题库），`eval-tool` 行注释改成「四读两写」；此后 web-eval 那份是组合正本，两份由 `scripts/eval-preset-parity.spec.ts` 比对。新增第四行 `preset-dataset-authoring`（`id: dataset-authoring`，题集整理，order 11），照 web-eval bundle 的同名行镜像：挂 shell、`datasets-tool` 取 `tools: organize`、不挂 eval 工具，datasets 核心的 `authoringPreset` 默认值在跑本包的部署上从此有对象。`PRESET_IDS` 加 `dataset-authoring`；测试新增「开发、写作预设不点名 datasets / eval / mission 工具行，不提评测技能」
- **写作模式并入长篇小说工具**：`preset-dsh-writing` 加 `canvas-novel-agent` 行（`@khorsheed/dsh-canvas-novel/agent`），原 `@khorsheed/dsh-bundle-writing` 的「写作」preset 退役。`novel_bind`、novel skill 与轻指引段随本 preset 授予；`novel_read` / `novel_write` / `novel_extract` 只在会话绑定长篇小说画布时出现，其余画布照旧只有画布工具。persona 的 Canvas 段加一句：小说画布上的卡照旧走 canvas_write、直接落成正式卡，绑定后另有 novel_* 管章节、台账与待审；`dsh.references` 加 `@khorsheed/dsh-canvas-novel`

## 0.3.0

- **dsh-eval preset 的两条评测工具行改指核心包的 `./tool` 组合入口**（评测家族折叠，T88）：`datasets-tool` / `eval-tool` 的 `name` 从已退役的 `@khorsheed/dsh-datasets-tool` / `@khorsheed/dsh-eval-tool` 改为 `@khorsheed/dsh-datasets/tool` / `@khorsheed/dsh-eval/tool`；行 id 与 config 不变，组合状态不受影响。`dsh.references` 同步换成 `@khorsheed/dsh-datasets` / `@khorsheed/dsh-eval`
- **dev preset 的三条 local-agent 委派工具行改指各 provider 的 `./tool` 组合入口**（家族折叠）：`name` 从已退役的 `@khorsheed/dsh-local-agent-tool-subagent`（带 `provider`/`toolName` config）改为 `@khorsheed/dsh-local-agent-kimi/tool`、`-codex/tool`、`-claude-code/tool` 且不带 config（入口自带默认值）；行 id（`tool-subagent-kimi` 等）不变，组合状态不受影响。`dsh.references` 同步换成三个 provider 包
- **写作 preset 参考官方 `minimal` 做工具精简**（实测 minimal 效果优于全量组合）：plan-mode、delegation/workflow 整组（subagent/fork/ptc/ralph）、fs-search、jobs、present、agent-instructions 移出 preset；保留 shell（写作 skill 会调转换脚本，观察期）、fs 读写、Skills、compaction、ask-user、todo、web 与按会话授予的画布工具。persona 保持作家身份与完整双语写作契约不变；preset 描述同步去掉「计划模式、子代理」

## 0.2.1（2026-09-30）

- **写作 preset persona 升级为完整双语写作契约**：任务模式分流（写作/分析/改稿——分析类问题直接回答，不再被写成小说）；中英双语禁用词表（黑话、生造词、含糊填充）与句法规则（保留连接词、禁警句式收尾、禁短句连击）；抽象句必跟例子；语气规则（不评价自己的文字、不评价用户措辞、不推销观点）；开放问题给 2–3 个方向并标注不确定处；输出前自检清单；中英正反例。canvas 段只保留工具层没有的三条协作约定（提案/评论/稿件版本流），不再重复包内的一行机制指引

## 0.2.0（2026-09-30）

- **dsh-writing preset 面向写作场景重调**：persona 不再以「coding agent」开场，身份是写作者；规则随身——平实文风（面向一般读者、清晰优先于机巧、不造词）、中文句子用全角标点；`command-goal`/`tool-goal` 行移出 preset（目标追逐是编码工作流）；preset 描述不再读作编码 agent
- **提示段落统一英文书写**：单语言段落只有英文可达（官方段落与工具目录本就英文，写作场景也覆盖英文作品）；文风/词汇规则改为相对输出语言表述，plan-mode 段落回归与官方英文原文逐字一致，canvas 指引句同步（其工具描述保持中文——另一层）
- 加宽 `@deepseek-ai/dsh-agent-preset` peer 区间以覆盖宿主 0.2.0

## 0.1.1（2026-09-28）

首个公开发布——三个社区 preset（开发/评测/写作）的声明式 bundle 包（preset as a bundle，宿主 ≥ 0.1.7-rc.1）。
