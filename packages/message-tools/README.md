# dsh-client-message-tools

[English](README.en.md) | 中文

为 dsh Web 界面的用户消息提供编辑、撤回与恢复:每条用户消息都有复制/编辑/撤回操作行。撤回是真撤回——消息及其后内容彻底离开模型上下文,折叠成可展开的分隔线,还能重放回对话末尾——不改动任何核心包。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions1.png" width="480" alt="用户消息上的复制/编辑/撤回操作行">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions2.png" width="480" alt="原位编辑:保存后以新消息重新发送,被编辑消息不再进入模型上下文">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions3.png" width="480" alt="撤回前的确认弹窗,说明影响范围">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions4.png" width="480" alt="撤回后折叠成分隔线,可一键恢复到对话末尾">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/message-actions5.png" width="480" alt="恢复后消息原样回到对话">

## 特性

- **每条用户消息都有操作行**——用户气泡与已吸入轮次的 steering 消息带复制、编辑、撤回操作。
- **就地编辑**——内联编辑框带真实可用的模型 chip;保存后从该处重新生成,已编辑的气泡可再次编辑。
- **真撤回,不是打标记**——消息及其后整个尾部离开模型上下文,折叠为可展开的「已撤回 N 条消息」分隔线。
- **草稿回填**——撤回成功后把原文回填到 composer 草稿,绝不自动发送。
- **恢复到尾部**——「恢复到对话末尾」把用户消息逐字重放、助手文本重放为「已恢复」组;工具调用永不重放。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
```

重启 web 实例后生效;卸载即精确还原之前的组合。

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-message-tools
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅ 完整——基线迁移至 0.1.2-rc.1 API 面（单臂消费 0.1.2 API，0.1.1-rc.2 运行臂已退役），全量构建测试通过；minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）

## 已知限制

- **全区间隐藏依赖一个未文档化的 DOM 属性**——上游若移除它,隐藏退化为仅渲染器层(用户消息仍被隐藏),`console.warn` 一次,绝不报错。
- **编辑仅支持文本**——原消息的图片附件不会带入重发。
- **恢复是尾部重放,不是原位修复**——助手文本以带框架的用户角色消息重放,工具调用/结果永不重放;撤回区间始终留在模型上下文之外,恢复入口只在撤回分隔线上。
- **context 与排队消息不在范围内**——context 消息沿用官方渲染器(无操作行);仍在排队的消息由官方队列条带编辑/移除。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**架构。** 浏览器半部分以官方用户消息渲染器的视觉克隆(`conversation.chat.node` 槽位、key `user` 与 `steering`、priority -1)替换默认渲染并新增操作行,同时注册四个 `ConversationNodeDefinition`:撤回投影为可展开的「已撤回 N 条消息」分隔线(N = 区间隐藏的用户可见消息数),编辑替换投影为带「已编辑」徽标的原位气泡,恢复条目投影为「已恢复」组里的重放行。Host 半部分是 `messageTools` Typert Remote 服务(`withdraw` / `edit` / `restore`);客户端经 `ctx.remote.$mount` 自行挂载生成的 Remote contribution,无需改动任何核心包。

**编辑**即原位替换:host 追加一条 `user/message` replacement,其内容就是编辑后的新文本(区间覆盖目标消息及 surface 尾部——编辑旧消息就是放弃其后的一切),随后经 `agent.followup` 投递一条极简插件来源触发消息启动重新生成。模型上下文里新文本只出现一次;旧内容留在日志里作审计。会话有运行中的轮次时先取消它并等待完全落定——落定指被取消轮次的收尾(工具结果、`turn/end`)全部落盘,而不是 `running` 翻转;等待有界,迟迟不落定的轮次以「编辑失败」拒绝,取消失败则不编辑。支持编辑链:已编辑气泡可再次编辑,目标是上一个 replacement 的 seq。编辑框的模型 chip 与 composer、/model 弹层共享按会话的 `ModelDirectory`(`ctx.get('modelDirectories')`,可选服务)——组合里没有 ui-model-selection 就不渲染 chip——切换经 host 校验后作用于重新生成的轮次。

**撤回**是真撤回,不是打标记:host 追加一条 `user/message` surface replacement(与 compaction 同一机制),区间覆盖目标消息及之后的所有 surface 节点,该区间由此离开 `session.surface`,不再进入模型上下文;与编辑同款的 cancel-and-settle 编排保证流式内容不会落到 replacement 之后。事件为插件来源,`sourceEventSeqs` 引用每一个被遮蔽节点,方法返回前经 `SessionStore.flush` 落盘——它本身就是审计轨迹。不引入新事件类型:harness 之外的类型无法携带 `ignorable: true`,持久化的未知类型会让 session-persistence 重载时拒绝整个日志。撤回成功后把目标原文回填到 composer 草稿(空草稿直接填入、非空换行追加、落 info 提示)——绝不自动发送,失败则不回填;编辑路径不触发回填。

**投影与隐藏。** 插件的 Definition 把 replacement 认领为锚定在其 seq 上的分隔线节点。隐藏分两层:被遮蔽的用户渲染器对区间内用户消息渲染为空;一张动态样式表把 `data-chat-flow-key`(`ChatNodeSeat.tsx`)锚点落在区间内的聊天行一律隐藏,覆盖助手步骤、工具调用、turn 尾部。隐藏器在首个非空规则集探测这个未文档化属性,探测落空进入有界重试(MutationObserver 加截止时限),避免聊天区尚未挂载时误停用;只有窗口耗尽仍探不到行才停用——`console.warn` 一次,退化为仅渲染器隐藏——且 observer 在停用后仍存活,行晚到会重新生效,绝不报错。分隔线可就地展开只读回放撤回区间(用户原文加助手文本,从实时节点存储折叠)并提供「恢复到对话末尾」;行已掉出加载窗口的区间显示「撤回的内容不在当前已加载的历史中」。

**恢复**是整个被撤回区间的尾部重放,不是原位修复:surface 折叠是位置性的——被替换区间只接续成一个节点(`applySurfacePlan`)——区间无法回到模型上下文原位,其模型侧隐藏也永不回退。host 沿撤回 replacement 自身划定的日志区间 `[start, seq)` 把可重放内容按原始顺序逐条追加到尾部:用户消息逐字重放(编辑替换的内容就是最后一次编辑的新文本,恢复时即以此为准),每条助手回复的文本以带框架的插件来源用户消息重放——`assistant/message` 无法携带插件来源,且轨迹不允许在 step 之外追加助手消息,因此角色保真由框架 `(以下是先前被撤回、现随恢复放回的助手回复)` 承担,UI 上不显示该框架。未落成 `assistant/message` 的中断步骤从其 `assistant/chunk` 片段合并重放(只有 reasoning 时保留 reasoning)。工具调用/结果永不重放:配对无法重新进入,副作用不可重放。重放行渲染为「已恢复」组——用户气泡带完整操作行,助手文本走官方 `MarkdownText`——分隔线在存在引用该区间的存活恢复行期间显示「已恢复」徽标;再次撤回这些恢复行会清掉徽标并重新启用恢复操作(恢复事件始终留在日志里)。

**为什么投影层做不到(彻底修复所需的上游 seam)。** 组装器对每个事件运行所有已注册 Definition 的 `match`,没有否决机制(`conversation-assembler.ts:370`),且 `match(event)` 只能读当前事件;被遮蔽事件在日志里仍保持 `surfaceOp: 'append'`(区间元数据只存在于 replacement 自身),因此依然命中各内置 Definition——内置 Definition 排除的是 *replacement* 事件,不是被遮蔽事件。节点的 `visibility` 只能由产出它的 Definition 设置,组装器禁止把已物化节点撤回为 null,节点 key 又与其 Definition 的 kind 绑定——插件既无法翻转也无法冒充官方节点。遮蔽其余 `conversation.chat.node` key 同样行不通:官方组件没有导出,`command`/`turn-tail`/`tool-call` 声明了子槽位而遮蔽无法重复声明(`tool-call` 还持有 key 空间无界的按工具名 keyed 的 `tool.call.toolview` 槽位)。官方 compaction 流水线在设计上就做了同样选择——被替换的区间保留在 transcript 里。

**模型体验。**

- *编辑替换*——模型读到编辑后的文本,原消息之后的内容全部消失;其后跟一条短触发消息(`(用户编辑了上一条消息，请按编辑后的内容重新回答)`)。Token 影响:被遮蔽区间的全部 token 离开后续请求,新增编辑后消息与触发消息。KV Cache:prompt 前缀从编辑点失效。
- *撤回替换*——区间被一条占位消息(`(用户撤回了这条消息及其后的所有内容)`)取代。Token 影响:区间的全部 token 离开,只新增一条短消息。KV Cache:前缀从替换点失效——取舍与 compaction 相同;撤回越早的消息,失效的缓存前缀越多。
- *恢复重放*——区间的可重放内容(用户消息逐字、助手文本带框架)按原始顺序追加到尾部,插件标记并引用原事件;工具调用/结果的 token 不进入。KV Cache:不超出普通尾部追加的范围。

**导出。** `/client` 导出插件本体(`apply`/`inject`)与 `MessageToolsRemote` 类型;host 侧导出 `MessageToolsService` 类,`/types` 子路径提供线上类型。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/message-tools`)。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
