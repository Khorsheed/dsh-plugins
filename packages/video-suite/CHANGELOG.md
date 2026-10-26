# 变更记录

## 0.1.0（2026-10-24）

- **快速决策并入**:`@khorsheed/dsh-typesafe` 成为成员(根行 `typesafe`,与开发套件同一行;preset 另授 `typesafe-tool`,密钥在本模式的「工具与技能 → typesafe-decide」里也能填)。协作间的「自动判断」(新消息并不并进已有任务、成员结果何时汇报)靠它;没有它时协作间退回「新消息当新任务、结果一到就汇报」。
- **多 agent 协作**:成员加入 local-agent 全家(核与 kimi / codex / claude-code / dsh 四个 provider,deps-only 库 local-agent-dsh-headless 随行)与协作间(`room`);preset 授予三个本地委派工具(`tool-subagent-kimi` / `-codex-local` / `-claude-code-local`)、`room-tool`,以及官方 `tool-subagent-control` / `list-agents`(等待、读取、停止已派出的任务)。官方 spawn/fork 子代理不授予。
- **preset 行正本归本包**:`@khorsheed/dsh-presets` 退役,本包 patch 里的 preset 行不再是镜像,而是唯一副本(组合内容不变)。
- **改名**:npm 包名 `@khorsheed/dsh-video` → `@khorsheed/dsh-video-suite`(首发前改名,旧名从未发布)。包名与卡名「…套件」对齐,并与同名的镜像仓/集合名分开;preset id、行 id 与目录不变,会话与设置无感。

首个公开发布:剪辑模式包——`dsh-video` preset 行+ video-studio 规范行。
