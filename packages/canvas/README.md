# @khorsheed/dsh-canvas

[English](README.en.md) | 中文

**灵感画布** —— **右栏里的写作工作台**：右栏一个「画布」tab，普通右栏宽度自调（拖拽把手 + 一次性收会话列表建议）；画布自己带一排标签——一块板、一张卡、一份没存的草稿都在这一排里，点卡是在画布内部开一张标签，不借宿主的 dock。一块画布 = 一个主题 = 部署级实体，上面积累灵感、问题、共识、来源、文档五种卡；模型的提议以幽灵卡落板，你 ✓/✗ 决定它的去留。

**对话双入口**（M2–M3）：**当前会话**——两个画布工具（`canvas_propose_card` / `canvas_comment`）注册到主会话 Agent，你直接让 Agent 改当前打开的画布；**side-chat 插件**——透镜「就此提问」/评论「追问」走第二意见（独立上下文，side-chat 未安装时这些入口全部隐藏、板面完整可用）。文本选区交互由引用插件（@khorsheed/dsh-quote）在应用级统一承接（引用到当前会话 / 引用到侧边对话 / 复制）。

v1 的工作区级灵感稿纸**存储原样保留**（编辑器已退役）——原文件仍在磁盘上，任何编辑器都能打开；v1 五个 Remote 动词在线上不动。

> 路线注记：M1–M2.5 曾走过 main 面板空间路线，已退役——宿主 `RightbarRoot` 只在会话面板渲染右栏，自定义 main 面板让一切右栏承接按构造失效；回到右栏是与宿主布局同构的答案。数据模型、Remote、板面/详情组件、side-chat 集成全部沿用。

## 功能

