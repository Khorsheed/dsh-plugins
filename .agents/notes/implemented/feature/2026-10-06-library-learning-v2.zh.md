# Agent Note: library v2——登记书、知识卡片与两轴出题

Status: implemented

## Problem

M1 的图书馆（[M1 note](2026-10-06-library-learning-mode-m01.zh.md)）假设用户上传书的正文（EPUB/Markdown），出题按章节正文判。和用户对照 catmem 学习模式、并用一张真实照片（划了线、页边写了中文释义的雅思页）走完旅程后，前提变了：用户多读纸书；多数书模型知道或能搜到；用户要考的是**自己**划的、问过的、答错的东西。旧数据模型放不下这些，而解析上传是没人买单的成本。

## Decision

`@khorsheed/dsh-library` 保留包身份、存储纪律（项目级锁、临时写+改名、append-only 账本、裸 `node:fs`）、状态机与判题级联；外围的领域模型换掉（`LIBRARY_STATE_VERSION` 升到 2——v1 从未部署，v1 根读作空）：

- **书只登记不上传**（`putBook`）：书名、版本、ISBN、`bookKind`（`knowledge` | `material`）、目录及其来源（`web` 必须带 url）。EPUB/Markdown 摄入、消毒、`chapters/*.html`、`library_read · chapter` 与 fflate 全部移除。
- **路线按书、先草稿**：教练写 `roadmap.draft.json`（状态不由教练设）；用户「采用」（`adoptRoadmap`）后成为 `roadmap.json`，根节点 `current`，重拆时同 id 节点保留状态与测验统计。read 节点经 `markNodeRead` 完成。
- **照片页**（`recordPage`，`books/<id>/pages.jsonl`）：一次调用记下整页印刷文字与所有标记（`text`、`sentence`、`handNote`、`gloss`、`uncertain`），确定的标记一键成卡；拿不准的留在页上、不成卡。照片只存附件引用；`readPagePhoto` 只读本项目记录过的页；`savePhoto` 经 `attachments.saveImage` 保存侧栏上传。
- **知识卡片**（`cards.jsonl`，取代词书）：`word` | `concept`、别名、模型释义与用户手写 `userGloss` 分开、语境与来源叠加（`photo` | `chat` | `quiz` | `manual`）、`weakness` 0–3 与 Leitner `mastery` 分开、`bookId` 可选（缺省即挂项目）。**查重在写入路径**（`src/cards.ts`）：归一化键（NFKC、大小写、空白、首尾标点、英文复数折叠；含别名）完全相同即合并；疑似重复（较长键包含较短的实义键，或共享词 / 汉字 ≥ 0.6）放进 `pending` 并附最多三张候选，教练用 `mergeInto` 或 `asNew` 重发。照片词遇疑似重复直接合并。聊天卡初始薄弱度 1，`weaken` 再加一；`undoCards` 删除该次新建的卡、撤掉该次叠到旧卡上的来源（及薄弱度）。`reviewCard` 只动复习间隔。
- **两轴出题**：每题带 `target`（`marked` | `asked` | `missed` 须给存活的 `cardIds`；`topic` 不用）与 `evidence`（`photo` 须指向已记录的页并引原文——页面文字里找不到的引用进 warnings；`web` 须 url + 引文；`knowledge`）。`material` 书拒收凭领域知识出的 `topic` 题——模型记不准的内容。
- **级联**只计非作废判定；考对升一格并减薄弱度，答错回 box 0 并加薄弱度，无卡的错题自动建卡（`missedCard` 或题干），被门节点达标即完成。
- **会话绑定**（`bindings.json`，会话 id → `{ projectId, bookId? }`）：Remote `boundTarget` / `bindTarget` 首参是调用方 agent（canvas 同款）；工具的 `project` / `book` 默认取绑定，未绑定时教模型先问再绑。
- **`./tool` 行**注册三工具（用法写在描述里——`library` skill 移除）、`tool:library` 段与每轮的 `library:binding` 上下文（`systemPrompt.context`，由 `bindingSummary` 同步渲染：绑定的书、当前节点、最薄弱的卡）。可选 `hideSections`（scope 内同名空段遮蔽根段）与 `denyTools`（`tools.restrict`）为专注型 preset 静音；组合里不存在的名字只记日志，不致命。

`@khorsheed/dsh-bundle-learning` 精简为 persona、ask-user、web、compaction 与 library 行，配 `hideSections: [harness:source, app:web-surface, ui:deliverable-file-references]`、`denyTools: [list_capabilities]`；去掉 fs、skills、todo。

## 侧栏

