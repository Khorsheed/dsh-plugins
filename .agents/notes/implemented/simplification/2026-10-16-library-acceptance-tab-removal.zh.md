# Agent Note: 图书馆 —— 练习站的验收 tab 移除；章节考就是考题

Status: implemented

## Problem

练习站的章节考 tab 渲染的是一张验收单——逐条验收标准带判分标记、机检行的引用链接、验收记录——外加一个「提交验收 → 带进会话」按钮，把一张预填的验收表填进会话输入框。从学习者一侧看：门槛 tab 是考题所在的地方（章节考就是考题）；把验收单贴进聊天框的表单，只是把教练自己的评判流程搭了个脚手架，不是学习者的界面——证据的出示和逐条的评判本来就发生在会话里。这张单子把同一流程在 UI 里复制了一遍。

## Decision

客户端的验收单整体移除：练习站不再有 `acceptance` tab（`LibraryNodeTab` 去掉该成员），删掉 AcceptanceTab 组件、提交用的 prime（`prime.accept`）、仅该单使用的文案键（`accept.title/station/passRule/hint/machine/submit/submitHint/history`）和 CSS（`acceptList/acceptItem/acceptMark/acceptText`）。练习站的页面保留 导读 / 我的记录 / 讲义。

数据模型不变：练习站仍带验收标准（行 id 与机检引用都在内——[rubric note](../feature/2026-10-16-library-rubric-ref-lines.md) 在 service 侧继续生效），教练仍在会话里用 `library_assess` 逐条判，assess 级联仍按过线比例完成站点。改变的只是验收标准不再有学习者可见的表单：教练要证据时自行引用各行；采用前草稿卡仍显示条数（`accept.meta`）。

## Alternatives considered

- **只留只读验收单（仅删提交按钮）**：否决——没有了提交动作的验收单，就是一个为会话流程设的记分牌；这正是本次移除要避免的半吊子残留 UI。如果采用前确实需要看到验收标准，应作为纯文本放进导读，而不是门槛 tab。
- **练习站没有验收单就自动过站**：否决——验收是教练基于出示证据做出的评判；移除 UI 从未把这个评判挪进客户端。

## Consequences

- 章节考 tab 恰好只在有考题的地方存在：quiz 站。一个名字，一种内容。
- 练习验收完全走会话：学习者失去逐条对错记分牌与验收记录列表；两者仍可从 `library_read · roadmap` 与 attempts 账本算出来，未来若有界面需要可用。
- 交叉引用：取代 [station-notes-and-gate note](../feature/2026-10-15-library-station-notes-and-gate.md) 决策 C 的门槛 tab 一半；收窄 [rubric-ref-lines note](../feature/2026-10-16-library-rubric-ref-lines.md) 的 UI 声明（其 service 侧机检不变）。

## Testing

`pnpm --filter @khorsheed/dsh-library build && test` 全绿（131/131——没有测试引用被移除的界面）；`pnpm check:panels --package packages/library` 无错误。未加新测试：本次移除删除的是一个视图，它门面的验收流程由现有 `service.spec.ts` 练习验收用例覆盖。
