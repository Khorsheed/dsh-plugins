# Agent Note: canvas-novel 的三块画布界面（待审条、伏笔台账页、章节阅读页）

Status: implemented

## 问题

引擎、工具和对账闸门都有了，但待审、台账和「✓ 审过」只能走工具。用户要审一章，得让模型列待审、逐条转述、再替他调 `review`。「审过永远最后、由人收章」这条规则在界面上看不见，它要求的人工动作也没有入口。

## 决定

- **canvas-novel 长出浏览器端，但只挂在画布的体裁接缝上**：
  - `canvas.board.strip` 的列表条目（id 为体裁 id）；
  - `canvas.page` 的两个 keyed 页面：`novel:ledger` 和 `novel:chapter`（param 是章号）。
  - 注册都用 `slots.inject(key, () => slots.register(...))`。没有画布就没有 slot，整个客户端什么都不渲染；非长篇小说的画布上条子返回 null。
- **host 侧新增 `novel` Remote**（`NovelRemoteService`）：
  - 读：pending / ledger / chapters / chapter；
  - 写：decidePending / reviewChapter / confirmPlan。
  - 每个动词都委托给 `NovelService`，只补界面要的名字（待审项的 subject、伏笔的每章轨迹、每章待审数），不另立规则。
  - 写动词走调用会话的围栏，和工具一样。
- **画布把 `sessionId` 交给体裁**（`CanvasGenreOwnerProps.sessionId`）。会话里打开的画布才可写；没有 sessionId 的只读画布上，待审只能看，审过按钮禁用并写明原因。
- **「✓ 审过本章」的闸在界面上说清楚**：只有阶段为 extracted 且本章没有待审时才可点，否则旁边写还差什么（没写、没对账、还有 N 条待审、正文丢失、只读）。服务端照旧自己校验。
- **读 hook 的依赖只看 Remote 是否存在**：`ctx.get('remote.novel')` 每次返回新代理，依赖它会无限重读，还会饿死同页的第二个读。

## 考虑过的方案

- **新开一个侧栏 tab 放台账和待审。** 作品的上下文在画布里，另起入口要用户来回切；体裁接缝本来就是给这个用的。
- **待审单独一行常驻。** 没有待审时是噪音，所以只在有待审时出现「待审 N」，点开就地展开。
- **阶段灯第三步叫「对账」。** 和工具名 `novel_extract` 对不上，改叫「抽取」。

## 后果

- 一章的完整流程（看计划 → 读正文 → 处理待审 → 审过）可以全在画布里由人完成，不必让模型转述。
- canvas-novel 现在有 `./client` 和 `dsh.client`，README 里「没有浏览器端」的说法已删掉。
- 老数据里没有 `plantedAt` 的伏笔卡，台账行不显示埋设章，而不是显示「未埋」。
- 客户端测试在 `tests/client.spec.tsx`（jsdom，mock Remote），覆盖条子隐藏、待审手势和审过闸。
