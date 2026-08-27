# Agent Note: 设置卡片头部认证状态点（一眼看出谁已授权）

Status: implemented

[English](2026-08-27-settings-card-auth-status-dot.md) | 中文

## Problem

每 provider 的设置卡片（live 设置卡片提案 M1/M2）此前只在**展开后**的认证区块里显示凭证状态。四家 provider 想知道"哪家没登录"得逐张点开。用户要求折叠卡头直接带状态点——与家族设置 section 行内同款的红绿灰点。

## Decision

在家族 core 的 client 面做一个小小的认证状态总线，而不是每张卡各自轮询：

- `packages/local-agent/src/client/auth-status.ts`：按 harness id 键控的模块级发布/订阅表。`ProviderAuthBlock` 发布每一次探测结果（挂载刷新、登录轮询命中、登出重探、失败路径）——探测生命周期本来就归它管，不存在第二个轮询者。卡头经 `useHarnessAuthStatus(harnessId, probe)` 读取：`useSyncExternalStore` 订阅 + 仅在总线还没有值时做一次补探（卡头先于认证区块挂载的情形）。`resetAuthStatuses` / `readAuthStatus` 是测试钩子（总线是模块单例）。
- `AuthStatusDot`（core client 导出）：与 section 行内逐字一致的 8px 状态点（绿 = 已认证，红 = 未认证，灰 = 检查中/不可用），aria 标签复用卡片已有的 `authT` 绑定——不新增 locale key。
- 四张 provider 卡（kimi/codex/claude-code/dsh）都在折叠标题旁渲染该点（各卡 css 新增 `.nameRow` 弹性行）。

## Alternatives considered

- **每张卡间隔轮询状态**——否决：四张卡 × 间隔是对 block 已在驱动的 Remote 流量的重复，而且区块内完成登录后圆点仍要滞后一个间隔。总线让 block 的既有探测成为唯一来源，登录/登出瞬间翻转所有在场卡片。
- **把 ProviderAuthBlock 的视图状态整体上提**——否决：区块内部状态（提示、验证码草稿、toast）是交互局部的；值得共享的只有状态类别，而「每 harness 一个字符串」的总线是最小耦合。

## Consequences

- 折叠的插件配置 tab 现在一眼可见各 provider 的授权状态；登录/登出即时翻转，无需展开。
- section（提案 M3 前仍在）同样发布，它的行与卡片永不可能不一致。
- 将来第五张 provider 卡片：渲染 `<AuthStatusDot>` + 一行 hook——发布侧零改动。

## Testing

- core `provider-auth-block.client.spec.tsx` +1：挂载探测落到总线（`readAuthStatus`）。
- kimi `settings-card.client.spec.tsx` +2：折叠卡头圆点分别反映已认证/未认证探测（aria 标签 + `data-auth-status`）；afterEach 里 `resetAuthStatuses()` 防止模块单例跨用例泄漏。
- 套件：local-agent 175/175、kimi 115/115；全仓 build/test 双 0。

## Cross-references

- [live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)——本 note 扩展的卡片（M1/M2）。
