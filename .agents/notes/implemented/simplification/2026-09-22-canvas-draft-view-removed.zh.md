# Agent Note：画布的长文档删了，那套说错的话也一起改了

Status: implemented

## 问题

v2.2 那一波以 `@khorsheed/dsh-canvas` 0.4.4 上线 3080，用户打开、截图、问「符合预期吗」。两件事**没做**——它们不是新需求，也不是判断走偏，是**已经批过的**没落地：

- **改名整刀没做。** `proposals/active/2026-09-16-canvas-space.md` §10.7 那张命名表落在阶段 ② 里，而阶段 ② 用户明确点过头。板上还是 `碎片 / 依据 / 资料`，顶栏还是 `[卡板 | 成稿]`。
- **长文档还在。** 他们点过的原型页已经把它划掉了——`proposals/prototypes/canvas-link-compose-draw.html:313` 是 `<s>卡板 | 长文</s> → 只剩一档`，同页 279 行写着「长文那一档已经拿掉」。我却把这条记成"未裁决"（§11.2、§11.8），于是没做。

两个失手是同一个机制：**我搬原型时问的是"这页该展示什么"，不是"已批准的产物上已经写了什么"。** 同一个错先前已经丢过 paste 处理器（第五轮）和分类管理（第六轮）；这次丢的是一条**删除项**——也正因此它能躲过截图复核：缺的功能看不见，缺的处理器看得见。

## 决定

- **长文档端到端删除。** `src/client/tab/DraftView.tsx`（236 行）、`readDraft` / `writeDraft` 两条 Remote、`DRAFT_FILE_NAME` 及其四个请求/结果类型、`CanvasTab.tsx` 里的 `page` 状态与 `[卡板 | 成稿]` 切换、`CanvasTab.module.css` 87 行、8 个 locale 键（**中英成对删**）、6 个测试。
- **内容角色的词表一起改，而且改过模型边界。** `src/client/locales.ts` 里 `kind.fragment` 碎片→灵感、`kind.grounding` 依据→共识、`kind.reference` 资料→来源；**同一批词在模型侧中文里也改**：`src/prompt.ts` 的主题段与 grounding 护栏句、`src/tools.ts` 两处 `kind 取值` 描述与 `source` 参数描述。只改 UI 不改 prompt 等于改了一半：Agent 会继续用板上已经不存在的词回答。
- **「卡板」这个词消失。** 它本来是个**视图名**，只剩一个视图就没有要命名的东西。指"板这一屏"的散文改用 板面（README）或 画布（Esc 提示——那指向用户实际看到的那个 tab）。
- **英文 kind 标签不动。** `Fragment / Grounding / Reference` 就是这套概念的源词；§10.7 判的是**中文**词不达意（「依据」读起来像证据，而 `grounding` 的意思是共同认识）。把中文的修法翻到英文，是为了治一个英文本来没有的病，还要赔掉那个准确的词。
- **`document` 保留。** §10.7 表里那行写「文档（随轴合并删除）」，而同一节的后几行写的是反话（内置 id 一个不删；默认目录 = 灵感/问题/共识/来源/文档）。删 id 会让 `normalizeCard` 下次读板时**丢掉每一张存量 document 卡**——用户板上正有一张 7,700 字的。做法是把那行**标注为被推翻**，不是悄悄改掉。
- **孤儿只记录，不迁移。** `$DSH_HOME/state/canvas/<id>/` 下已有的 `draft.md` 既不读也不删，两篇 README 各用一句话说清。卸载本来就承诺保留那个目录，所以改名背后偷偷删用户文件，是两个谎里更坏的那个。

## 考虑过的替代

- **切换器改名 `[卡片 | 长文]`、视图留着**——§10.7 的字面指示。否掉：更晚定稿的原型把长文那半划掉了，而且只有一个选项的切换器不叫切换器。
- **`readDraft`/`writeDraft` 留成空转以保兼容**——否掉。这个包自挂载、state 目录归自己，一个什么都不返回的动词是一块会撒谎的表面。
- **首次启动删掉 `draft.md`**——否掉：那是用户写的字，卸载契约说要留着，「功能没了所以你的文件也没了」不叫迁移。
- **把长文内容迁成一张 `document` 卡**——否掉，没人要。提案自己的证据是**从来没有任何模型侧工具写过那份稿**，所以盘上存在的都是手写的；悄悄重排一个人的文档，比留个孤儿更糟。
- **只改 UI 词表**——否掉，见"改过模型边界"那条。
- **顺手把 `canvas_propose_draft` 从路线图上删掉**——无物可删：它从未实现，`exportDraftToWorkspace` 同样只活在提案文本里。两条现在都写进 README 的「仍不做」，否则读者还会去那儿找它们。

## 后果

- **这是一次已发布 Remote 面的破坏性收缩。** `canvas/readDraft`、`canvas/writeDraft` 从生成的类型命名空间里消失。仓库内没有消费者，这条版本线也还没发过 npm，但树外消费者会断，而我们无从知道。
- **包里 `draft` 是个撞词，而且这个撞法现在是要命的。** 大约 70 处 `draft` 属于**另一件事**——「＋ 新卡」交给详情页的那张未保存草稿（`contract.ts` 的草稿卡成员、`CardPad.tsx`、`CanvasDetailView.tsx`、`draw.hintDraft`、丢弃确认）。谁在这里"顺手删掉 draft 代码"，就会废掉用户当天刚批的流程。三道围栏测试：`never lets a stray click create the card: the draft saves on ⌘ only`、`drops an untouched draft without asking, and guards a drafted one exactly once`，以及整个 `tests/detail.client.spec.tsx`。
- **`CanvasTab.module.css` 的 `.seg` 是一上来就死的，跟着删了。** 三个组件**并不共用**这张样式表——`CanvasDetailView` 与 `BoardView` 各自 import 自己的模块、各自有 `.seg`——所以当初保护它的那条"共享外壳"警告是错的。同文件的 `.spacer`、`.notice` 确实还在被 `CanvasTab.tsx` 用。
- **测试数 295 → 289**（−6，全是被删功能自己的用例）；`lib/client.js` **421.73 → 406.74 kB，gzip 90.14 → 87.37 kB**。
- **欠着的、现在点名欠着**：板卡 CSS 是 `canvas-card-styles.html` 的忠实移植，却是 `canvas-link-compose-draw.html` 的**分歧移植**。四条结构声明没搬过来：`.card{min-height:84px}`、`.foot{margin-top:auto}`（脚底钉住，一行卡的下沿才齐）、chips 横滚而非折行、选中 chip `font-weight:600`。**哪一页管样式、哪一页管交互，当时没对过**——所以这是要问用户的一条，不是我该悄悄塞进待办的。

## 测试

- `pnpm --filter @khorsheed/dsh-canvas build`——gen-typert 先重生成 remote 命名空间，客户端面的 `tsc` 才消费得到；这是删动词能过类型检查的唯一原因。
- `pnpm --filter @khorsheed/dsh-canvas test`——18 文件 / 289 绿；上面那三道撞词围栏按名字重跑过。
- `pnpm run check:plugins`——扫 39 包，0 项。
- `grep -rn "readDraft\|writeDraft\|DRAFT_FILE_NAME\|DraftView" packages/canvas/src packages/canvas/tests`——空。
- `grep -c "卡板\|成稿" packages/canvas/src/client/locales.ts`——0，连散文里也没有。
- 改名落在断言 UI 的地方：`tests/tab.client.spec.tsx` 现在点的是 `灵感` 和 `返回画布`。
