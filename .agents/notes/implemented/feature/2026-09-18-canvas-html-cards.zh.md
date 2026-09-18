# Agent Note: 画布 0.4.3 —— HTML 卡进沙箱渲染；格式是内容的属性，不是卡种

Status: implemented

[English](2026-09-18-canvas-html-cards.md) | 中文

## Problem

一张 3080 截图把问题摆实了：一张 8000 字的资料卡装着完整 HTML 文档，卡板和详情都把标记原文当纯文本显示——读不了，还把卡撑爆。提案 §8 一直想让画布兼作渲染器（markdown 与粘贴的 HTML 都要），但此前 HTML 没有任何渲染路径。

两个设计问题决定了这一刀。**HTML 要不要新卡种？** 不要——格式是内容的属性，不是卡种：资料卡可以装 markdown 也可以装 HTML，把格式绑到卡种会让 v1 导入的文档（md 文件）与粘贴的 HTML 假装卡种不同，而它们只是格式不同。**检测要多保守？** 带内联 HTML 的 markdown 卡必须仍是 markdown——失败方向永远是「漏判真 HTML」，绝不是「把正文送进沙箱」。

## Decision

**格式检测是 `src/card-format.ts` 里的纯函数、保守启发式。** `detectCardFormat`：整文档（`<!doctype html>`、`<html>`、`<head>`、`<body>` 开头）永远命中；片段只在「通体是标记」时命中——以 `<` 开头、以 `>` 结尾、至少两个开后有合的标签对、没有任何行级 markdown 块标记（标题/列表/引用/围栏）、且不是正文里夹的内联标签。其余一律 markdown。`htmlTitleOf` 提取 `<title>`（解码基础实体、裁长度）作显示标题。

**详情页的 HTML 走严格沙箱 iframe。** 渲染面板在卡为 html 格式时换成 `HtmlFrame`：`srcDoc={buildCardSrcDoc(text)}`（卡级 CSP：断网、禁导航、仅内联脚本）+ `attachBridge(frame)`（链接/复制/报高），disposer 进 effect cleanup，frame 按卡 id 设 key（切卡干净重挂）。并列模式 iframe 与源码 textarea 并排；源码模式不变（原文、编辑、⌘⏎ 保存）。头部 meta 增低调的 HTML 格式小标。markdown 卡行为完全不变。

**卡板显示紧凑占位，绝不显示标记原文。** html 卡的摘要 = 代码图标 +（`<title>` 派生的标题或本地化「HTML 文档 / HTML document」）+ 字数标。点正文开详情与悬停勾选框不变。文档卡标题启发式不再误伤 HTML（html 的文档卡标题取自 `<title>`，绝不是 doctype 开头行）。

**渲染 helper 经源码面引入，零运行时耦合。** `buildCardSrcDoc`/`attachBridge` 从 `@khorsheed/dsh-inline-html-render/src/client/*`（该包的 `./src/*` 出口）导入；tsdown 把它们打进画布的 `client.js`——构建产物带 bridge 与 CSP 字符串，且**不含**对该包的任何运行时引用（打包冒烟验证：`lib/client.js` 里无 `@khorsheed/dsh-inline-html-render` 的 require/from）。渲染包不安装也不影响画布。跨包边按 checker 自己的处方登记：`scripts/check-plugin-independence.ts` 的 `ALLOWED_EDGES` **刻意**新增 canvas → inline-html-render 条目（注释记明仅编译期），`package.json` 带 `workspace:*` devDependency。`pnpm check:plugins` 与其 spec 保持绿。

## Alternatives considered

### 为什么不新增 `html` 卡种？

卡种回答「这张卡是干什么的」（碎片/问题/依据/资料/文档）；格式回答「内容用什么记号」。从 markdown 粘贴的文档卡与从 HTML 粘贴的文档卡是同一种。新卡种会为一个渲染器关切劈开所有按 kind 筛选的面与 stats 词表——而 M4 的成品方向（文档卡的 renderer 是若干输出形态之一）恰恰就是格式-非-卡种。

### 为什么不手写沙箱而非复用 inline-html-render？

CSP-in-head 的讲究（srcdoc 没有可依赖的 CSP 继承）、片段与整文档的两种包法、opaque-origin 沙箱、bridge 的校验式消息处理，全都微妙且在那个包里已测。复制它们等于分叉一条安全边界；源码面导入保持单一实现且零运行时耦合。

### 为什么不用 HTML parser 检测而非正则？