- **右栏普通宽 + 收列表建议**（M3.1 修正）：打开画布 tab 时每会话一次性建议收起左侧会话列表（DOM 门控，绝不盲 toggle、绝不反复强制）；右栏保持普通 track 模式——拖拽把手可用、宽度你自调、布局有记忆（曾建议 fullscreen，因宿主 fullscreen 隐藏拖拽把手而撤销）。唯一座位 = 右栏页型 tab（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`），天然 session 作用域。
- **一排标签，行尾一个 ＋**（0.4.6，round 3 ⑥）：一行 = 一个打开着的东西——一块画布的板、一张卡、一份没存的草稿。行尾的「＋ 画布」开切换器下拉（活跃画布行 → 已归档井 → 底部「＋ 新画布」内联创建）；板标签下面自己一行顶栏 = 画布名 + 卡数 + ＋新卡菜单 + 挂载工作区 chip + 卡板/连线切换。一排最多 16 行，满了先挤掉一张卡（再点一次就回来），板与草稿不被挤。不再有独立左列导航。
- **部署级存储**：每块画布是 `$DSH_HOME/state/canvas/<canvasId>/` 一个目录——`canvas.json`（元信息 + 全部卡 + 计数），纯文本，任何编辑器都能打开。卸载插件不会删除它。state 目录里遗留的旧 `draft.md` 已成孤儿：既不被读取，也不被删除。
- **五种内置内容卡**（起点，不是上限）：灵感 / 问题（open → exploring → answered 生命周期）/ 共识（用户确认过的共同认识）/ 来源（带出处）/ 文档。五种卡都在详情标签里编辑：「＋新卡」开出一张草稿标签，单行时 ⏎ 直接建卡、换行后 ⌘⏎ 建卡（Shift+⏎ 始终换行），建好即回到它落的那块板；Esc 关掉这张标签（草稿有字或有笔画才弹一次确认）。
- **摘要与详情分工**（M1.5）：板上卡片一律摘要——clamp ~6 行、底部渐隐，长文显示字数标；document 卡用启发式标题（首个 markdown 标题或首行），不再把原文从 `#` 糊上去。多选改由卡片右上角的**悬停勾选框**。
- **详情是这一排里的一行，不是宿主 dock 的标签**（0.4.5 立，0.4.6 收回画布内部）：点卡片正文在这块画布里开一张标签——两张卡两张标签，再点同一张卡只让已有的那行亮起来。去重不需要宿主帮忙：行 id 由「画布 + 卡」推出来，重复点同一个主体就没有第二行。标签里是 kind 图标 + 状态 + 来源 + 时间、**渲染 / 源码 / 并列**三态（`MarkdownText` 全文渲染、v1 编辑器三件套源码编辑、宽度允许时并列）、评论线程（可读可发）、幽灵卡 ✓/✗、附件区（url 链接；文件附件一键调官方文档预览）。板面本身是只读的：想改字只能进详情标签（「＋新卡」的草稿也一样）。行上的 × 是这个包自己画的，所以关掉一张有草稿的行会**先问一次**——0.4.5 记的那个「唯一的缺口」（宿主只按 tab id 关闭、不给拦截，草稿被静默丢掉）随 dock 路线一起没了。
- **详情标签里粘贴 md / html / 表格 / 图片**：全插件只有这里读剪贴板，落法对着「这次粘贴会产出的那张整卡」回答（卡片格式是渲染器从整张卡嗅出来的，从不看标志位）。六条臂——整页 HTML / 表格 / 富文本转 markdown（保格式：只有转换后的文字与剪贴板纯文本逐字对齐才采用，丢字宁可不转）/ 只有标记 / 整页网页进已有正文的卡时落纯文字（说明理由）/ 交回浏览器原生粘贴；贴上来的图片像素进宿主附件库，卡里只留一行指针（markdown 卡收 `![](attachment://…)`，HTML 卡收 `<img src="attachment://…">`），两条渲染臂都把指针换回真图。
- **详情标签自由绘画**：详情标签有一支笔——铅笔在 3:2 的字段上画，橡皮一次擦一整笔（会被擦掉的那一笔在指针下先亮起），同一排还有「撤一笔」和「清空」；Esc 第一下收笔（笔在的时候页面归笔管），再按一下才是关这张标签，⌘⏎ 保存草稿。收笔之后字段留在原地变成只读图形，带「点一下接着画」——画的内容是卡的一部分，不该在停笔时消失。画存的是**点列**（600×400 逻辑框的单位，不是屏幕像素），轮廓每次渲染现算，所以在窄栏里画的位置和宽面板上看到的位置是同一个；一笔落定即写盘（新卡则进草稿），没有「未保存的画」这个状态。板面缩略图显示它，模型的 `<board>` 段带着它的坐标。
- **HTML 卡渲染**（0.4.3）：内容格式与卡种解耦——`detectCardFormat` 保守启发式判定（宁可漏判不可误判：md 里内联 html 仍是 markdown）；HTML 卡在详情标签里以**严格断网沙箱 iframe** 渲染（复用 inline-html-render 的 srcdoc/bridge，源码面打进 bundle、零运行时耦合），板面上显示紧凑占位（`<title>` 提取的标题或「HTML 文档」+ 字数），绝不再把标记原文当纯文本糊上去。卡正文上限 256KB（整板读写仍毫秒级；更大的落 `assets/` 是 M4 项）。**模型边界**：HTML 卡内容不进模型上下文全文——Agent 只看到标题/指针（需要内容时会请你粘贴节选），长 markdown 卡带 4000 字上限与截断注记。
- **聊天集成**（M2，经 side-chat 插件）：选中卡后**透镜条**出现——挑战假设 / 找反例 / 找证据 / 追问原因 / 换个视角 / 升一层 / 降一层，外加「就此提问」；Agent 评论旁「追问」；文本选区交给引用插件统一处理。一块画布 = 一个 side-chat 上下文（`canvas:<id>`）= 一个持久 Agent 会话，系统提示每轮新鲜（主题 + 板摘要 + 工具契约 + 透镜语义 + grounding 护栏 + stats 回授）。**side-chat 缺席时聊天入口全部隐藏，板面完整可用。**
- **主会话工具**（M3）：`canvas_propose_card`（提议卡，proposed 待你 ✓/✗）与 `canvas_comment`（评论挂卡，指出假设/张力并以追问收尾）注册进主会话 Agent——打开的画布就是目标（tab 切换即上报 focus）；没打开任何画布时工具如实说明而不是乱改。
- **幽灵提议卡**：`proposed` 状态的卡以虚线幽灵态内联在板上，「收下」转为正式卡、「拒绝」归档（**不做删除**）；接受率计入 `stats`，供后续自调整规则使用。
- **筛选、多选、归档**：按 kind 的筛选 chips（这块画布当前启用的分类）；勾选框多选，选择条上可批量归档、批量「改分类」；已归档的卡进「归档井」，随时恢复。
- **分类是每块画布自己的**（0.4.5）：五种内置卡是起点，不是上限。板上右上角「管理分类」开这块画布的面板：**改名**、**加一个**（新分类 id 是 `cat_…`）、**停用**。卡上存的是分类 **id**，不是名字——所以改名不动任何一张卡。停用 = 这个分类退出筛选条 + 拒绝新卡，已经挂在它下面的卡一张都不消失；停用一个还有卡在用的分类会弹**一次**确认，确认就把那几张一起进归档（正文保留、随时恢复）。想把卡留在板上，用勾选批量选中后的「改分类」——面板里刻意没有「挑个去处」的选择器。整套目录写在这块画布的 `canvas.json → categories`，旧文件没有这个字段，读的时候按默认五种补齐（零迁移）。对模型：`canvas_propose_card` 的 `kind` enum 就是这块画布的启用分类；没改过名的内置分类在提示词里仍是裸 id（`fragment`），改过名或自定义的写作 `id（名称）`。
- **卡板与连线，一块画布的两张面**（0.4.5，阶段 ⑥）：顶栏右侧一个「卡板 / 连线」切换——卡板是改一张卡的地方，连线是把卡连成一组的地方，切的是同一块板。连线面把每张卡画成一个节点（有画的带着笔迹），拖它就是改它的位置；从节点右缘的圆点拉一条线落到另一个节点，两张卡就连上了（**线没有方向**，`{a,b}` 与 `{b,a}` 是同一条）；「新分区」拖出一个带标题的框，卡的心落进框里就属于这个框——**归属是几何算出来的，不是存的字段**，所以拖分区会带着里面的卡一起走，把框缩到卡心露出去，那张卡就自动离开框。点节点只选中、不编辑（要编辑点那支笔，或在卡板上点进去）；框选一片是一次追加选中，八像素以内的抖动算点击、只把手上的线取消掉。底栏跟着给出「顺线扩一圈」（沿线取闭包，再补一跳同分区的卡；默认关，且从不落盘）、「就这一组提问」、「生成文章」、「删掉这条线」、「取消选择」。位置、线、分区都写进这块画布的 `canvas.json`（`cards[].x`/`y` 成对出现、`links[]`、`lanes[]`），一个 `setLayout` 动词一次落一盘并带版本守卫；旧文件三个字段都没有，读的时候按「没摆过」补齐，零迁移。
- **评论挂卡上**：角标展开线程，评论即数据（Agent 的评论会把 open 问题卡自动推进到 exploring）。
- **编辑器三件套沿用 v1**：非受控 textarea（光标不跳）、输入法组合期间硬停（候选窗绝不被打断）、单滚动容器。
- **暗色自动跟随**：所有颜色都走官方 `--dsw-*` 主题 token，kind 只靠图标 + 文字区分，不用彩色。

