# Agent Note: Room 邀请弹窗换装官方设计 token

Status: implemented

[English](2026-09-10-room-invite-dialog-official-tokens.md) | 中文

## 问题

用户对 room「邀请成员」弹窗的反馈：设计观感偏离官方——浅蓝实心提交按钮（`--dsw-alias-bg-accent` 加静态 `#3370ff` 回退，官方主题根本没有定义这个 token）、每个输入框的蓝色 focus 描边、预览卡里的浅蓝哈希头像方块；而官方 Agent Teams 界面是克制的黑白灰阶，层级靠字重与间距而非色块。

## 决定

只重做弹窗外观（不动行为、DOM 结构与文案），全部改用官方 token，取自宿主源码：`packages/client/ui-theme/src/styles/design-platform.css`（`--dsw-alias-*` 定义）、`packages/client/ui-primitives/src/Button.module.css`（primary = `button-primary-fill` + `label-primary-foreground`，hover = `button-primary-hover`，胶囊几何；Cancel = 描边 outline）、`packages/client/ui-primitives/src/Modal.module.css`（标题 16/24 字重 500、24px 内容节奏）、`packages/client/ui-message-feedback/src/client/FeedbackDialog.module.css`（中性 focus 环、caption 占位色、18px 弹窗圆角）。具体落在 `packages/room/src/client/InviteDialog.module.css`：提交按钮是唯一的实心动作——`button-primary-fill` 即 brand-primary（亮色主题 neutral-bluish-1000，暗色 neutral-bluish-50），暗色主题自动反转为近白；取消按钮是透明底 `border-l3` 描边；输入框 focus 改为 FeedbackDialog 的中性环（`border-l4` + 1px 光晕），不再用 accent；占位文字降为 `label-caption`；字段标签对齐官方面板小节标题（12px / 500 / secondary，即 client-ui-agent-team `TeamAction` 的 h3）；高级设置摘要收敛为 12px tertiary；错误行改用真实存在的 `state-error-primary` 别名。弹窗预览的头像方块保持中性：`MemberCard` 在预览模式不再内联 `--member-color`，方块回退色改为 tertiary 墨色——名字哈希调色板仍然只在已入座成员出现的各处承担身份色。

## 否决的备选

**用静态 hex 重配色。** 否决：重点就是跟随主题——别名 token 免费翻转暗色，硬编码近黑在暗色面上会刺眼。

**预览头像保留名字哈希色。** 按用户要求否决（弹窗内中性头像）；预览仍是忠实的版式/身份预览，只有方块色调与入座后的卡片不同。

**采用官方 Modal 遮罩（变暗 + 模糊的 overlay）。** 否决：透明 overlay 是既有的刻意决定（对话在弹窗后保持可读），样式表头注释已重申；本次改的是色调，不是遮罩行为。

## 后果

弹窗在两个主题下都落在官方黑白灰阶上，零主题分支代码，弹窗内不再出现 accent 蓝。测试：`tests/invite-dialog-style.spec.ts` 钉住主按钮 token 三件套与 accent token 的缺席；`tests/members.client.spec.tsx` 改为断言预览方块不带内联 `--member-color`（中性），并断言提交按钮保留 `primary` 类名钩子。名册/speech/composer 的 member-color 身份色体系不受影响，locale 文案与 README 对弹窗的功能性描述均未改。
