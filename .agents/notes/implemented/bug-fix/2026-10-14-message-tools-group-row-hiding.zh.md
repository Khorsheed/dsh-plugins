# Agent Note: message-tools 连分组容器行一起隐藏，不只是成员行

Status: implemented

## Problem

在 ≥ 0.1.7-alpha.1 的宿主上编辑（或撤回）一条消息后，编辑前的工具调用折叠头（「已调用工具」…）仍然渲染在编辑后气泡的上方——被撤回区间的内容"透了出来"。DOM 隐藏器的规则以每个聊天行的 `data-chat-flow-key` 为目标，而 ChatNodeSeat 盖在该属性上的是节点键。但 0.1.7-alpha.1 的 Definition 自有会话分组（ChatGroupSeat）把一回合的过程行包进一个以分组键盖章的容器：成员规则把分组体里的每一行都藏掉了，容器本身——折叠头——却匹配不到任何规则，留在原地。用户消息仍在隐藏（影子渲染器自己查区间），于是这个泄漏看起来就像"只剩工具行没藏"。

## Decision

规则集现在覆盖分组渲染多出的两种行形状（`packages/client-message-tools/src/client/dom-hider.ts` 的 `hiddenGroupFlowKeys`）：

- **成员节点键全部隐藏的分组，容器一起隐藏。** 成员关系从有类型的公开分组契约读取（`uiConversation.binding(sessionId).snapshot.getSnapshot().views.grouped('chat')`——根条目加逐分组 source），不从 DOM 反推。横跨区间边界的分组为仍可见的成员保留折叠头。
- **被隐藏成员的 groupPart 复合行键（`["<nodeKey>","<part>"]`，如推理窗格）一律追加**，无论其分组整体是否隐藏——ChatNodeSeat 给部分行盖的是这个复合键，纯节点键规则永远够不到它。`'response'` 部分不需要规则：它复用的就是纯节点键。

分组读取器在每次应用规则时现取，并有双重护栏——`views.grouped` 不存在（分组前的宿主）与 binding 读取抛错（未知会话）都降级为纯节点键规则，而那些宿主的未分组行本就由它覆盖。重写签名并入分组键，分组单变的增量也会重写样式表；组装器在发布聊天快照的同一趟里跑分组 Definition，读取时是当前值。

## Alternatives considered

**CSS `:has()` 规则（没有可见成员的分组容器即隐藏）。** 否决："成员被隐藏"本身就由这张样式表表达，`:not(:has([data-chat-flow-key]:not(<全部隐藏键>)))` 要把整份键列表内嵌第二遍，且每次 DOM 变动都对每个分组行重匹配。读 grouped view 的 JS 做法精确、便宜、可单测。

**在会话投影里加一条上游抑制缝。** 组装器刻意不提供（隐藏器的模块注释与 README 都写明）；这里唯一未文档化的表面只是隐藏器本就在探测的 `data-chat-flow-key` 属性，分组契约本身是有类型的公开 API。

## Consequences

- 编辑与撤回区间在 ≥ 0.1.7-alpha.1 宿主上重新连「已调用工具」折叠头一起隐藏；分组前的宿主（minHost 0.1.5-rc.1）行为逐字节不变。
- 部分隐藏的分组保留折叠头；折叠标题的汇总仍可能计入被隐藏成员——属外观层，与宿主自身折叠的取舍一致。
- 测试：`packages/client-message-tools/tests/dom-hider.client.spec.ts` 覆盖纯折叠（全隐藏/部分/空/缺快照的分组、复合部分键）与安装后的隐藏器（写入规则中的分组键、分组前宿主的降级、snapshot 读取抛错）。
