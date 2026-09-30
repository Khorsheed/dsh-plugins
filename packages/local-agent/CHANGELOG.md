# 变更记录

## 0.2.0-rc.1（2026-09-30）

- **家族折叠：委派工具工厂收进本包**。新增 `./tool-factory` 导出（`mountSubagentDelegationTool` / `subagentToolConfigSchema` / `SubagentToolConfig` / `RESUME_HINT_PREFIX`）——原共享包 `@khorsheed/dsh-local-agent-tool-subagent` 的实现整体迁入，该包随之退役。各 provider 的委派工具改为各自包内的 `./tool` 组合入口（`@khorsheed/dsh-local-agent-kimi/tool` 等），由 agent 预设点名按会话授予，不再挂 profile 根；工具来源标签的 owner 由调用入口传自己包名，工厂不再硬编码。随工厂迁入新增 peer 依赖 `@deepseek-ai/dsh-tools`。

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过（rc.1→rc.2 无触及本家族的宿主变更，逐类清点见 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-27-host-017-rc2-breaking-changes.md)）。README 按仓标准补齐双语。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布（local-agent 家族七包同版首发：core → tool-subagent / dsh-headless → kimi / codex / claude-code / dsh）。
