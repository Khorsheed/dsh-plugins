# Agent Note：分类归每块画布自己所有

Status: implemented

## Problem

`proposals/active/2026-09-16-canvas-space.md` §11.4 的阶段 ⑤，和那份已经过审的面板原型，要的是同一件事：五种卡不再是一套必须照收的封闭枚举，而变成每块画布可以自己改名、自己加、自己停用的一个列表。改之前，这五种同时住在三个地方——`src/types.ts` 里的 `BoardCardKind` 联合类型、`src/tools.ts` 里编译期写死的 `kind` enum，和 `BoardView.tsx` 里硬编码的 chip 条——所以"加一个分类"意味着同时动存储格式、模型契约和 UI，而这三处任何一处都可能被落下。

提案在这一轮之前就把治理问题定了：**每块画布存自己那一份**（§11.8 规则 ①），这也是为什么目录不是全局一张表。一块画布是一个主题，适合「为什么人们不愿表达异议」的那几类，放到一块产品评估画布上就不合适；全局目录会让每块板的 chip 条都变成一个折中，而且一次改名要横扫所有画布。

三条约束让这件事不只是一个设置面板：

- 一张卡必须在它的分类被停掉之后还活着。停用分类得是可逆动作；另一种做法——把每张卡的行一起丢掉——是躲在 UI 手势后面的数据丢失。
- 模型仍然必须能说清它指的是哪一类。每次 `canvas_propose_card` 都带着一个板子得认的 `kind`，所以 enum 和目录不许漂移。
- 磁盘上已有的那几十块画布根本没有 `categories` 这个字段。不管这功能怎么做，它都不能需要一次迁移。

## Decision

- **分类 id 是"有语法的字符串"，不是联合类型。** `CardCategoryId = string`，`isCardCategoryId` 只放行五种内置 id 加 `cat_[a-z0-9]{9,32}`——也就是 `makeBoardId('cat', …)` 造出来的形状。`cat_` 前缀是自定义行永远盖不掉内置行的原因，这点要紧，因为 id 是用来查表的，不是用来拼路径的。只有内置卡才有的行为（问题生命周期、文档标题）继续靠 `isBoardCardKind` 在 `BoardCardKind` 上分支，绝不靠类型判断。
- **目录是板上的一个字段：`{ id, label, order, enabled }[]`。** `label` 为空表示*显示这个内置分类的本地化名字*——而这只对内置分类合法——所以切换宿主语言仍会把「灵感」变成 "Fragment"，直到用户自己写下一个标签把它覆盖掉。自定义行不可能没有名字：读的时候用它的 id 顶上。
- **卡上存 id，所以改名一张卡都不动。** 面板最常做的那个手势之所以免费，就是这一条决定的。它同时也说明标签是个*显示*层的 concern，于是它只活在一个客户端模块里（`src/client/category-label.ts`，名字和内置图标都归它），chip 条、新卡菜单和详情页就不可能各说各话。
- **分类只停用，不删除。** `enabled: false` 把 chip 摘掉、把新卡拒了；已经挂在它下面的卡一张都不动，那一行也仍留着名字。面板把它们单列一节「已停用」，每行带一个「重新启用」。
- **零迁移，靠宽容读。** `normalizeCategories` 不管文件里有什么，都保证三件事：五种内置永远在场、每行按 id 唯一、整体按 `order` 排好。`reconcileCategories` 再把卡仍然指向却缺失的行补回来——手改文件删掉一个自定义行，结果是那一行回来（用自己的 id 当名字、排在最后），而不是那张卡没了；因为 `normalizeCard` 会拒绝 `isCardCategoryId` 不认的 kind，所以能变成孤儿的行只可能是*合法*行。
- **整个面板只有一个动词。** `setCategories` 收下整份想要的目录：改名、新增、停用都是"这就是新的列表"，于是这次写和板上其他写一样带着版本栅栏。`archiveCardIds` 挂在同一个请求上，所以"停用一个还有卡的分类"和"把那些卡归档"是**一次重写**——拆成两次调用的话，第二次可能输掉版本竞争，留下一个已停用的 chip 底下还压着活卡。
- **每张卡的写入都问这块板。** `putCard`、`patchCard`、`proposeCard` 各自在板自己的目录里查这个 kind，行不存在或已停用就拒（`invalid-name`）。光有 `isCardCategoryId` 已经不够，而这条检查正是让模型的入口服从用户入口同一条规则的东西。
- **模型面只有一个底线。** `menuCategoriesOf` 同时是 `kind` enum 和工具描述里那份 `id（名称）` 菜单的唯一来源，两者不可能不一致。side-chat 入口拿到的就是被问的那块画的目录；**主会话**入口仍是编译期那五种，因为它的定义在 boot 时注册、那会儿还没有任何画布被打开——执行时照样接受自定义 id（store 对着聚焦的那块板校验），只是 enum 无法广告一个模型从没被告知的值。
- **模型读到的那个标签，就是它必须发回来的那个 id。** `categoryTagOf` 把没被改过名的内置渲染成**裸 id**（`fragment`），把用户命过名的渲染成 `id（名称）`。这是往返契约：提示词里的卡行、计数行和 `kind` enum 讲的都是 id，用户的话只作为注解搭在上面。

