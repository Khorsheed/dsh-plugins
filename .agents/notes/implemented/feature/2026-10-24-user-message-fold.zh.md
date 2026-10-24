# Agent Note: 所有会话里的长用户消息都会折叠

Status: implemented

[English](2026-10-24-user-message-fold.md) | 中文

## Problem

贴进对话的一大段需求会一直以完整高度留在记录里，往回翻的时候很费劲。房间刚给成员发言加了折叠（[2026-10-24-speech-fold-policy](2026-10-24-speech-fold-policy.zh.md)），负责人希望所有会话里人自己发的消息也这样。

## Decision

message-tools 本来就接管了用户消息气泡（`UserMessageView`，key `user` / `steering`，以及它自己的「已编辑」「已恢复」行），所以折叠放在这里，不放在宿主或房间插件里。

- 超过 600 字或 12 行的消息折叠成约十行。钳制高度跟随正文字号设置，尾部是一层用气泡自身底色的渐隐。气泡下方是「展开全部 / 收起」，点渐隐处也能展开。
- 会话里最新的一条用户消息保持展开，刚发出去的内容在回答过程中仍然看得清；等下一条发出后它再折起。「最新一条」由 `selectNewestUserSeq` 从聊天快照里读出。
- 人自己点的展开 / 收起优先于默认值，按消息 seq 记在浏览器存储里（`dsh-message-tools:fold:<sessionId>`，只保留最新 200 条）。存储读不到时按默认规则。

## Alternatives considered

**替换宿主 `conversation.user.text.node` 的 `text` 渲染。** 否决：它只拿到一段行内文本而不是整个气泡，而且同一个渲染也用在队列预览和输入框的 chip 里。

**只在房间里折叠。** 负责人否决：长消息在所有会话里都是问题。

## Consequences

- 只有 message-tools 画的气泡会折叠；没装 message-tools 的组合仍显示宿主原来的气泡。
- `user-message-view.client.spec.tsx` 里的测试覆盖了最新、较早、短消息三种默认状态，以及记住的选择和点渐隐展开。
