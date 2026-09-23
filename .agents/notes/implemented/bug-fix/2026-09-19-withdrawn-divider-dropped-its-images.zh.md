# Agent Note: 撤回分隔线把它刚藏起来的图片弄丢了

Status: implemented

## Problem

两条关于"撤回一条带图片的消息"的报告，成因是同一个 fold。

**展开回放里图片不见了。** 展开「已撤回 N 条消息」能看到被撤回的用户原文和助手文本，但和它们一起被撤回的图片从来没有出现过。`collectWithdrawnEntries`（展开区背后的节点存储 fold）只 join `type: 'text'` 块，并且只在 join 出的文本非空时入条目，于是 `type: 'image'` 块对它完全不可见。

**纯图片消息被读成空区间。** 既没有文本、也没有被识别的内容，一条纯图片消息产生 *零* 个条目。分隔线标题是 `countHiddenInSpan`，而它的定义就是 `collectWithdrawnEntries(...).length`，于是撤回一条纯图片消息会渲染出「已撤回 0 条消息」——展开后显示「撤回的内容不在当前已加载的历史中」，那句本来只留给行已掉出加载窗口的区间。两句话都不成立：这条消息是加载着的，一秒前还在屏幕上，然后才被隐藏。

这个不对称正是它是 fold 缺陷而不是能力缺失的原因：被遮蔽的用户渲染器本来就在实时 surface 上渲染被撤回消息的图片，恢复路径也本来就重放它们（编辑或恢复替换逐字携带 `content`，`type: 'image'` 块随之同行）。只有分隔线的只读回放——被撤回消息离开 surface **之后**唯一展示它的地方——把图片丢了。

## Decision

**回放携带撤回所隐藏的内容。** `WithdrawnEntry` 新增 `images`，承载附件画廊 `MessageImageSource` 的持久引用那一支。`collectWithdrawnEntries` 从 user、steering、edited、restored 节点中折出带 attachment 的 `type: 'image'` 块，并在条目有文本**或**有图片时保留它。

**计数跟随回放。** `countHiddenInSpan` 仍然是 `collectWithdrawnEntries(...).length`；修好 fold 就修好了数字，所以纯图片消息算一条消息，空态文案重新只留给真正未加载的区间。刻意不做第二个独立的节点计数：两份 fold 会漂移，而"回放展示了几条消息"才是这个数字诚实的定义。

**图片走宿主自己的画廊槽位。** 分隔线渲染器接收每个 `conversation.chat.node` 渲染器本就拿到的 `renderMessageImages` owner prop，用 `{ images, align: 'end' }` 调用，于是回放里的图片与转录里的图片是同一个组件（尺寸、预览、查看器）。使用前把该 prop 放宽为 `| undefined`，这样没有附件 UI 的组合展开时退化为纯文本回放，而不是抛错。

**助手条目不携带图片。** 回放的词汇仍是"用户原文 + 助手文本"：助手图片块不参与 fold，助手条目的 `WithdrawnEntry.images` 恒为空。

## Alternatives considered

**用直接绑定 `loadImage` 的 `<img>` 逐张渲染。** 否决：这会复制官方画廊——object URL 生命周期、尺寸、点击查看——并在上游改动该槽位的瞬间与消息气泡的表现分叉。每个聊天节点本就收到槽位支撑的闭包，插件不需要自己的 loader。

**让 `countHiddenInSpan` 拥有独立的节点计数 fold。** 否决：计数与回放就会变成"一条被隐藏消息"的两个定义，二者可以互相矛盾——而正是这种状态产出了「已撤回 0 条消息」。缺陷在回放的过滤条件，不在计数的推导方式。

**继续跳过纯图片条目，只单独统计它们的节点。** 否决：它修好了数字，却留下报告里的症状（展开后没东西可看）。

**把助手图片块也折进回放。** 本次改动否决：助手条目按设计是文本摘要（`withdrawn.entryAssistant`），没有任何报告涉及它，且扩大词汇需要另行决定助手图片相对其文本的位置。

**在同一次改动里把被撤回的图片回填到输入框。** 此处否决——那是另一个界面、另一份契约。宿主没有公开的"设置草稿文本 + 图片"API：`SessionInput.setDraft` 只管文本，附件是另一套 id 平面，而唯一把 `File` 铸造成草稿附件的代码是 `ConversationController.createDrafts`，它不在 `ctx.conversation` 所暴露的 `IConversation` 声明面上。因此图片回填意味着通过会话授权的图片 URL 把字节取回来、再作为一次新上传重新登记，并且要调用声明接口之外的方法。这个取舍记进了两份 README 的已知限制；上游问题（暴露铸造入口，或提供一个原子的草稿写入）与本次修复是分开的。

## Consequences

- 撤回一条带图片的消息，现在会在分隔线的展开区展示这些图片，标题也会把纯图片消息计为一条。
- 这些图片就是宿主的画廊组件，观感与行为同转录里的图片一致；没有附件展示槽位的组合退化为改动前的纯文本回放，而不是失败。
- 计数不再是"有文本的条目数"：纯图片消息贡献一个文本为空的条目，渲染器跳过它（不渲染空文本行）。
- 被再次撤回进新区间的恢复行也会重放它们的图片，因为 fold 读取的是恢复事件重放出来的 `content`。
- 仍然不携带的部分：进入输入框草稿的图片。编辑重发与撤回回填都还是纯文本（README 已知限制）。
- 「撤回的内容不在当前已加载的历史中」这句文案重新名副其实：只在区间没有任何已物化节点时出现。

## Testing

`packages/message-tools` 共 186 个测试（新增或更新 5 个）：

- `tests/withdrawn-node.client.spec.ts`：每个条目都携带 `images`；图文混排消息两者都保留；纯图片消息产出一个条目，且 `countHiddenInSpan` 从 0 变成 1；被再次撤回的恢复行会从它重放的 `content` 里重放图片；只有 reasoning 的助手步骤仍然计数且不携带图片。
- `tests/divider-restored.client.spec.tsx`：展开时以 `{ images, align: 'end' }` 调用 `renderMessageImages` 并渲染出画廊的图片；纯图片区间显示「已撤回 1 条消息」且没有空态文案；画廊 prop 缺席的组合仍然回放文本。

README.md 与 README.en.md 记录了回放的图片内容与纯文本回填的限制。
