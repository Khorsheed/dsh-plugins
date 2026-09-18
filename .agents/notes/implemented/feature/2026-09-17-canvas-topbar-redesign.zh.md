# Agent Note: 顶栏重设计 —— 样式一个真源、去掉 v1 导入、菜单一个层级

Status: implemented

[English](2026-09-17-canvas-topbar-redesign.md) | 中文

## Problem

3080 上画布 tab 的顶栏一塌糊涂：切换器下拉以 in-flow 渲染、把 topbar 撑到菜单高度，「卡板|成稿 / ＋新卡」垂直悬在半空——「顶部导航太草率，信息传递和层级很混乱」。用户还给了两条内容决策：v1 导入能力可以去掉；菜单内的「画布 +新画布」标题行与 topbar 语义重复。

根因是一行：`CanvasSwitcher.tsx` 引用 `../space/board.module.css`，但它的三条定位规则（`.switcher`、`.switcherMenu`、`.switcherMenu .listBody`）住在 `../tab/CanvasTab.module.css`——任务切换器文件从未引用的死规则（CanvasTab 自己只为新卡菜单用了 `.switcherMenu`）。CSS Modules 把缺失的 class 变成 `undefined`：锚点与面板没有定位、没有 z-index、没有背景——一个 in-flow 块而不是浮层菜单。更深的教训是它来自的模式：一份共享样式表悄悄裂在两个文件里，class 的使用者与定义各奔东西，而构建时什么都不报错。

## Decision

**下拉原语一个真源。** `.switcher`（position:relative 锚点）、`.switcherMenu`（absolute 面板：`top: calc(100% + 6px)`、z-index 30、边框 + 圆角 + `bg-layer-3` + 阴影、`max-height: 70vh`、flex column）、`.switcherMenu .listBody`（`overflow-y: auto`）全部移进 `../space/board.module.css`——切换器真正引用的模块。CanvasTab 的新卡菜单改从同一模块取这个 class（注释写明原因）。`CanvasTab.module.css` 里的死副本删除，这个原语从此只有一个家。

**v1 导入端到端移除。** 一次性「导入 v1 灵感画布」流从每一层消失：切换器的 importBox JSX 与其 state、tab 的 `submitImport`、face 成员 `importV1`/`probeV1Pad`（contract + apply 接线）、Remote `importV1` 动词、`CanvasBoardService.importV1` 方法、`BoardImportV1Request`/`BoardImportResult` wire 类型，以及两本词典的全部 `import.*` 键。刻意保留的：v1 稿纸的五个动词（`list`/`read`/`create`/`write`/`setArchived`）与磁盘上的稿纸文件——稿纸是不动的存储，只是不再有迁移路径（用户判定其未用；若哪天又要迁移，M1 提交 `c56cc1ec` 有完整实现）。

**tab 名符其实。** `tab.label`：zh 画布详情 → 画布，en 'Card detail' → 'Canvas'（M1.5 的名字只描述了详情阅读器；这个 tab 是整个工作台）。

**菜单一个层级。** 冗余的「画布 +新画布」标题行删除。下拉现在是：活跃画布行（title + meta + 悬停归档钮）→ 已归档井（折叠、恢复）→ 底部「+ 新画布」行（点击展开内联创建表单：主题输入 + 挂载 checkbox + 创建/取消）。outside-click 与 Escape 关闭照旧；topbar 行本身不变（`[switcher][attach chips][spacer][卡板|成稿 seg][＋新卡]`）。只读模式不再禁用创建按钮而是整行隐藏——禁用的按钮是页面兑现不了的承诺，缺席的行才说实话。

## Alternatives considered

### 为什么不把下拉样式复制进两个模块？

这正是 bug 的出生方式：两个家，一个陈旧。CSS Modules 在构建时不报 undefined-class 错误，所以复制的原语是带定时器的 bug。一个真源，非切换器的菜单显式引用它——本改动同时为本包未来的下拉立下这条规矩。

### 为什么不用开关保留导入流而是删除？

隐藏的能力也是代码、测试、动词与词典的存续成本，为一个用户已说未用的路径。移除是一条直线（删除），历史里有完整实现（`c56cc1ec` 宿主、M2.5 时代的切换器 UI），而未来若有迁移需求也是新设计——M4 的会话侧索引（`canvas_search`/`canvas_clip`）以不同于一次性复制的方式触达 v1 内容。

### 为什么只读时隐藏创建行而不是禁用它？

禁用的「+ 新画布」说的是「你可以，如果……」——那个「如果」是「先打开一个会话」，而这行字帮不上忙。隐藏后菜单只是说实话：在有会话之前这里没有可做的事。禁用态测试相应改写。

## Consequences

- `packages/canvas/src/client/space/board.module.css`：迁入下拉原语、新增 `.newCanvasRow`、`.formNote`（由导入时代的 `.importNote` 改名）；删 `.importBox`。`packages/canvas/src/client/tab/CanvasTab.module.css`：死副本规则删除。
- `packages/canvas/src/client/tab/CanvasSwitcher.tsx`：单层菜单、删导入流、删标题行。
- `packages/canvas/src/client/tab/CanvasTab.tsx`：删导入流；新卡菜单从 board 模块取 `switcherMenu`。
- `packages/canvas/src/client/{contract.ts,index.ts}`、`src/{remote.ts,store.ts,types.ts}`：importV1/probeV1Pad 表面移除（动词、方法、wire 类型、face 成员）。`src/client/locales.ts`：`tab.label` 改名、`import.*` 键删除。
- 测试：删 importV1 describe（board.spec）、动词断言（remote.spec）、切换器导入测试与 mock（tab spec）；只读测试随整行隐藏改写。**164 个测试全绿**（M3.1 的 167 之上净 −3 例）。
- [M1 note](2026-09-16-canvas-space-m1.md) 的 importV1 记录由本篇取代（交叉链接）；稿纸与其五动词保留。
- 版本保持 0.4.1（打磨波次、线上只删一动词——下个发布清单注一笔）。

## Testing

- `packages/canvas`：**164 个测试全绿**。`rm -rf lib` 后 `pnpm --filter @khorsheed/dsh-canvas build`、`pnpm check:hygiene -- packages/canvas`、`pnpm check:plugins`、`pnpm test:scripts` 全绿。
- CSS 修复按构造验证（class 现在在切换器引用的模块里解析）——3080 视觉复验随部署流程。

## Deferred

- 全包做一次「class 的使用者引用定义它的模块」排查（这是唯一一处跨模块引用组件 class）。
- 若哪天想触达 v1 稿纸内容，归 M4 的索引设计，不是复活一次性复制。

## Related

- [M1 note](2026-09-16-canvas-space-m1.md)（本篇移除的 importV1）。
- [M3 note](2026-09-16-canvas-rightbar-rework.md)（这个顶栏所属的 tab）。
- [M3.1 note](2026-09-17-canvas-m3-1.md)（顶栏时代的上一次修正）。
