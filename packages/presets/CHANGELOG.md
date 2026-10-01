# 变更记录

## 0.3.0（未发布）

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