浏览器半是一条路由栈（`client/store.ts`），覆盖 今日 → 项目 → 书 → 这一节 → 知识卡片 → 章节考 → 结算 → 复习，基于 `ui-panel-kit`（`PanelRoot`、`PanelHeader`、`UnderlineTabs`、`ChipRow`、`ListRow`），桌面侧栏与手机全屏共用一套界面（docs/panel-design.md；`pnpm check:panels` 无错误）。各视图经小 `useLoad` 钩子按 store 的 `rev` 读宿主。侧栏不替模型干活：加书、（重新）排路线、出题、判开放题都在 `bindTarget` 之后填进绑定会话的输入框（`primeConversation`）。选择与填空在侧栏判（`client/judge.ts`）；没有开放题的一次作答直接经 `putAttempt`（`by: 'self'`）落账，否则整次作答交给教练，保证一次作答一条记录。样例页（`examples/sidebar`，端口 8877，内存数据）用于截图自查。

照片刻意经过会话（M2c）：这一节的「拍照记重点」选图或拍照后，以学习者本人的消息把照片连同记录请求发进会话（`sendPhoto`：结构探测 ui-conversation 的 `createDrafts` 与输入门面的 `addAttachments` / `submit`），聊天里看得到发了什么、教练怎么认的，学习者就地纠正。侧栏随后轮询直到新页落盘（最多两分钟）。每页把拿不准的标记列成一点即发的小块，并有「补一个漏掉的词」输入框，二者都同样以一条短消息发出（`sendMessage`）。否决了插件后台直调视觉模型：识别过程会从聊天里消失，还要自管模型路由。

会话头部有一枚图书馆芯片（M3，`client/bind/BindChip.tsx`，槽 `conversation.session.header.actions`，order 50，排在 canvas 的 40 之后）：显示「学习 · 书或项目」，菜单列出每个项目及其书，可解除绑定。只在会话持有 library 工具时出现——`LibraryTabVisibility.grants`，判据的严格一半（清单未答复即为否，不同于 fail-open 的 tab）——并每隔几秒重读绑定，因为教练也会绑定。聊天来源的 `cards.recorded` 事件带上记录它的 `session`；侧栏轮询最近记录，为本会话新记下的条目弹出「已记下：…　撤销」，撤销以事件里的 ids 与时间调用 `undoCards`。

## 样子与复习（M4）

- **项目身份**：项目有预设 `color`（8 种）与 `icon`（12 个），按模板给默认（语言学习：ember / 地球，学科知识：indigo / 大脑），`updateProject` 可改。侧栏在某个表面上设 `data-color`，其下都读 `--pc`：今日的项目卡（图标、目标截两行、进度环、最近使用时间）、项目页彩色标题区（含选择器）、书架、书页与路线。八种色是两种主题都清楚的中间调字面量（`panel-check: allow-color`）。
- **今日与书架（样式第二轮）**：今日把项目做成卡片，按最近使用排序（`lastActiveAt` 取项目最新一条事件，没有就取创建时间；由服务端排序）；去掉「接着读」——项目卡和书架已经能走到那里。书架是固定尺寸的书（宽 96px，按色阶高低略有不同）立在木板上：每行等高，用一条重复背景画出整宽的木板，无论一行几本书；书名和进度在木板下方。
- **克制与盒模型（样式第三轮）**：项目色只留在图标（浅底色块、彩色线条）、进度环和封面上；卡片、项目标题区和书架都用宿主的中性表面。宿主没有全局 `box-sizing`，样例页却有——封面把内边距加在宽度之外，只在真机上压住下一本书——现在由 `.root *` 局部设 `border-box`，样例页也去掉了全局重置，与宿主一致。
- **一致性小修**：封面缩写用面板字体，不再用衬线体；书架上的加书位只留 ＋（给读屏写了标签）；项目页标题栏和其他页一样显示本页名称（返回 + 项目名），下方标题区不再重复名字，只放目标、模板和最近使用。
- **封面**：自动生成、从不上传：项目色按书架位置加深或提亮，书的 `short`（教练登记时给，否则从书名推导），书型角标。
- **路线上放什么**（用户 2026-10-08）：quiz 节点是关卡，只依赖关卡（`validateRoadmapShape` 拒收依赖读物节点的关卡）；read 节点是可选旁站，采用后即开放，画在前一个关卡旁的小圆点；怎么用这本书、答案、听力原文、附录是书的 `extras`，显示在「开始前 / 附录」条里，不是节点。路线在关卡之间画连线（走到的为实线，往后为虚点线），过关的关卡挂最好成绩。
- **复习改作答**：`pickMode`（`client/judge.ts`）让概念卡写一句再对照答案（自评，或交给教练判）；掌握较好（box 3+）的词考拼写；其余词在自己的原句里挖空，或在学习者其他词的释义中选本句义（按连对次数交替）。一次答对：recalled；靠提示答对：fuzzy；答错：forgot。英美拼写与复数不影响判定（`spellMatches`）。一轮显示连对，结束给小结（升一格 / 保持 / 明天再来、最长连对），可再练错题且不改复习时间。翻卡模式保留。不发分、不算 XP、不显示本周统计（没有复习记录可算）。

