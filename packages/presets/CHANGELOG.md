# 变更记录

## 0.2.0（2026-09-30）

- **dsh-writing preset 面向写作场景重调**：persona 不再以「coding agent」开场，身份是写作者；规则随身——平实文风（面向一般读者、清晰优先于机巧、不造词）、中文句子用全角标点；`command-goal`/`tool-goal` 行移出 preset（目标追逐是编码工作流）；preset 描述不再读作编码 agent
- **提示段落统一英文书写**：单语言段落只有英文可达（官方段落与工具目录本就英文，写作场景也覆盖英文作品）；文风/词汇规则改为相对输出语言表述，plan-mode 段落回归与官方英文原文逐字一致，canvas 指引句同步（其工具描述保持中文——另一层）
- 加宽 `@deepseek-ai/dsh-agent-preset` peer 区间以覆盖宿主 0.2.0

## 0.1.1（2026-09-28）

首个公开发布——三个社区 preset（开发/评测/写作）的声明式 bundle 包（preset as a bundle，宿主 ≥ 0.1.7-rc.1）。
