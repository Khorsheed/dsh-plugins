# Agent Note: 成员对话框一致性——claude 推理强度解析修复 + 成员模型目录收窄到短名单

Status: implemented

[English](2026-10-22-member-dialog-consistency.md) | 中文

## 问题

端点源模型目录那一波（[2026-10-22-endpoint-model-catalogs.zh.md](../feature/2026-10-22-endpoint-model-catalogs.zh.md)）上线 3080 后暴露两个回归：

1. **claude 成员的推理强度面板整体禁用**。端点探测（`GET /v1/models`）只读模型条目的顶层 `effort` 字段，而实际供应的形状把它嵌在 `capabilities.effort.<level>.supported`（2026-10-22 对 openproxy 中继实测；官方 API 同形）——目录条目丢失 `reasoning`，面板无档可选。
2. **成员会话的模型对话框与本机委派卡片的「可用模型」短名单不一致**（用户报告）。成员的模型目录是 broker 的扩展视图（端点目录 + settings/cliDefault + 配置发现 + 历史记录），kimi 下甚至把 scoped config.toml 里非本端点服务的表模型（如用户镜像配置里的 fable5）列进候选。

## 决定

- claude-code `endpoint-auth.ts`：`servedEffortsOf` 顶层 `effort` 优先、`capabilities.effort` 兜底，两个形状都认。
- 三个 provider 的 broker 各带同一份 `scopeServedDirectory`（逐包内联，见下）；`modelDirectory`/`followModelDirectory` 按调用面收窄：
  - memberless（卡片添加对话框、邀请 picker）：只留 `source: 'native'` 的端点供给条目——配置/历史附加项不再成为候选；
  - 成员 + 短名单非空：候选即短名单、按名单顺序（名单里端点已不再供应的值保留为裸行，与卡片一致），名单外补成员当前生效模型的裸目——既有绑定不显示空白；
  - 成员 + 短名单为空：保持旧的扩展词表，不变。

## 考虑过而未取

- **`scopeServedDirectory` 折进家族 core**：三个 broker 的副本逐字相同。折进 core（`model-directory.ts`）需要 core 发新版、provider 运行时 import 它——core 当天刚发 rc.3，为一个纯函数当天再发 rc.4 不值得；下波家族发布时折进。
- **邀请 picker（room 的 InviteDialog 读 memberless 目录）也收窄到短名单**：memberless 目录同时喂卡片添加对话框（需要端点全量才能添加），收窄会弄坏添加对话框；邀请 picker 的全量目录噪音（codex 中继 139 个）留作后续（比如给目录面加 curatedOnly 标志）。
- **kimi 常驻成员的 ACP configOptions 目录**：不动——那是该成员运行时的权威答案；收窄只作用于 broker 的目录面。

## 影响

成员会话的模型/推理强度对话框现在与卡片「可用模型」短名单严格一致；claude 成员的推理强度面板恢复为端点供应的档位。无数据迁移；名单外的既有成员绑定继续可用且保持可见。后续：下波家族发布把三份逐字相同的 `scopeServedDirectory` 折进 core；邀请 picker 的目录面可考虑加 `curatedOnly` 标志。

## 验证

- 新增规格：claude model-catalog 的 `capabilities.effort` 嵌套用例；三个 broker 各三个 scoping 用例（memberless 纯端点 / 成员短名单收窄且保留当前绑定 / 无短名单保持旧扩展）。
- kimi 278 / codex 247 / claude-code 262 全绿；openproxy 的 claude 路由 `capabilities.effort` 形状实测（2026-10-22）。