## 真机试跑（2026-10-06，deepseek-flash，0.2.0-rc.2 上的一次性实例）

- 学习会话里模型看到的正好是 ask_user_question、library_read / library_write / library_assess、web_search 与 web_fetch；`list_capabilities` 被屏蔽，三段根上的无关段已消失（系统提示 3.3k 字符）；`library:binding` 上下文每轮都在。
- 加 PNS 第 6 版并起草路线一轮完成。模型写出的两种形状曾让存储丢数据，现已吸收：节点 goals 写成单个字符串（存为一项的列表）；把部分标题当目录行（只重复其 part 的行会被丢弃）。
- 模型看到的图片 id 没有 `sha256:` 前缀、也没有 `bytes`，它抄的引用读不回照片。`src/image-refs.ts` 从已提交的 `session/event` 记住各会话的图片引用，记录页面时据此补全（给 id，或不给即用最近一张）。
- 同一张页面照片跑两次：每次约三分之二的划线成卡，漏的词不同；本句义准确。侧栏因此需要「补一个漏掉的词」的入口。
- 头部芯片与提示，在真实浏览器里：芯片显示「学习 · 剑桥雅思 5」；问 held 为何是「举行」并说老是记混，教练主动记下，侧栏弹出「已记下：held」，撤销从合并后的卡上去掉了那次聊天来源及其增加的薄弱度。
- 在真实浏览器里点侧栏拍照：照片与请求以学习者的消息出现在聊天里，教练认出这一页已记录过、没有重复写入。
- 五题章节考一次出对两轴：三道考划过的卡、两道内容题，全部基于照片原句。
- 挂在仍锁着的节点上的测验会落盘并给出提醒。
- 章节考由学习者选出题来源（用户 2026-10-08：「只考我自己画的重点」）：`quiz.focus` 为 mine / book / mixed，在这一节的「章节考」页选（默认 mine）并随请求带给教练。图书馆按它把关——mine 下拒收本章主题题、book 下拒收卡片题——教练无法拿书本内容凑数。真机：四题全部考划过的卡，落盘 `focus: mine`。按标记区分「重点 / 难点」的想法放弃：没人能确定学习者用什么符号。

## Alternatives considered

- **保留上传作为可选入口**：用户否决——为少数路径留着解析问题；网上找不到的书改为拍目录页登记。
- **让教练用宿主 fs 工具 grep 卡片**：否决——状态根不在工作区，grep 折叠不了复数和别名，而且靠模型记得先查的查重一定会漏。搜索是 `library_read · cards` 的 `query`，保证在写入路径。
- **疑似重复直接整批拒收**：否决——一张有歧义就让整批失败；只扣下那一张（`pending`）既保住其余，也让决定显式。
- **异步渲染绑定上下文加缓存**：否决——会话第一轮会看不到；存储读取小且同步，直接渲染。
- **为 preset 单独做一个静音插件**：暂不——学习 preset 只拥有 library 这一行，在它上面加两个配置数组比新开一个包面更小。

## Consequences

- 模型不再能「引用」它没见过的书；逐字依据只剩照片与网页，材料型书规则挡住凭记忆的内容题。
- 每个项目里一件事一张卡，在两本书里遇到的词带着两句语境，复习时轮换。
- `restrict` 与 scope 内空段在这里只对假对象验证过；preset 行的 ctx 是否足以调用 `tools.restrict` 要在真实例上确认（提案探针 P1-8），失败时是记日志的空操作。
- 侧栏拍照（M2c）落地前照片仍经会话发送；记录提示与会话头绑定芯片在 M3。

## Testing

`tests/store.spec.ts`（文档、草稿、容错账本、绑定、锁）、`tests/service.spec.ts`（键折叠、精确 / 疑似合并、pending 与 `mergeInto`/`asNew`、照片成卡、撤销、复习、两轴、材料型书规则、含作废与无卡错题的级联、重新采用保留进度、绑定摘要）、`tests/tool.spec.ts`（绑定默认与教学式错误、聊天卡记会话、渲染的上下文）、`tests/boot.spec.ts`（行接线、静音配置、`tools: none`）、`tests/judge.spec.ts`（侧栏的选择 / 填空判题），以及 bundle-learning 的 patch 测试；侧栏各屏在样例页上按 390px 深浅两色与桌面宽度截图自查过。

## Related

- [M1 note](2026-10-06-library-learning-mode-m01.zh.md)——本次保留的存储、状态机与可见性判据。
- 提案 `proposals/active/2026-10-06-library-learning-mode.md`（v2）与原型 `proposals/prototypes/library-learning-v2.html`（本地，未入库）。
