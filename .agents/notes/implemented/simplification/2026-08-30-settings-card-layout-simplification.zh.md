# Agent Note: live 设置卡去掉覆盖徽标行，live 开关并入标签行

Status: implemented

[English](2026-08-30-settings-card-layout-simplification.md) | 中文

## Problem

对 live 设置卡的产品反馈（截图评审）："已覆盖部署默认（yaml：…）"徽标加"恢复默认"按钮对一张只有两个设置项的卡来说过度设计——想回到部署默认，手动拨回开关/单选即可。另外"常驻模式（live）ⓘ"标题行和"启用 + 开关"行浪费一行：开关应该和标签同行，正如下方"输出粒度"行的结构。

## Decision

- **live 开关并入标签行。** 去掉 `blockTitle` 标题行；改为一行 `常驻模式（live）ⓘ + switch`，与输出粒度行同构（标签 + ⓘTooltip + 控件）。switch 的 aria-label 从 `live.enable` 改为 `live.title`。
- **删除覆盖行。** 移除 `overridden`/`baseLayer` helper、`reset`、`yamlParts`、badge/reset JSX、`.overrideRow`/`.badge`/`.reset` 样式，以及 `live.enable`/`live.overridden`/`live.reset` 三个 locale key（zh + en）。三层合并（yaml base ← user 层）本身不变——user 层只是不再自我展示和批量清除。
- 四张 provider 卡（kimi 为模板，复刻到 codex / claude-code / dsh）改动一致；dsh 独立的 `enabled` 主开关 section 不动。

## Alternatives considered

**仅在存在 yaml base 时显示徽标**——否决：产品判断是两个开关不需要来源提示 UI；条件徽标会为一行没人读的文字保留全部代码路径（覆盖检测、reset、locale key）。

**把恢复默认改成图标按钮**——同理否决：手动拨回就是两下点击。

## Consequences

卡体变为两行（live 开关、粒度单选）加认证区块；saved/error/unavailable 提示不变。每包删除两个徽标测试（套件：kimi 120、codex 93、claude-code 87、dsh 88 全绿）。已有 user 层覆盖的用户数据不受影响（数据模型未动）；回到 yaml 值的唯一途径变为手动拨回——这正是本次简化的意图。