## v1 灵感稿纸（存储保留，编辑器已退役）

- **一个灵感 = 一个文件**。正本在 `<工作区>/灵感画布/` 下，`文章/` 与 `卡片/` 两个子目录分别是两种形态，文件名就是标题。没有数据库、没有私有格式。
- **M1.5 起右栏 tab 不再是稿纸编辑器**（现为画布工作台）：原文件仍在磁盘上，任何编辑器都能打开；v1 的五个 Remote 动词（`list` / `read` / `create` / `write` / `setArchived`）在线上不动。
- **归档而不是删除**（画布与稿纸同义）：归档只从列表里隐藏，**文件一个字节都不动**；已归档区可随时恢复。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas
# 卸载：
dsh plugin --profile web remove @khorsheed/dsh-canvas
```

装完重启宿主。卸载**不会**删除 `$DSH_HOME/state/canvas/` 或任何 `灵感画布/` 目录——你的稿子和画布是你的。

## 按 preset 收敛会话工具（0.4.2+）

两个画布工具（`canvas_propose_card` / `canvas_comment`）与它们的英文提示词引导段注册在独立的 composition 入口 `./agent` 里，不再钉死在 profile 根。出厂的 `cordis.patch.yml` 把它作为第二行默认挂载——**所有 preset 的所有会话都有工具**（与 0.4.1 及以前一致）。想只给某个模式（如 `dsh-writing`）授予时：

```yaml
# <profile>/cordis.patch.yml：关掉根级行
- id: canvas-agent
  disabled: true
