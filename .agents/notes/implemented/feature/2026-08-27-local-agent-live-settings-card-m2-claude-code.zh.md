# Agent Note: local-agent 设置卡片 M2 — claude-code（可热切换的 driver 代 + 每 provider 设置卡片）

Status: implemented

[English](2026-08-27-local-agent-live-settings-card-m2-claude-code.md) | 中文

## Problem

[live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)的 M2 里程碑：把 M1 kimi 样板（[M1 note](2026-08-27-local-agent-live-settings-card-m1.md)）复制到 claude-code provider，让它的 live 模式（`live`、`liveMirrorGranularity`）从「改 YAML 必须重载」变成官方 Plugins → 可配置插件 tab 里的用户级热切偏好。claude 的 live driver 是 stream-json 实时模式（控制协议 interrupt、per-runtime turn 链）而非 kimi 的 ACP 会话，drain 语义落在不同的 runtime 形态上；折叠路径也需要照 kimi 的 `persistIfStandalone` 修法做镜像审计。

## Decision

**host 侧：M1 三层模式逐字复制。** `packages/local-agent-claude-code/src/index.ts` 注册 settings 命名空间 `local-agent-claude-code`（schema 与 kimi 相同），Cordis config 作 composition `base`；新文件 `src/live-switch.ts`（`LiveDriverSwitch`）watch scope、把解析值镜像成 driver 代。claude 与 kimi 的唯一结构差异：一代 driver 的 config 还带 Cordis 专属字段 `permissionMode` 与 `baseUrl`，所以 switch 构造函数收一个 `driverBase`（`Pick<Config, 'permissionMode' | 'baseUrl'> & { liveIdleMs? }`），每一代都继承。

**stream-json driver 上的 drain 三件套。** `ClaudeLiveDriver` 长出 `draining` + `drain()`、`hasRuntime(key)`、`setLiveMirrorGranularity()`，两处「拒新轮」检查在 `startRound`（链接之前，exec 回退不会排在 in-flight 后面）与 `startRoundLocked`（先链接后 drain 的出队竞态）。M1 note 的警告——轮次在 `startRound` 同步链接，drain 快照看得到每一轮已接受的轮——对 claude 同构的 `roundChains` 同样成立；拒新点之外还有 per-runtime turn 链，但轮级链才是闸门。

**provider 每成员解析器。** `ClaudeCliProvider` 现在接受 driver 或解析器 `(childSessionId) => driver | undefined`（向后兼容，同 kimi），在 fresh 与 resume 两个调用点逐轮解析。

**镜像审计：折叠路径确有全量 append——照 kimi 修法改。** `claude-cli-provider.ts` 的 `createClaudeLiveMirror`（exec 路径的实时折叠）与 `appendClaudeResponse`（settle 镜像）都以全量事件列表调用 `sessionPersistence.append(childSession.id, childSession.events)`。两处都改走从 kimi `session-mirror.ts` 复制并导出的 `persistIfStandalone`（live 会话的 write-behind 管道已自行持久化；全量 append 违反 store 的连续 seq 契约）。live driver 自己的 `persist()` 也有同样的全量 append，一并修复——此前是生产上的静默空操作（错误被 `persistQueue` 吞掉），现在 live 会话直接跳过。live driver 轮开始自写 `user/message`（M1 的流式顺序修复）已存在（live-driver.ts 的轮边界处）——确认，未改动。token 粒度的流/折叠重复渲染明确不在本期范围。

**client 侧：kimi 卡片照抄。** 包长出浏览器半：`settings.plugin.item` 卡片，key 为 `local-agent-claude-code`（`src/client/`——index、SettingsCard.tsx + module.css、locales.ts），家族 core 的共享 `ProviderAuthBlock` 以 `harness={{ id: 'claude-code', label: 'Claude Code' }}` 嵌入，live 区块（开关、粒度单选、覆盖徽标 + 恢复默认）、ⓘ 悬浮说明、gateway 惰性读取。认证区块是纯 UI 复用——host 侧鉴权/凭证/登录代码一行未碰（红线）；claude 的手动接管登录（pty + 粘贴授权码）由区块现成能力位自然呈现。`dsh.client`、`./client` export、`clientBundle('@khorsheed/dsh-local-agent-claude-code', ...)`、tsconfig host/client 拆分、`src/css-modules.d.ts` 补全保持身份三角的 client 面。

## Alternatives considered

- **live driver 的 `persist()` 保留全量 append**（对 M2 镜像审计范围的最窄解读）——否决：那是同一个 kimi 根因（连续 seq 违反），该 append 对 live 会话永远不可能成功，且修复只是复用审计已要求的 helper 一行；报告里把它标为超出枚举折叠路径的唯一扩展。
- **claude 专属的、基于 runtime turn 链而非轮链的 drain**——否决：kimi 的轮链快照是已验证语义，claude 的 `roundChains` 有同样的同步链接性质，另搞一套会让四家样板漂移。
- **claude 授权上游未通就不做卡片的认证区块**——否决：区块按设计经 status 能力位降级呈现，提案豁免的是 claude 的真机验收，不是豁免发卡片。

## Consequences

- claude-code 包现在有了 client 面与 kimi 同款的 host/client tsconfig 拆分；`inject` 加了 `'settings'`，没有 settings 服务的宿主不再能启动本插件（同 M1 的取舍——官方宿主都有）。
- M2 剩余复制（codex、dsh）现在有两种 driver-config 形态样板：kimi（仅粒度）与 claude（经 `driverBase` 带 Cordis 专属字段）。
- `persistIfStandalone` 修复改变了 exec 路径镜像的生产持久化行为：live 会话不再看到（此前永远失败的）全量 append；独立会话（测试、临时镜像）保留。

## Testing

- `apply.spec.ts` 照 kimi 围绕假 settings 服务重写（命名空间注册、base 携带 YAML 载荷、off/on/热切/粒度同代），同时保留原有 pty 登录的 harness 断言。
- `live-driver.spec.ts` +6：drain 立即拒新轮、in-flight 轮跑完再回收、先链接的轮出队落入拒绝、粒度切换不重建、解析器门控回退 exec、解析器向后兼容——复用既有 FakeClaude 夹具。
- client：`settings-card.client.spec.tsx`（9：三态渲染、scope 写入、徽标出现/消失、恢复默认、unavailable 禁用控件、卡内登录流程断言 `/claude-code login`）与 `locales.client.spec.ts`（en/zh 键对齐）。合计 83 绿（host 72 + client 11）。
- `pnpm --filter @khorsheed/dsh-local-agent-claude-code build` 绿；`check:plugins` 0 发现；`check:hygiene --all` 0 发现。
- 真机验收：按提案豁免（claude-code 授权上游当前未通；M2 验收由 kimi + codex 承担）。

## Cross-references

- [live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)——本 note 实现的里程碑计划（M2 的 claude-code 半）。
- [M1 kimi 样板 note](2026-08-27-local-agent-live-settings-card-m1.md)——本 note 复制的模式。
- [live driver 提案](../../../proposals/closed/2026-08-20-local-agent-live-driver.md)——本 switch 热切换的 claude stream-json driver。