## Alternatives considered

- **一块画布共用的全局目录。** §11.8 已经否掉，这里再确认一次：chip 条是逐主题的工具，而全局改名会扇出到每一块画布的板文件。
- **`categories` 做成全局字段 + 每块画布覆盖。** 拒绝：覆盖层要能用就得再做一个"我改了什么"的面板，而 diff 语义（全局删了但本地还在）恰好落在这个功能简洁性所在的地方。
- **把 label 存到卡上，让卡改名后仍显示旧名。** 拒绝：改名就变成批量重写每张卡（用户绝不该为一次改名付这笔钱），而且两张同类的卡可以永远拼成两种写法。
- **删除分类，把它的卡改投到一个选定的去处。** 带着最强的理由拒绝：去处选择器要求用户在"我只是想把一个 chip 藏起来"的那一刻对 N 张卡做推理。停用 + 一次确认什么都不损失，而且可逆；选择条上早就有的「改分类」批量手势才是"这些卡我要留在板上"该去的地方——面板的提示行也刻意这么写了。
- **`BoardCardKind` 继续当存储类型，自定义分类另存一个字段。** 拒绝：每条读路径都要携带两套词汇，而模型的 `kind` 参数反正需要两者的并集。
- **在 `normalizeCategories` 里给补回来的内置 `order: 0`。** 我最初就是这么写的，而且是一个被测试当场抓住的真缺陷：旧文件（完全没有 `categories`）于是按**字母序**排五种——document、fragment、grounding、question、reference——把每一块已有画布的 chip 条悄悄重排了。补回来的内置现在带着它自己的默认槽位，所以空字段读出来与 `defaultCategories()` 完全相等。
- **模型面的标签只用用户的名字（`[灵感]`）。** 这是我这一轮中途引入、并被测试立刻点名的回归：`ask.spec` 期望的是 `[fragment]` 那一行，因为模型必须把 enum 的值发回来。一个线上带不回去的名字不是标签。
- **把改名放进卡的编辑器里**（在这儿改，每张卡跟着显示）——拒绝：改名是目录层的编辑，而目录看得见地方是板面。

## Consequences