```

```yaml
# ~/.dsh-official/.agent-presets/dsh-writing/agent.cordis.yml：在该 preset 内授予
- id: canvas-agent
  name: "@khorsheed/dsh-canvas/agent"
```

**两者绝不能同时生效**（同名工具会注册两次——local-agent 家族的既定模式）。未授予 preset 的会话：系统提示词完全不含画布引导，工具目录也没有 canvas_*。入口缺席 `canvasBoard` 时（比如核心行没装）只 warn 不注册，绝不炸组合。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——右栏页型 tab（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab`）自 0.1.5 起存在，`minHost` 随之抬到 0.1.5-rc.1；旧宿主没有右栏面，请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）
- **web 面插件**：headless profile 没有浏览器消费者，本插件在那里不贡献任何东西。
- **主会话画布工具**注册在独立 composition 入口 `./agent`（出厂 patch 根级默认全会话可见，可按 preset 收敛——见上节；origin tag 自带）；目标画布按会话 focus 解析（右栏 tab 当前打开的画布），无打开画布时工具返回明确说明文本。**聊天依赖 side-chat 插件但缺席不致命**：探测 `ctx.get('sideChat')`（单向边，manifest `dsh.references` 登记），缺席时聊天入口全部隐藏、板面完整可用。
- **v1 写入按「发起这次点击的会话」围栏**。三个写接口（新建/保存/归档）都先取调用会话的沙箱策略再写：围栏挂在会话自己的工作区上，不是宿主的进程目录。所以会话是只读模式时，画布会明确拒绝写入（`这个位置不可写`），而不是悄悄写进去。
- **v2 板写入围栏重定界到 state 目录**。画布是部署级状态，任何会话的工作区都装不下它：写入沿用挂载的 `ctx.fs`（版本守卫、原子写、观测轨迹），会话解析出**模式**与 session id（只读部署照样拒绝），但可写边界重定界为插件自己的 `$DSH_HOME/state/canvas`——一个正好围住 state 目录的 workspace-write 围栏，绝不用裸 `node:fs` 绕。`DSH_HOME` 未设置时 state 根退回 `process.cwd()`（datasets 先例）。画布工具的写入走同一条围栏（优先执行 Agent 自己的会话）。
- **粘贴图片走宿主附件库**：探测 `ctx.get('attachments')`（`@deepseek-ai/dsh-attachment`，peer 声明为 optional）。像素进宿主的内容寻址库，卡里只留一行 `attachment://…` 指针（五个字段都是宿主读回时要比对的）；没挂附件库的部署里图片入口自己降级——贴一次说一次「这个部署没有装图片存储」，文字粘贴照常。渲染侧只认这一个 scheme：卡片里手写的本地路径永远不会变成一次文件请求（风险 ⑬）。
- **绘画不向宿主伸手**：笔画以点列存在卡里（600×400 逻辑框的单位），轮廓库 `perfect-freehand`（MIT、0 依赖）随 tsdown 一起打进 `lib/client.js`——没有额外安装、不落文件、不进附件库。

## Known Limitations

