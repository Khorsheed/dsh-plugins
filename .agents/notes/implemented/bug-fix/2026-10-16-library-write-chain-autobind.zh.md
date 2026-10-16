# Agent Note: 图书馆 —— 写入落库即绑定会话；书 id 反解项目

Status: implemented

## Problem

一场实盘建项会话（2026-10-16，学习者转述）踩遍了写入链的每条缝：未绑定的 `write·book` 因缺 `project` 被拒，教练只好手动绑定再重发；quiz 站上的 acceptance 被拒时只点名了 goals 一个出口；本来想写到项目的草稿因为教练习惯性传了 `book` 而落到了书上；整条链——建项目 → 带 id 注册书 → 绑定会话 → 起草——顺序敏感，没有任何东西把它串起来。

## Decision

- **写入成功即绑定**（`autoBind`，工具层）：建/改项目、注册书、起草路线、出考卷、上架链接——每一次成功写入都把会话绑到它碰的东西上，条件是会话未绑定、或绑在同一项目且还没绑书（注册书即升级）。绑在别的项目上、或已经绑了书的会话，绝不动。
- **书 id 反解项目**：`projectOf` 回退到 `service.findBookOwner`——只要有了一本书，链上任何调用都不用再拼项目 id。
- **草稿结果报落点**：`write·roadmap` 返回 `scopeNote`，点名落到书的路线还是项目自己的路线——推导出的作用域在结果里确认，而不是留到侧栏里才发现。
- **acceptance 误置的拒收点名两个出口**：`kind: "practice"`（逐行判）还是 `goals`（描述性期望，由测验把关）。

## Alternatives considered

- **未绑定写书时隐式建项目**：否——项目是学习者指名的决定；拒收继续教学，auto-bind 只是让被教的那条路更短。
- **acceptance 到达时把 kind 改写成 practice**：否——意图有歧义（带描述标准的测验站 vs 动手站）；拒收点名两个出口，不替它猜。

## Consequences

- 建项链变成三次调用、零 id 传递：建 → 注册 → 起草。
- `write·binding` / `binding: null` 仍可覆盖；auto-bind 从不覆盖既有绑定（同项目补绑书除外）。

## Testing

tool.spec.ts（+3）：建 → 注册 → 起草零 id 传递、绑定逐级升级；未绑定会话凭书 id 反解项目；acceptance 拒收点名双出口。130/130 绿。
