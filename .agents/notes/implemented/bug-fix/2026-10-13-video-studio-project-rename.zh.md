# Agent Note: 工程卡在「未命名工程」——空名称被静默接受，且面板没有任何改名入口

Status: implemented

## Problem

从剪辑面板新建工程时可能静默得到一个名叫「未命名工程」的工程，而且永远改不了名。三个缺陷叠加：

1. NewProject 表单允许名称为空时提交（`service.ts` 随后兜底为「未命名工程」）。名称框的占位符是一个看起来很具体的建议名（`#23 · 这期聊了什么`），读起来像已填写的内容，于是点「创建」——或在「新节目」名称框里按 Enter（会隐式提交整个表单）——都会创建出无名工程。
2. `VideoStudioService.renameProject` 存在但无人调用：没有 `@Remote` 动词、没有面板契约条目、没有 UI——名字起错了就是永久的。
3. 误导性的占位符让 (1) 在创建完成之前无法察觉。

## Decision

- 名称为空时禁用「创建」按钮（`disabled={busy || !name.trim()}`）。禁用表单的提交按钮同时会挡住「新节目」输入框里的 Enter 隐式提交，这条路也再也建不出无名工程。
- `renameProject` 全链路接通：`RenameProjectRequest`（types.ts）、`@Remote('renameProject')`（remote.ts，origin 为 `'user'`，改名会记为 PanelEvent）、面板契约与 face 条目，以及「设置 → 这期」顶部的名称行（一个 `DraftInput`，与「节目」设置里的节目名行同款）。输入为空时保留原名（service 已有的 `name.trim() || p.name`）。
- 名称占位符改为「例：…」/「e.g. …」，不再伪装成已填内容。

## Alternatives considered

- **按节目自动起名**（名称为空时给「读书会 #N」）：凭空发明用户没要求的期号，而且仍然掩盖空名称的失误；对一个同时充当导出文件名的字段来说，必填更诚实。
- **点标题改名**（PanelHeader 标题可直接编辑）：kit 的 `PanelHeader` 渲染的是纯 `<strong>`；为它加编辑模式是为一个面板改动整个 kit。设置行复用了现成的 DraftInput 模式，且紧挨用户已经熟悉的节目名行。
- **保持创建宽松、只靠改名补救**：改名解决的是事后，不是意外本身；必填名称把整个问题类挡在门外。

## Consequences

- 面板再也建不出空名工程（service 的「未命名工程」兜底仍留给工具面）。
- 每个工程现在都能在「设置 → 这期」改名；改名会记为 PanelEvent，模型下次读取时能看到。
- `deleteProject` 同样只在宿主侧可达（Remote 动词存在，面板契约/UI 没有）——维持现状；它不属于本次事故。

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build && pnpm --filter @khorsheed/dsh-video-studio test` 全绿（build 会重新生成客户端 face 消费的 typert Remote 类型）。