- **只归档，不删除**。官方 `ctx.fs` 没有删除文件的接口（13 个抽象方法里没有 `remove`/`rename`；沙箱围栏也只挂在 `writeText`/`editText` 上，裸 `node:fs` 会绕过它）。要彻底删掉某个文件，请在文件管理器里删——它只是你的一个 markdown 文件。画布同理：归档的画布与卡都留在 `canvas.json` 里。
- **贴进来的图片字节不会被回收**。像素落在宿主的内容寻址库里，归档画布、删掉卡片都不碰它——这些文件会一直留在宿主的附件目录，要彻底清掉得在宿主侧动手（本插件没有删除接口，见上条）。指针读不回对象时降级成 alt 文本：不报错，也不留破图。
- **只有贴进去的图会显示**。渲染侧只认 `attachment://` 一种 scheme，`./pic.png` 这类自己写上去的路径永远停在 alt 文本（这条白名单就是风险 ⑬ 的设计）。想让图进卡片，就用粘贴。
- **一张图的像素只过一次 Remote**。缓存未命中时字节以 base64 走一趟，之后 24 条以内不再重复读，第 25 条进来时最久没用到的那条出去。所以长文多图的首屏是「文字先到、图一张张亮起」，不是同时出现。
- **画的上限是 60 笔、单笔 120 点**。到了线会说一声，不会静默截断（撤一笔或擦一笔就腾出空间）。存点列、轮廓每次渲染现算，所以线条规则以后改了老画自动跟上——代价是每次重绘多一次计算。
- **笔画粗细靠移动速度，不靠压感**。鼠标本来没有压力可读（走得快就细、走得慢就粗）；触屏与手写笔的真实压力暂未接线。
- **模型读到的是坐标，不是像素**。绘画以点列随 prompt 的 `<board>` 段交出去：Agent 能推理几何，但看不见「一张图」。让它参考画面生成多模态内容还需要一条导出位图的路（未做）。
- **外部编辑器的改动收不到通知**。官方 `workspaceFiles.changes` 只报被插桩的文件系统操作，**不观察操作系统**；在别的软件里改了 `canvas.json`，插件只能靠保存时的版本守卫发现冲突；本页不轮询。
- **列表顺序存在 `.index.json` 里，不按修改时间**。`ctx.fs` 不上报 mtime，所以顺序由索引维护（新建的排在最前），未在索引里的文件按文件名排在后面。
- **跨工作区只能读、不能写**。模型的 `read` 不受工作区限制，所以你能把 A 工作区的稿子引用到 B 工作区的会话里；但会话 B 的沙箱以 B 为界，模型改不回 A 的文件。
- **中文目录名**：`git status` 里会因 `core.quotepath` 显示成八进制转义（功能正常，观感吓人）。宿主侧一律走 `ctx.fs` 拿绝对路径，不 shell 出去，所以中文与空格都不成问题。
- **HTML 表格的合并单元格降级**为「文本 + 空格子」，不重建跨行列。
- **连线存的是空间，不是屏幕**。坐标是布局单位（一帧 600×400），但**故意不夹进这一帧**：连线面能平移，一张卡摆在 `x: 900` 是合法的；存屏幕像素的话，面板换个宽度每张卡都会跑错位置。代价是卡可以被拖到你当下看不见的地方——那里没有「回到第一张卡」的按钮。
- **线没有方向、没有标签、没有样式**。`{from,to}` 就是一个无序对，板面上双向读；要给线加箭头或名字是后面阶段的问题，现在也不替你猜。
- **两个分区重叠时，卡的归属取先到的那个**（列表顺序），不取「更贴合」的那个。重叠是这块板要自己收的口子，不是几何层要猜的题。
- **「顺线扩一圈」是临时的**：它只改这一次要发出去哪几张，默认关，永不落盘——线画在板上是内容，扩圈是手势。
- **仍不做**（后续里程碑）：stats 自适应规则、web 搜索接线（M3 后段）；`assets/` 大文件落盘、html 卡的源码编辑高亮、会话侧检索工具（M4）。也没有画布标题改名。**长文那一档已于 2026-09-22 整体删除**：它从来没有模型侧工具（`canvas_propose_draft` 与候选 diff 接受流只存在于提案里，`exportDraftToWorkspace` 从未实现），那份稿关在 state 目录里出不去；要长文就在会话里让 Agent 写工作区文件，官方文件预览器已经能看。
- **画布 Agent 的 cwd 由 side-chat 的继承规则决定**（调用会话的 cwd），不是提案 §6 设想的「首个挂载工作区或画布目录」——那是 side-chat 包的契约，画布不越界修改。
- **幽灵卡落板的可见性**靠客户端的回合监听（发送后轮询 side-chat 状态并触发重读）；轮询停止后、或别的浏览器标签页的改动，仍靠下一次手势时的版本守卫浮现，板不常驻轮询。
- **收列表是一次性建议**：tab 首次可见时每会话建议一次收起会话列表（`toggleSidebar()`，DOM 探测 gated），此后布局由你接管；fullscreen 不作建议（宿主 fullscreen 隐藏右栏拖拽把手，per-tab presentation seam 是上游候选）。