- **`card.kind` 在类型层已经是 `string`。** TypeScript 不再禁止拿它和一个非 kind 的字符串比较；唯一的收窄手段是 `isBoardCardKind`。以后任何按分类分叉的新逻辑必须先收窄——这是开放集合的代价，按调用点付一次，而不是按用户付一次。
- **状态文件多了一个字段，而两个方向并不对称。** 0.4.4 的宿主读 0.4.5 的 `canvas.json` 会忽略 `categories`，而它的 `normalizeCard` 会拒绝任何 kind 不在五种里的卡——所以**把一张有自定义分类卡的画布降级，那些卡就会从视图里消失**（文件里还在，升回来就还在）。这里不做任何掩饰，发布顺序因此是：可能被回滚到 0.4.4 的实例，不要放带自定义分类的画布。
- **停用确认是 `BoardView` 里唯一的 `Modal`。** 刻意用宿主 modal 而不是行内一段话：这个动作会把内容挪出视线，而 §10.7 那句原话（正文保留、随时恢复）应该出现在用户注意力所在的地方。
- **停用一个持有卡的分类会把那些卡归档——批量勾选里也会把它们摘掉。** `CanvasTab` 的 `setCategories` 会把这次归档的 id 从选择集里过滤掉，否则选择条会继续对刚离开板面的卡提供透镜动作。
- **改分类的扇出是刻意串行的。** `refileSelected` 一张卡一次 `await patchCard`，因为每次写都拿着上一次返回的 token；并行扇出会从第二次起全部输给自己的版本栅栏。
- **`categoryLabelMap` 先用 `defaultCategories()` 打底，再叠板上的行**，所以一个从没走过 `normalizeBoard` 的板对象（客户端 fixture、手搓的 Remote 载荷）仍然把 `fragment` 显示成「灵感」而不是裸 id。目录是权威，默认值是地板。
- **新增 22 对 zh/en 文案**（`cat.*`、`board.refile*`、`board.manageCats`、`confirm.retire*`、`toast.catsSaved`、`toast.cardsMoved`），`kind` 那五个标签保持改名那条 note 放好的位置不动。
- **两份 README 刻意把新规则说两遍**——一次在卡种列表（起点，不是上限），一次在目录那条——因为读者需要的那句话是"卡上存的是 id，所以改名不动任何一张卡"。
- **§11.8 仍未裁决**：工具 enum 是否该跨画布取并集（不该——本 note 的 `menuCategoriesOf` 逐画布），以及属于阶段 ⑥ 的顺线扩一圈 / 连线视图那几个问题。⑥ 同日落地（[连线视图是一块画布的第二张面，手写](2026-09-23-canvas-link-view.md)），那里仍未裁的几条现在记在 §11.8 ⑦–⑨。

## Testing

- `pnpm --filter @khorsheed/dsh-canvas build` 后 `pnpm run typecheck`——canvas 包干净。`packages/local-agent-dsh` 在 HEAD 上 typecheck 失败（`src/live-driver.ts` 三个 `TS18048: 'streaming' is possibly 'undefined'`）；那是另一个包已提交的状态，本轮未碰。
- `pnpm --filter @khorsheed/dsh-canvas test`——**19 文件 / 319 全绿**（本轮之前 289）。
- `tests/categories.spec.ts`（新，23 个）：id 语法（`cat_` 的长度、大小写、后缀、伪装成路径串的字符串）；`sanitizeCategoryLabel` 的空白与控制符折叠、截断上限、空→undefined；`normalizeCategories` 对 `[undefined, null, 'nope', {}, [], 垃圾]` 读回来与 `defaultCategories()` 完全相等；内置补位的顺序；按 id 先到先得的去重；自定义行的 id 当标签与标签截断；`reconcileCategories` 的无变化恒等、追加孤儿、忽略非法 kind；`setCategories` 补回内置并在同一次重写里归档（包括留在板上的那张 `proposed` 卡**不**被计成 rejected）；`putCard` / `patchCard` / `proposeCard` 对停用与未知 kind 的拒绝；改分类把问题生命周期带进带出；一份 ⑤ 之前的文件（从真实序列化板上删掉 `categories` 键）读成默认目录；被手删的行在读时补回、而文件本身保持不动（读从不重写）；`categoryTagOf` / `categoryMenuOf` 的形态；计数行与卡行拼同一个 token；grounding 护栏按改名后的行来称呼它；以及 side-chat 工具的 `properties.kind.enum` 连同描述里的那份菜单，全部落在"全停用"这块地板上。
- `tests/tab.client.spec.tsx`（+7 个）：一个 chip 筛出它自己的卡、已停用的标签进不了 chip 条；改名是一次只带标签的 `setCategories`（不动卡，`archiveCardIds` 缺席）；新分类造出一个排在最后的 `cat_…` id 并清空输入框；空行停用不问、持有卡的行只问一次（取消不写任何东西）、确认时 `archiveCardIds` 挂在同一个请求上；已停用的行回来时不擅自把归档的卡放回来；「改分类」把选择自带的那个分类藏起来、其余可投；以及新卡菜单给的就是这块板的启用集合。
- 对暂存集跑 `pnpm run check:hygiene`，并用 `pnpm exec tsx scripts/verify-translation-pairing.mts --write` 记录本 note 自己这一对。
