# Agent Note：抓取失败既带原因、也带动作

Status: implemented

## Problem

[抓取状态传播修复](../bug-fix/2026-09-20-reader-fetch-state-propagation.md)让五态药丸诚实了——卡片知道抓取失败了、为什么——但止步于展示：原因住在悬停 tooltip 里，而药丸对一切失败都只有同一个「点一下重试」。按原因分这是错的，而分类的全部意义就在这里：对反爬墙重试是记仇的爬虫（`isRetryablePreviewFailure` 只允许 `unreachable` 自动重试），而对网络闪断的读者只说「失败」不给重试同样是一种谎。[摄入提案](../../../proposals/active/2026-09-20-reader-ingest-capture-documents.md) §3（D5）要的是完整闭环：失败是一等状态，带原因行**和**按原因的动作按钮——外加给未来 capture 包的渲染抓取留槽位。

两个相邻缺口随带修掉：脚本插图提示在已有官方 Sidebar Browser 的宿主上（0.1.6-alpha.2）也只有外部「阅读原文」一条路；添加弹窗的仅链接判定解释了原因却不给手势。

## Decision

一条原则贯穿：**动作属于原因**。记录在案的 `failureCode`——宿主侧分类，唯一推导——选定动作。

- **卡片失败态**（墙上）：原因是药丸旁边一行看得见的文字，不是 tooltip（`previewReason` 本来就把代码变成读者的句子，现在直接渲染出来）。药丸的手势跟着分类走：`unreachable`（或未分类的失败）照旧重试；`blocked` / `login` / `unsupported-type` / `unreadable` 改成在真浏览器里打开，而不是重试；`http` / `empty` / `redirected` 是终局——药丸变成纯指示、没有点击，因为重试、打开、等待都不会改变答案。悬停文案说清是哪一种。
- **添加弹窗的仅链接判定**带上它存下的 URL，对浏览器能解决的原因（反爬、登录墙、不是网页、服务器端读不到）在判定里就地给出「在浏览器打开原文」动作——读者知道**为什么**的那一刻就是能动手的那一刻。`unreachable` 和 `http` 不给动作：再按一次抓取就是重试，句子也是这么说的。
- **「真浏览器」优先指宿主自带的那一个。** `browserTabAvailable()` / `openBrowserTab(url)` 加入面板注入面，在渲染/手势时**现场**探测（`ctx.get('sidebarRightTabs')?.get('browser')`——ui-chat 在 0.1.6-alpha.2 的用法）加导航面，整段包裹，缺会话绑定时也绝不抛。缺席（0.1.5）或被拒 → 同一个位置退回普通外部链接。脚本插图提示也走它。
- **capture 槽位**：脚本插图提示多了一个「渲染抓取」动作，只在 `capture` Remote 探测在场时渲染（`ctx.get('remote.capture')?.render`，结构化探测）。M0 没有这样的包（那是提案的 M1），所以槽位默认不存在；但它背后的流程是完整的——渲染 URL、把返回的 HTML 过**同一道**白名单提取器（捕获标记绝不直接渲染）、存正文——于是 M1 只需要 capture 包自己，reader 侧零返工。

## Alternatives considered

**一个万能重试手势。** 那就是现状，而它按原因是错的：墙永远给同一个回答，自动补抓的策略已经拒绝定时重试它——手动药丸与该策略唱反调，是同一个 bug 穿了层 UI。
**原因留在 tooltip 里。** 提案写得很明白：要悬停才能看到的失败，读起来就是「无缘无故失败」。卡片的文字盒保持定高；原因行住在本来就会折行的药丸行里。
**apply 时探测 Sidebar Browser。** 注册顺序没有保证（reader 的 `apply` 可能先于 ui-sidebar-browser 跑），所以探测是逐渲染的 `ctx.get`——便宜、永远最新，也正是 canvas 和 quote 对 `openTab('sidechat')` 已用的形状。
**摆一个可见但禁用的「渲染抓取」给 M1 打广告。** 不能工作的控件比没有更糟（翻译地球就是这个规矩）；capture Remote 不存在时槽位就不存在。
**capture 流程渲染完再走缝重抓。** 没意义：render 的全部产物就是那份 HTML——直接提取并存储是唯一一次往返，存下之后正文自动骑上所有既有路径（缓存、翻译、引用）。

## Consequences

- 读者看得见的每一种失败现在都回答「我该怎么办」——重试、在浏览器打开、或明确没有动作——而不是只给那个只适合网络情形的手势。
- 五态模型与宿主标注仍是唯一事实源；这里不加状态，只加表面。
- `openBrowserTab` 是仓库结构化 `openTab` 镜像的第三个消费方（canvas、quote 之后）；官方类型化缝到来时三家一起迁移。
- capture 探针按构造今天是死代码——只有挂载 mock Remote 的 spec 会走到它——`@khorsheed/dsh-capture`（M1）挂上命名空间那天它自动变活，reader 不需要为此发版。

## Testing

`packages/dsh-reader`——新用例都先对着改动前的面板红过：

- `tests/ReaderPane.client.spec.tsx`：脚本插图提示在缝探测在场时打开应用内浏览器 tab（文案翻成「在浏览器打开原文」，不碰 `openExternal`），应用内打开被拒时退回外部链接；失败卡片显示原因行，`unreachable` 时重试、`blocked` 时打开浏览器、`http` 时是确定的指示器（没有 role=button）；仅链接添加的判定带浏览器打开动作并用粘贴的 URL 触发；没有 capture Remote 时「渲染抓取」不存在，挂上 mock 后点击即渲染→提取→存正文。