## 工作原理

<details>
<summary>内部结构（点击展开）</summary>

**磁盘布局（v2）**

```
$DSH_HOME/state/canvas/<canvasId>/
  canvas.json      # { id, title, attachedWorkspaces, chat, cards[], categories[], links[], lanes[], stats, archivedAt, … }
```

`cards[]` 每张卡：`{ id, kind, text, source?, status: proposed|kept|archived, question?, comments[], draw?, x?, y?, createdBy, createdAt, updatedAt }`。`draw` 是 `[{ pts: [{x,y,w}], color }]`——逻辑框（600×400）单位下的点列。`x`/`y` 成对出现或一对都没有（只有坐标没有尺寸：尺寸归渲染，不归存储）。`links[]` 是 `{ from, to }`，`lanes[]` 是 `{ id, label, x, y, w, h }`。`stats` 记提议接受/拒绝计数、各 kind 可见卡计数、最后活跃时间（列表排序与后续自调整规则的数据源）。文件损坏或 id 对不上目录时：**列表跳过、读写报错**，绝不重写一个读不懂的文件。

**板服务**：`CanvasBoardService`（`ctx.canvasBoard`）整板版本围栏读写——读取 → 应用纯函数修改 → `replaceIfVersion` 写回；版本冲突**重读重放一次**再报 `stale`（两个浏览器标签页同时操作不丢卡）。写入围栏见 Compatibility 的「重定界」条。

**Remote**：namespace `canvas` 在 v1 五动词（`list` / `read` / `create` / `write` / `setArchived`）之外的空间动词：`listCanvases` / `createCanvas` / `readBoard` / `putCard` / `patchCard` / `addComment` / `archiveCanvas` / `setCategories` / `setLayout` / `askAgent` / `chatStatus` / `focusCanvas`，加上图片那两条不带会话的 `attachImage` / `imageBytes`。变更类全部 agent 优先（调用会话供电围栏），读取类不带 agent——v1 的线上约定原样延续。`setLayout` 是连线面唯一的写动词：一次拖动可能同时动一张分区和它里面五张卡，逐张 `patchCard` 会各自撞自己的版本守卫，所以位置/分区/线三样合在一个动词里一盘落定。**「没带这个字段」和「带了一个空数组」是两件事**：省略 = 这一盘不动，`[]` = 清空。

**右栏只有一个 tab 类型**（M3 注册一次；0.4.5 一度注册两次，0.4.6 把第二次收回来了）：`ctx.sidebarRightTabs.register` 一次，body 挂在 keyed `sidebar.right.pane.tab` 上，注册级开关一处管显隐。`canvas` 是**页面类型**（不认领地址，按 kind 打开），而 `tab/CanvasTab.tsx` 现在是一台路由器：`tab/TabStrip.tsx` 是那一排标签，下面的正文是「显示中那一行」的页面——板行 = 顶栏 + `space/BoardView.tsx`（或 `space/LinkView.tsx`），卡行 / 草稿行 = `detail/CanvasDetailView.tsx`，并且带 `key`（一个不受控 textarea 的值不能从你刚看的那张卡带进这张卡）。切换器（`tab/CanvasSwitcher.tsx`）挂在标签条行尾，只负责往这排里加行（新建 / 挑一块已有的 / 归档）。

