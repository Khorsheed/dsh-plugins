# Agent Note: 发言块带成员色竖条并可折叠；名册只在变化时随派发携带

Status: implemented

[English](2026-08-30-speech-readability-and-roster-on-change.md) | 中文

本笔记记录 `@khorsheed/dsh-room` 的两处可读性/节流改动：成员发言块的视觉身份，以及派发 prompt 的名册携带规则。

## Problem

成员回复在时间线上是大段无差别的文本：一眼看不出哪段是谁说的，长回复还会淹没消息流。另一方面，每次派发 prompt 都全量携带名册段（带角色的成员名单 + 通知协议），尽管成员自己的会话在上次派发时已经拿到——重复开销，零信息增量。

## Decision

**整条发言块带 2px 成员色竖条。** `RoomSpeechView.tsx` 在根节点设内联 `borderLeft: 2px solid <memberColor(member)>`，并留 8px `padding-left` 间距（样式表注释写明：它是身份色带——"这一整段是某位成员的发言"——不是分隔线）。竖条贯穿身份行、正文与操作行，复用名册和 @ 候选在用的稳定名字哈希色板（`member-color.ts`）。

**超过 600 字符的发言默认折叠。** 用字符数而非渲染行数：阈值稳定、无需布局测量（约 10 行渲染行）。折叠只是视觉钳制（`max-height: 240px; overflow: hidden`），`MarkdownText` 始终完整渲染；底部 48px `linear-gradient` 渐变基于 `--dsw-alias-bg-base`（官方 ConversationRoot.module.css 的 transcript 遮罩形状），展开/收起按钮沿用 `MembersView` 的 expandToggle 样式（业务主色文字按钮；新增 locale key `speech.expand`/`speech.collapse`，中文 展开全部/收起）。

**名册段只在过期时随 prompt 携带。** journal 新增纯函数 `rosterStaleSince(events, cursor)`：成员从未被派发时为 true；或 `room/member-added`/`room/member-removed`、或名册可见的 `room/member-updated`（instructions = 一行角色、rename = 寻址名）的 seq 超过该成员的派发 cursor（`previousCursor`）时为 true。仅含 childSessionId/cwd 的更新名册不可见——委派句柄在首次运行后即入日志，算进去会让每个成员的下一次派发都白带名册。房间目标（goal）从名册段移出，独立成行、每次派发都携带（便宜且给任务定向）；通知照常携带。

## Alternatives considered

- **按渲染行数折叠（测量高度）。** 否决：测量需要布局观察器，还要在缩放/字体变化时重测；字符阈值确定、可在 jsdom 里测，代价是偶尔折了短而宽的、或放了长而窄的文本。
- **把每个 `member-updated` 都算名册过期。** 否决：每个成员首次运行后都会记一条 childSessionId 更新，名册等于每次派发都带，节流失效。
- **goal 继续放在名册段开头。** 否决：名册条件性省略时 goal 会一起消失；goal 便宜且给每次任务定向，值得独立成行、恒携带。

## Consequences

- 183 个测试全绿（此前 176 + 新增 7）：竖条存在与颜色、折叠切换行为、短发言无按钮、`rosterStaleSince` 单测（首次派发、增/删成员、可见与不可见更新、cursor 边界），以及集成测试（首次派发携带名册、无变化省略、成员加入后重新携带、childSessionId 入日志不触发重带；goal 行每次都在）。
- 稳态派发下成员 prompt 省掉整个名册段；任何名册变化后的首次派发会重新带上，成员不会长期按过期名册行动。
- **暴露 link 安装隐患（scratch 已有绕行）：** `link:` 安装的插件把 `@deepseek-ai/dsh-session` 解析到仓库自己的 node_modules 副本，room 对 `KNOWN_SESSION_EVENT_TYPES` 的注册到不了持久化读路径所用的 toolchain 副本——冷 room session 在 link 的开发实例里拒绝加载（`SessionFormatUnsupportedError`），存活会话正常。3199 scratch profile 挂了一个 `room-catalog-shim` bundle（在 `~/code/dsh-scratch-uicheck/`，不在本仓库），按绝对路径 import toolchain 模块并注册词表。生产 3080 也是 `link:` 这些包——冷 room 读取在那里是否同样失败未验证，值得在下次 room 部署前查一下。
- 已在 3199 scratch 实例用手工构造的 room session 验证（两名成员、一条 609 字符发言、一条短发言）：`docs/screenshots/speech-rail-collapsed.png`（竖条 + 折叠 + 渐变 + 展开全部）与 `docs/screenshots/speech-expanded.png`（全文 + 收起）。
