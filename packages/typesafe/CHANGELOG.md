# 变更记录

## 0.1.3（2026-10-22）

- **BREAKING（包结构）**：伴生包 `@khorsheed/dsh-typesafe-tool` 回并进本包——模型工具行改由本包的 `./tool` 子路径导出承载（preset 引 `name: '@khorsheed/dsh-typesafe/tool'`，行 id 仍为 `typesafe-tool`，preset 组合状态不受影响；T88 评测家族折叠、room 0.2.0 / worktrees 0.3.0 同款回并，canvas `./agent` 先例）。迁移：preset 的 `agent.cordis.yml` 里把 `name: '@khorsheed/dsh-typesafe-tool'` 改为 `name: '@khorsheed/dsh-typesafe/tool'`，并卸载旧伴生包（已发布的 0.1.2 npm 名随同一发布波 deprecate）。
- 工具 origin 归因 owner 归一到本包名 `@khorsheed/dsh-typesafe`；skill 注册的 `provider` 同改。
- 工具行源码进 `src/tool.ts`（原跨包结构缝隙改为同包类型直引：核心包的 `QuestionSpec` / `Decision` / `JudgeResult` / `TypeSafeService`），套件进 `tests/tool-row.spec.ts`，`typesafe-decide` skill 进 `skills/`；行为不变。
- 适配宿主 0.2.1 线：peer 区间加宽覆盖 0.2.1；`./tool` 子路径行 locale 重定向到包根，宿主设置清单页显示插件卡片标题而非裸模块名。

## 0.1.2（2026-09-30）

无功能变更。加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.1.1（2026-09-27）

无功能变更。随宿主 0.1.7-rc.2 基线发布波重发（全量构建+测试在 rc.2 基线通过）。伴生工具行 `@khorsheed/dsh-typesafe-tool` 0.1.1 修复 rc.1 挂载顺序下工具行静默惰死（核心服务改声明式 inject，见其 CHANGELOG）。

## 0.1.0（2026-09-26）

首个公开发布。
