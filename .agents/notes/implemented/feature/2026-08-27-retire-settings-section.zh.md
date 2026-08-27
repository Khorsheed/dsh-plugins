# Agent Note: 撤掉独立设置 section（M3）+ 成员 composer 在 running 翻转时重探

Status: implemented

[English](2026-08-27-retire-settings-section.md) | 中文

## Problem

live 设置卡片提案评审尾巴上的两件事：

1. **M3**：认证与 live 控制都进了各 provider 的 `settings.plugin.item` 卡片后，家族 core 的独立「本地 Agent」设置 section 成了同一状态的第二个家——两个面可能不一致，还多占一个 tab。
2. **体验**：运行中打开的成员会话只显示一次性只读面板，永远不会自己翻成可写的成员输入框——成员 probe 只在挂载时跑一次，而委派记录要等首轮 settle（exec）或握手（live）才落地。重进会话是唯一让成员 UI 出现的办法。

## Decision

- **撤 section**：core client 删除 `settings.section` 注册、`LocalAgentSettingsSection` 组件和 `local-agent.settings.row` / `row-action` 贡献槽（无其他消费者——dsh 已在 M2 迁进自家卡片）。样式文件改名 `ProviderAuthBlock.module.css`（行样式本来就归区块）。根 README + 家族 README（双语）改写为卡片描述；家族截图重拍（四卡 + 卡头状态点）；CHANGELOG 记家族条目。提案已声明的损失保持不变：未安装 provider 的占位行消失，发现职责归 README。
- **running 翻转时重探**：MemberComposer 的 probe 仍是单个 effect，但 `running` 变化时重跑——已解析的成员资格直接跳过。记录恰在 running 翻转时落地（settle/握手），所以打开中的面板现在原地从只读回退翻成可写输入框。membership 用 ref 镜像，effect 依赖保持 `[memberOf, childSessionId, running]`——null 结果不得自我触发。

## Alternatives considered

- **host 侧提前登记**（run 开始先写占位委派记录，成员资格立即成立）——暂不取：`promptMember`/`resolveDelegation` 需要为空句柄窗口加「启动中」错误分支，且运行中输入本来就是禁用的；client 重探零契约变化拿到可见收益。若以后要让标题栏第零秒就显示成员身份，这是后续项。
- **保留 section 作只读摘要**——否决：同一状态的两个面正是漂移之源；卡片是唯一的家。

## Consequences

- 设置里家族只有一个家：插件 → 可配置插件。「本地 Agent」导航项在下次 profile 刷新后消失。
- 成员会话在首轮落地那一刻从「一次性」只读原地翻成成员输入框——不用重进。
- `memberOf` Remote 每个打开的面板每轮最多被调用几次（挂载一次 + 未解析期间每次 running 翻转一次）。

## Testing

- core 160/160：browser-plugin 的 HMR 测试改钉 composer 链注册（原钉 section）；member-composer 规格 +1（null probe → running 翻转 → 不重进即出成员输入框）；section 规格随组件删除，平价测试在 M1 已并入区块规格。
- 全仓 build/test 双 0；`check:plugins` 0 findings。

## Cross-references

- [live 设置卡片提案](../../../proposals/active/2026-08-26-local-agent-live-settings-card.md)——M3/M4。
- [认证状态点](2026-08-27-settings-card-auth-status-dot.md)——本 note 为之撤 section 的卡头工作。
