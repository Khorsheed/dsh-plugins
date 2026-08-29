# Agent Note：room invite 校验 provider，失败运行携带原因

Status: implemented

[English](2026-08-19-room-invite-provider-validation.md) | 中文

## 问题

真机报告：主 agent 通过 `room_invite` 邀请成员时传了 `provider: "kimi"`——harness 的*显示名*——而 local-agent 家族注册的委派 provider 名是 `kimi-cli`（local-agent-kimi 记录 harness 名 `kimi` + delegationProvider `kimi-cli`）。invite 当时只校验了非空，错误 provider 落进名册；第一次 @ 派发在委派门面的 `requireProvider` 里抛错，运行 6ms 即 settle 为 `failed`，UI 只显示「kimi 运行失败 · 0.0s」——哪里都没有原因：终态 `room/run-state` 边不携带原因，而客户端那个干巴巴的 `0.0s` 读起来像"什么都没发生"。

## 决策

两层都做，快速失败且带原因：

1. **invite 拒绝未知 provider。** `RoomService.inviteMember`（`invite` Remote 与 `room_invite` 工具共用的入口）现在拿 roster 的 `delegationProvider` 集合校验 provider——复用 `listProviders` 已经在用的探针路径（`probeLocalAgentRoster` → `roster()` + `statusOf`）。不在集合内返回结构化的 `unknown-provider` 失败，error 里携带合法的 `available` 列表；`room_invite` 工具把它渲染成模型可自我纠错的文本（`Unknown delegation provider "kimi" … Available: kimi-cli, codex-cli … Retry`），模型会换名重试。roster 切片缺席的老 core 跳过校验（降级而非爆炸）；facade 缺席仍先走 `local-agent-unavailable`。弹窗从 `listProviders` 选 provider，本来就不会传错——只是为新错误码补了本地化文案。
2. **失败的运行说明原因。** `room/run-state` 的终态 `failed` 边携带可选 `error`（journal replay 容错旧的无 error 事件——字段仅在存在时折叠，`exactOptionalPropertyTypes` 干净）。派发引擎把 catch 到的 fault message（以及 facade 缺席 / room agent 不在线 / 非 completed 的 stopReason 三条路径的显式原因）写进边里；客户端的失败 dim 行显示原因，省略号截断、悬停看全文。100ms 以下的耗时现在渲染为 `<0.1s` 而不是 `0.0s`。

`room_invite` 的工具描述和 `provider` 参数文档把契约写在前面（委派 provider id，如 `kimi-cli`，不是 harness 显示名；不确定时不带 `firstTask` 探一次，从拒绝文本里读合法列表）。

## 考虑过的替代方案

- **只在派发时校验，invite 保持宽松**——否决：这正是所报告的 bug；带着不可派发 provider 的名册条目是写侧不变量破坏，而 invite 是唯一的写入点。
- **roster 切片缺席时也拒绝**——否决：`probeLocalAgentRoster` 返回 undefined 意味着 pre-roster 的 core；在那里拒绝 invite 会破坏原本能工作的组合（降级，不爆炸）。
- **invite 时把显示名解析成委派 provider（接受 `kimi`，存 `kimi-cli`）**——否决：静默改写模型输入会让模型下一次仍然学不会这套词汇；可自我纠错的拒绝才能教会它，且 roster 是"派发能解析什么"的唯一事实源。

## 后果

- wire 词汇：`RoomFailure` 新增 `{ code: 'unknown-provider', provider, available }`；`RoomRunStateEvent` 与 replay 出的 `RoomMemberRun` 新增可选 `error`。两者都经 `./types` 流进生成的 Remote codec；旧 journal 原样 replay。
- 测试：host spec 钉住拒绝路径（含合法列表）、无 roster core 的降级跳过、三条失败路径的 `error` 边、工具的可自纠文本；client spec 钉住原因行与 `<0.1s` 渲染。110 → 117。