为一条热的渲染路径引入 parser 依赖（或 DOM）是用重型答案回答一个是非题，而且 parser 的容错方向恰好错（它接受残缺标记，于是带尖括号的 markdown 正文也能「parse 出」文档）。启发式的职责是便宜的保守门；它说是，沙箱接手。

## 同波次追加（256KB 上限 + 指针边界）

3080 的首次渲染实测立刻暴露了相邻缺陷：粘入的完整 HTML 文档被静默截断在 8000 字卡上限——数据级丢失，用户在截图里亲眼看到。同版本同波次：

- `MAX_CARD_TEXT_LENGTH` 8000 → 256_000（注释记明理由：整板 `canvas.json` 读写下几十张 256KB 卡仍是毫秒级；真正的 `assets/` 落盘存指针是 M4 项）。`MAX_COMMENT_TEXT_LENGTH` 保持 4000。
- 提案 §8 边界从「写明」落到「执行」：`promptFormOf`（新，在 `prompt.ts`）是唯一的模型面形态——HTML 卡是指针（标题 + 字数 + 卡 id +「需要内容请用户粘贴节选」），markdown 卡带 4000 字上限 + 截断注记。所有把卡文本喂给模型的路径同走它：`cardToRef`（透镜/提问引用）、板摘要的 `summaryOf`（html 卡显示显示标题，绝不是 doctype）、grounding 护栏列表。
- 详情滚动容器底部 padding 40px → 64px，正文尾部与评论框/瞬时浮层保持空隙（疑似 composer 遮挡排查过：我们的评论框是 in-flow 且根容器本有 padding——这一行是保险，截图里的浮层是宿主自己的 composer）。
- 测试：cap 边界（256_000 完整落地、256_001 截断）、html 引用零正文泄漏断言（无 `<!DOCTYPE`、无 `<table>`、无正文词）、markdown 截断注记、grounding 段指针。

## Consequences

- `packages/canvas/src/card-format.ts`（新）：`detectCardFormat` + `htmlTitleOf` + `MAX_HTML_TITLE_LENGTH`（+9 个 spec 例：整文档、片段、md 内联 html、普通 md、纯文本、空串）。
- `packages/canvas/src/client/detail/CanvasDetailView.tsx`：`HtmlFrame`（沙箱 + bridge + 按卡 key 重挂）；渲染/并列面板为 html 选它；头部 meta 显示 HTML 小标；文档卡标题在 html 时取自 `<title>`。
- `packages/canvas/src/client/space/BoardView.tsx`：`CardSummary` 的 html 占位（图标 + 标题 + 字数）。
- `packages/canvas/src/client/locales.ts`：`card.htmlDocument` + `detail.formatHtml`（双词典）。
- `packages/canvas/package.json` 0.4.2 → 0.4.3，devDep `@khorsheed/dsh-inline-html-render` `workspace:*`。`scripts/check-plugin-independence.ts`：`ALLOWED_EDGES` 刻意新增 canvas → inline-html-render 条目（注释记明仅编译期）。
- 卡数据模型与全部 Remote 动词未动——格式绝不落盘，渲染时派生。
- 3080 截图里那张 8000 字资料卡：详情页成文档渲染，卡板成一行占位。

## Testing

- `packages/canvas`：**188 个测试全绿**（186 之上 +2 个 UI 用例）：详情 spec 增沙箱 iframe 例（sandbox 属性、srcDoc 内含 CSP、内容保留、原文绝不作为文本渲染）；tab spec 增卡板占位例（标题显示、标记缺席）。`card-format.spec.ts` 覆盖启发式矩阵。
- 对构建产物的真 HTML 冒烟：带 `<title>`、外链图、内联 script 的文档内容保留、`<head>` 后即注入严格 CSP meta、bridge 在位——且 `lib/client.js` 含打包后的 helper、对渲染包零运行时 import。
- `rm -rf lib` 后 `pnpm --filter @khorsheed/dsh-canvas build`、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts` 全绿。

## Deferred

- 粘贴即建卡（`text/html` → document 卡）与大 HTML 的 `assets/` 落盘、源码模式的 html 高亮、会话侧检索工具——M4。
- 详情 html frame 没有工具条（重载/外部打开）；若要，归共享渲染包，不归画布。

## Related

- [顶栏 note](2026-09-17-canvas-topbar-redesign.md)（本次渲染落进的当前 tab 结构）。
- [M1.5 note](2026-09-16-canvas-space-m1-5.md)（摘要/详情分工；html 资产的完整渲染器仍按该篇记录留 M4）。
- 画布提案 §8（本篇实现的渲染器方向）。