共享 store（`space/selection.ts`）持 `{ tabs, active, rev }`，`canvasId` 从「显示中那一行」推出来（一张卡的标签因此把主会话工具指向它所属的那块画布）。行的 id 由主体推出（`b:<canvas>` / `c:<canvas>:<card>` / `d:<canvas>`），所以去重是 id 的性质而不是代码里的查找；一块画布因此只有一张草稿行——「＋新卡」再点一次换的是它的分类，不是又开一张空白。这一排活过刷新：行写进 `sessionStorage`，读回来时逐行验形状，认不出的整条丢掉（外面塞进来的 payload 一个字都不认）。宿主 dock 上那张芯片的活标题走 `sidebar.right.pane.tab.title` 那个 inject 槽（`tab/CanvasTabTitle.tsx`）——宿主只在打开时捕获一次 `title`、之后从不刷新，所以标题只能自己读 store：板行读注册表给的名字，卡行/草稿行读它自己带的 heading。tab 打开/切换即 `focusCanvas` 上报宿主（主会话工具的目标）；收列表建议（DOM 探测 `data-sidebar-collapsed` 后 `toggleSidebar()`）每会话一次（fullscreen 建议已随 M3.1 撤销：宿主 fullscreen 隐藏右栏拖拽把手）。任一侧的变更动词在 apply 层包装里统一 `touch()` 推 rev，读者重读跟随；板面每次重读也把自己的 `summarizeBoard` 折回列表，所以别的标签（或 Agent 工具）写进去的卡数不会在切换器里过期。

**连线面的两层切分（0.4.5，阶段 ⑥）**：`space/layout-geometry.ts` 是纯函数层——无 DOM、无 store，每个盒子进来都是四个数，所以同一批问题（谁在这个分区里、这条线该怎么弯、框选抓到了谁、分区能被拖到哪）能在 node 测试里回答；`space/LinkView.tsx` 只剩手势与渲染。每个手势各挂各的 `window` 指针监听，落点**从松开那一刻的事件重新算一遍**，不读记忆里的那一刻——所以拖拽中途的旧帧不可能被提交，也不需要一条靠依赖数组撑着的 `useEffect`。三个决定管住所有形状：分区归属看**卡心**不看面积（贴边压线的卡不会被两像素的缩放甩出去）；线的控制点沿**主轴**推、推力带符号（这对卡不管朝哪个方向存，线尾都从邻居那一侧出去，也不会自己打结）；两个维度都不到 8px 的抖动是点击，不是框选。为什么**手写而不是 `@xyflow/react`**：客户端 bundle 只允许内联 `.module.css`（`build/tsdown.client.ts` 用 lightningcss 把类名编译成哈希再注入），一个第三方**全局**样式表没有干净的挂载位；加上解包 1.2 MB、主题要整张重上色、原型本来就是手写的。

**聊天集成（M2）**：`askAgent` 动词（agent 优先）探测 `ctx.get('sideChat')`，命中则 `openWith({ contextKey: canvas:<id>, label: 主题, systemPrompt, tools, refs })`——`prompt.ts` 纯函数渲染系统提示段（主题与目标 / 板摘要 / grounding 护栏 / 工具契约 / 透镜语义 / stats 回授段），`tools.ts` 出两个 `defineTool` 定义（origin tag 走 `Symbol.for('dsh.tool.origin')` 免导入路径）。发送规则：自由文本优先，否则非 `ask` 透镜的模板文本，都没有则只 prime。客户端两处发起（透镜条 / 评论「追问」；选区交互归引用插件），`chatStatus` 探测门控制全部聊天入口的显隐；发送成功后监听 `remote.sidechat.getState`（结构镜像），running 期间定期 `touch()` 共享 rev，幽灵卡随工具调用落板即现。

**主会话工具（M3；0.4.2 起经 `./agent` 入口）**：`tools.ts` 的 `canvasMainSessionToolDefinitions` 由 `src/agent.ts` 的 composition 入口经 `ctx.inject(['tools'])` 注册（deferred，datasets-tool 先例；出厂 patch 挂在根级、可挪进 preset 的 agent.cordis.yml），附英文 `canvas:tools` 系统提示段；目标画布 = `ctx.canvasBoard.focusedCanvasId(session)`（tab 经 `focusCanvas` 上报），无 focus 返回「没有打开的画布」说明文本。origin tag 同免导入路径。右栏 tab 类型按「当前会话能否触达画布工具」做注册级自隐（双查判据：profile 根挂的 enabled `@khorsheed/dsh-canvas/agent` 行 = 全会话可见；否则当前会话 preset 组合含该行才可见——preset 挂载形态如 3080 的 dsh-writing 配方；一切读不到的路径 fail-open）。2026-09-16 事故的教训不在「入口按 preset 自隐」而在「判据只查 preset 组」：根挂形态下组合里没有任何行可 keyed，单查即永隐。

