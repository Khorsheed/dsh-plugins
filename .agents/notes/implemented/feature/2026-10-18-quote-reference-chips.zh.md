# Agent Note: quote reference chips and the after-send quote card

Status: implemented

[English](2026-10-18-quote-reference-chips.md) | 中文

## Problem

「引用到当前会话」此前把引用作为原始 `> ` markdown 文本插进 composer 草稿。三个缺陷：composer 显示的是朴素前缀文本，而宿主的 composer 是带行内引用 chip 的结构化编辑器；发出的用户消息保留原始 wire 文本（用户消息走规则扫描渲染，不走 markdown）；插入所用的 `setDraft(string)` 契约会抹掉草稿里已有的引用 chip。在房间里该动作还看似无效——那一半由[房间作曲器机器草稿笔记](../architecture/2026-10-18-room-composer-machine-draft.md)承载。

## Decision

**在宿主支持处，composer 插入是结构化引用 chip。** 客户端向探测到的 `ctx.inputTriggers` 服务注册一个无头触发源——`candidates` 永不出行，源存在的唯一意义是携带 `quote` 引用 codec（`src/client/reference.ts`）。插入本身走作用域 `slash/input-insert-reference` bail 事件，落在草稿末尾 span：坐标按 detect 投影计算（每个已有 chip 折叠为一个 U+FFFC：`end = draft.length − Σ(occurrence.length − 1)`），由草稿修订号 CAS 保护并带一次重读快照的重试。chip 的 `ref` 是单行 JSON，携带完整剪贴板文本——包括非空白草稿的空行分隔符，删除 chip 即连它一起删——codec 的 `serialize`/`clipboardText` 解码同一份载荷，模型逐字收到用户在 composer 看到的文本。ref 损坏时拒绝发送（宿主的设计表面），绝不静默降级。

**降级阶梯，探测先行**：无 `inputTriggers` 服务 → 纯文本；bail 两度被拒（旧宿主无监听、相位锁定、CAS 竞争落败）→ 退回 chip 之前的 `mergedQuoteDraft` + `setDraft` 合并。`minHost` 不动。

**发出后，引用渲染为卡片。** `quote-block` 用户文本规则（`src/client/usertext.ts`，order 20——没有官方规则在 `>` 起点竞争）匹配行首锚定的 `> ` 行串加任一语言的署名行；keyed `conversation.user.text.node` 渲染器（`QuoteTextNode`）渲染为行内合法的卡片（block 呈现的 span）：去掉 wire 前缀的正文，外加按当前语言重渲染的来源行。宿主没有 userText 缝时消息保持原始 wire 文本。

**房间不需要 quote 侧任何代码。** 房间作曲器的草稿一旦挂在官方输入机上，两条插入路径（chip 与纯文本）在房间里原样生效；chip 在房间的纯 textarea 里投影为其剪贴板文本，编辑即摊平——房间侧被接受的降级。

## Alternatives considered

- **composer 上方的 dock 样式卡片**（`conversation.input.dock`，QueueDock/GoalBar 的座位）：否决——宿主没有提交变换缝，dock 持有的内容无法进入发出的消息；卡片要么与草稿文本双重展示，要么永远到不了模型。
- **composer 附件轨**（`conversation.input.attachments`）：否决——没有任何公开面对插件可写（附件 id 由包内私有的 controller 铸造）。
- **只做纯文本、保持 v1**：否决——chip 与 user-text 缝是官方且已发布的；回退路径让旧宿主完整，richer 路径对它们零代价。
- **`roomComposer` 服务由 quote 探测**（房间原方案）：否决——被"房间作曲器草稿挂官方机器"取代，后者一次修好三个房间缺陷，见链接笔记。
- **更丰富的仅模型侧序列化**（如 XML 包裹引用）：否决——模型文本必须等于可见文本；卡片是呈现层的事。

## Consequences

- 引用在每个阶段都是结构化的：composer 里是行内 chip，消息流里是样式卡片，模型线上仍是不变的 `> ` 引用块。
- 新增的已文档化边界：卸载后草稿里残留的 chip 会阻塞该草稿的发送（codec 缺席——宿主拒绝而非降级；删掉 chip 即恢复）；房间 textarea 编辑即摊平 chip。
- chip 路径从不调用 `setDraft`，插入引用不再抹掉草稿已有的 chip；纯文本回退保留其（抹除式）旧语义，只在无 chip 或缝被拒处可达。
- 测试：`reference.spec.ts` 钉住 span 计算、前缀内置于 chip 的规则、CAS 重试与 codec 的拒腐；`usertext.spec.tsx` 钉住双语署名、`from` 契约与卡片渲染。`pnpm --filter @khorsheed/dsh-quote run build && pnpm --filter @khorsheed/dsh-quote test` 全绿（66 个测试）。
