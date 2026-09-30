# 变更记录

## 0.2.0（2026-09-30）

- **家族折叠：patch 撤掉三条委派工具行**。各 provider 的委派工具改为成员包自己的 `./tool` 组合入口（agent 预设点名授予，dev 预设行 id 不变），不再作为 profile 根行复挂；本 patch 保持成员规范行的逐字并集（核 + 四 provider + 两条官方工具行停用覆盖）。deps-only 依赖只剩 `@khorsheed/dsh-local-agent-dsh-headless`——`@khorsheed/dsh-local-agent-tool-subagent` 随折叠退役并从依赖移除。

## 0.1.2（2026-09-30）

无功能变更。随宿主 0.2.0 兼容波重发：成员包的 `@deepseek-ai/dsh-*` peer 区间已加宽以覆盖宿主 0.2.0，bundle 重写后的成员依赖钉随之指向各成员新版本（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.1.1（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2）。纯组合元包，无自有运行时代码；local-agent 家族七成员随本波同版联动重发至 0.1.0-rc.7（各自的变化见各自 CHANGELOG）。

## 0.1.0（2026-09-26）

首个公开发布。