**v1 磁盘布局**

```
<工作区>/灵感画布/
  文章/第一章 雨夜.md
  卡片/雨伞的意象.md
  .index.json          # { order: [...], archivedIds: [...] }
```

`.index.json` 的形状照官方 workspace registry：`order` 是显示顺序，`archivedIds` 是归档集——和官方用 `workspaceIds` + `archivedSessionIds` 表达「顺序 + 归档」是同一套。索引缺失或损坏时**降级**为按文件名排序、无归档项，绝不因此打不开画布。

**v1 宿主半边**：`CanvasService`（核心逻辑）+ `CanvasRemoteService`（Typert Remote）。五动词全部**纯 JSON、绝对路径参数、不做会话查找**（local-files 的惯例）。每次写入都走挂载的 `ctx.fs`，因此部署的沙箱模式会拦下越界写入，观测策略也能看到它；版本守卫由 `writeText` 的 `{ kind: 'replaceIfVersion' }` 提供，冲突返回 `stale` 而不是覆盖。

**编辑器的三条硬约束**（`space/CardTextarea.tsx` 实现，因为破坏任何一条都会毁掉写作）：非受控 `<textarea>`，状态回流永不写回 `value`；输入法组合期间既不保存也不提交；单滚动容器（编辑器自己滚动）。

**粘贴转换**（`paste-table.ts`，纯函数）：`text/html` 里的 `<table>` 只抠表格不转整篇（电子表格的剪贴板 HTML 带着整张表和样式），制表符分隔文本兜底；都不是表格时走 `htmlToMarkdown`——标题/强调/代码/链接/列表/引用/围栏代码块都转，转换结果的纯文本与剪贴板 `text/plain` 逐字（空白不敏感）一致才落 markdown。插入用 `setRangeText` 加一次 input 事件派发（编辑器是非受控 textarea，浏览器自己的 undo 栈照常工作）。

**图片读回**（`client/images.ts`）：宿主的 `MarkdownPathImages.resolve` 是**同步**的，而字节读取是异步的。所以缓存 `CanvasImageSrcs` 持一张「指针 → data URL」的表（24 条最久未用淘汰；读失败也记住，省得每次重绘重读），外加一个版本号。tab 订阅那个版本号，版本一变就现造一个新的 `pathImages` 对象——`MarkdownText` 是 memo 的，只有对象身份变了才会重绘；订阅属于**这块画布的 tab**（0.4.6 起又是 `CanvasTab` 订一次，把现造的 `pathImages` 递给显示中的那一行；0.4.5 那一版它在详情标签里自己订，标签收回画布内部，订阅跟着回来）。HTML 卡没有 `pathImages` 可给，走 `rewriteImageSrcs` 改写 `src` 属性。选 `data:` URL 而不是 blob object URL：没有 revoke 生命周期、不会留游离对象，淘汰就是一次 map 删除。

**绘画**（`client/draw.ts` 纯函数 + `detail/CardPad.tsx` 字段 + `detail/DrawFigure.tsx` 图形）：坐标换算、采样、笔宽、橡皮命中、轮廓导出全在纯函数那一半——每条规则都是人画过一笔之后会有异议的规则，对着数字争论比对着截图便宜。存点列不存轮廓（实测一笔 24 个点：点列 287 B、轮廓 834 B），轮廓由 `perfect-freehand` 在渲染时现算（MIT、0 依赖，随 tsdown 打进 `lib/client.js`，部署侧不用多装包）。一笔完成就用整份点列 `patchCard` 覆盖，沿用同一条版本围栏，因此画没有单独的脏标记与保存按钮；`draw: []` 表示「清空」，与不带 `draw` 的「别动它」必须可分。绘画是**内容**：只有画、没有字的卡照样能建，丢弃草稿的确认也因此看字数**或**笔数。

配置项：插件行可配 `stateRoot`（画布 state 根覆盖；默认 `$DSH_HOME/state/canvas`，`DSH_HOME` 未设置时 `<cwd>/.dsh-canvas`）。

</details>
