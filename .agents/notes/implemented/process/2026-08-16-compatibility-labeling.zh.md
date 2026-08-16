# Agent Note: 兼容性标注——每包的 npm 线判定

Status: implemented

[English](2026-08-16-compatibility-labeling.md) | 中文

## Problem

所有插件的运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery),但这个结论只存在于一次依赖审计对话里,不在仓库中。从 npm 安装的用户无法判断每个包需要哪个宿主发布版,而真正降级的情形(ankh-guard 的 preflight 门禁依赖仅 fork 才有的 `dsh preflight`)完全不可见。

## Decision

每个包携带两个同步标注:双语 README 里的 `Compatibility` 节(按宿主线给判定——npm 发布线 `@deepseek-ai/dsh@0.1.0-rc.6` 与 deepseek-harness master——✅ 完整 / ⚠️ 降级 / ❌ 需要更新版本)和 package.json 里的机读 `dsh.compat` 字段(`minHost`,有降级项时附 `notes`)。AGENTS.md 把两者定为强制,并要求每次官方发版后复查降级项,发布版补齐所缺能力后即退役降级路径。2026-08-16 的审计给出初始判定:ankh-guard 在 npm 线为 ⚠️(preflight 门禁不可用,其余完整);两个待实测项已对发布 tarball 验证——`@deepseek-ai/dsh-session@0.1.0-rc.6` 导出 `./surface`(`isAppendSurfaceEvent` / `isReplacementSurfaceEvent`,message-tools),`@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6` 暴露 `conversation.input` 且 `SessionInput.submit('steer')` 存在(ui-shortcuts)——两者均为 ✅。其余 npm 滞后项(ConversationEventRegistry、dsh-api-remotes、shell.overlay)仅测试面/类型面或未启用,不拉低任何运行时判定。

## Alternatives considered

- **只用 peerDependencies 范围**——否决:范围表达不了"完整 vs 降级",且降级项(一个 CLI 命令而非包 API)没有可约束的依赖。
- **判定只留在审计笔记里**——否决:笔记面向维护者;兼容性答案应该在用户决定安装的地方(README)和工具可读的地方(package.json)。

## Consequences

- 判定会过期:每次官方发版都可能把 ⚠️ 变成 ✅,AGENTS.md 规则把这项复查指派给跟版工作流,而不是靠记忆。
- `minHost` 是下界而非测试矩阵:它记录运行时面已知存在的最老宿主线,由 tarball 检查验证,而非逐个跑老宿主。
