# Agent Note: 文件列表与工作树共用一个内容面板

Status: implemented

## Problem

社区里两个文件表面用着两份正在分叉的实现渲染同一件事。`@khorsheed/dsh-local-files`（右栏「文件列表」卡片）是 2026-08-28 从 `@khorsheed/dsh-worktrees` 拆出来的（提交 `3df30448`，提案 `2026-08-26-local-files-browser`），拆分之后只有 local-files 在继续走：滚动位置记忆（`28f8d645`）、官方 open-in-app 手势（`a274514f`）、渲染态内容搜索（`169d3a1c`），而工作树的预览面板冻结在拆分那天（`16d56021`，host 0.1.2 适配）。结果是四处用户一眼能看见的不对称——工作树面板没有 per-file「打开目录 / 在 IDE 中打开」；文件列表面板没有 markdown/JSON/CSV 的「源码⇄预览」切换；工作树的 HTML 只有静态档（含脚本的页面死住且无任何说明），并且用自写的元素级 margin 去打官方 markdown 样式表；它的 JSON/CSV 预览按聊天字号渲染、没有区块外框。重复还已经付了真金白银：工作树里那份 277 行的文件浏览器分叉，唯一入口早在 `ea531c4b` 就被删除，却带着两个活着的缺陷（选中行永不回亮、`css.treeEmpty` 这个类根本不存在）、一份被复制过来却没带测试的 HTML 管线，以及全仓第 4 份沙箱 `srcDoc` 构造器。

## Decision

新增一个纯客户端包 `@khorsheed/dsh-client-ui-content-preview` 持有内容面板；两个插件在**源码面**消费它，由 tsdown 把它内联进各自的 `lib/client.js`。

- **包形态。** `dsh.composition.component: "source-plane-library"`——它不注册 slot、service、locale，也没有自己的 loader row 和 client bundle。每个消费方把它声明为 workspace 依赖并直接 import `@khorsheed/dsh-client-ui-content-preview/src/client/index.ts`，因此两个插件都不新增运行时依赖，卸载任一个都不影响另一个。形状沿用已被 sanction 的 `canvas → inline-html-render` 边（编译期 helper、零运行时耦合）。
- **内核持有契约，消费方持有映射。** `PreviewRead` 是内核的 kind 联合（`text` 带 `truncated`/`htmlScripted`、`image`、`binary`、`missing` 带 `reason`、`too-large`、`error`）。每个插件只保留一个适配模块 `src/client/preview.ts`：把自己的 wire 类型映射进来、用自己的字典构造 `StructuredLabels` 与 `PreviewTranslator`、把仓库相对路径解析成绝对路径。将来退休这个内核，改动就是这一个文件加一行 import。
- **内核不持有任何 locale 命名空间。** 消费方继续注册自己的字典；面板通过 `(key, params) => string` 打印，键的类型是 `PreviewKey` 联合，并且每个包都有一条测试断言 `PREVIEW_KEYS` 的每一项在本包的 `zh` 与 `en` 字典里都能解析。
- **统一取并集，不取交集。** 两个表面现在都有 markdown/JSON/CSV 的「源码⇄预览」切换（原属工作树）、HTML 三档切换 + 一次性确认 + 静态「脚本未执行」提示 + 全屏 + 卡顿看门狗（原属文件列表）、保留渲染态并有诚实降级的内容搜索，以及 per-file 的复制路径、复制内容、打开目录、在 IDE 中打开（复制这一类保留两个表面各自的语义：文件列表复制路径，工作树复制内容）。
- **不归内核的事。** 文件树、数据面（Remote、store、根目录选择）、tab 注册与模式可见性留在各插件；diff 与提交对比经 `diffView` render prop 传入（内核始终不知道 git 是什么）；工作树的未跟踪说明走 `notice`；工作树的图片放大器走 `imageView`。
- **Markdown 口径，写成机械规则。** 内核只覆盖 `--dsw-font-markdown-*` 字号 token，绝不覆盖官方 `.markdown` 上任何元素级 margin/padding；每个渲染形态（markdown、JSON 树、CSV 表）都在同一 token 作用域与同一区块外框内。工作树原先攒下的那批元素级 override 是**删掉**，不是搬过来。

## Package topology

三处登记都在 `scripts/check-plugin-independence.ts`——一个 mainline 维护的共享文件——且**只登记、不新增逻辑**：`COMPOSITION_COMPONENTS` 增加 `'source-plane-library'`（与那些 row 型取值刻意区分，避免「没有 patch」被读成「有别的 patch 会挂载它」），`NO_OWN_PATCH` 交叉校验表增加 `ui-content-preview`，`ALLOWED_EDGES` 增加 `local-files → content-preview` 与 `worktrees → content-preview`。`docs/packages.md` 用 `pnpm map:packages` 重新生成。

本次改动之后全仓的重复度：沙箱 `srcDoc` 构造器 4 份 → 2 份（内核 + `inline-html-render`），能力桥 3 → 2，内容面板 3 → 2（内核 + `ui-file-preview` 的 `FilePreviewPane`），open-in-app 探测及其 IDE/文件管理器候选表 2 → 1。

## Retirement path

`@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 已经有 `ctx.documentPreviews` 注册表与 markdown/code/html/image/pdf 渲染器，且它的 HTML 渲染器能经 workspace-files Remote 把相对的传统 `<script>`/`<link>` 依赖打进隔离文档——这是 `base-uri 'none'` 下的 `srcdoc` 面板做不到的。今天无法内联复用的原因是两条**契约**事实、不是能力问题：官方包不导出可复用组件（入口只导出 `apply()`），而 `sidebar.right.tab.document` 对自身的注册是「声明即独占」（ui-slots：*declaring is claiming*），插件自有面板装不进去。等官方导出可复用文档渲染器（或给第三方面板开放可渲染的 slot），这个内核就退化为 adapter 并被删除，相对资源解析能力也一并交还官方渲染器。

## Alternatives considered

**让工作树直接 import local-files 的组件。** 否决：跨包边本来就要在 `ALLOWED_EDGES` 里显式登记，而且这会把共享实现放进它的一个消费方体内——归属错了，还让第二个消费方的构建依赖第一个的内部文件布局。

**直接用官方文档渲染器内联。** 今天否决，原因即上面两条契约事实；硬上的话只能「跳到官方文档 tab」，会失去两个表面赖以存在的「树 + 预览同屏」。这条被记为**退休触发条件**，而不是被无视。

**把内核放进 `inline-html-render`（仓库里既有的「共享渲染包」）。** 否决：那个包持有的是 agent 生成 HTML 卡片的作者协议，文档预览内核是另一套词汇、另一条 minHost 底线；canvas 共享它 `srcDoc`/桥 helper 的那条边不受影响。

**把缺的能力补进工作树、保留重复。** 否决：那会造出第三份面板拷贝。仓库其实早就把这写成待办——拆分 local-files 的提案里写着「共享预览层抽提是后续可能的优化」——而 canvas 那条 note 更直接假定这个共享渲染包已经存在。

**让工作树里那个不可达的本地文件浏览器原样留着。** 否决：它是死代码，带着两个活缺陷，还是某个已经独立成包的浏览器的私有拷贝；它的 host 面 Remote 方法先留着（见 Deferred），但那个表面、它的 store、它的 local-root 记忆和 controller 钩子都已删除。

## Consequences

买到：两个表面共用一份实现；三处用户可见的不对称在一次改动里关掉；untracked 切换与 iframe 高度这两个缺陷随「用同一个面板」自然消失；死抽屉、它的两个 bug 及其私有浏览器状态被删除；共享 HTML 管线终于有了它一直没有的测试。

付出：工作区里多一个包（消费方把它写在 `devDependencies` 而**不是** `dependencies`——pack-dist 会把运行时边改写成注册表范围，未发布的内核满足不了，而部署流程又拒绝把非 self-mount 包当部署目标；写 devDependency 同时也是诚实的字段，因为 tsdown 在产物出厂前就把内核内联掉了）；对 mainline 维护的 checker 文件做了一次刻意登记；内核样式随消费方的 client bundle 一起走，所以改内核样式要重建消费方而不是重发内核；两个表面必须让字典跟上 `PREVIEW_KEYS`——新增的键完整性测试把这件事从「静默显示英文键名」变成「测试失败」。

## Testing

内核自带 48 个测试（沙箱 `srcDoc` 构造与 CSP 注入、桥校验、渲染态内容搜索及其降级、结构化预览解析、open-in-app 探测，以及 11 个验收级面板测试：源码切换、HTML 档位与确认、手势显隐、非文本占位、差异口）。每个消费方另加一份 `preview-adapter` 测试，断言本包字典能解析 `PREVIEW_KEYS` 每一项、wire kind 联合映射不丢 deleted/unreadable 分支。`local-files` 26 tests、`worktrees` 77 tests、`pnpm check:plugins` 与 `pnpm gate` 全绿。

## Deferred

- `ui-file-preview` 的 `FilePreviewPane` 是剩下的第三份面板拷贝；迁移它是提案的 M4。它的 IDE 分体按钮（带 app 菜单与 app 名）比内核目前的单按钮更强，所以迁移必须把这能力并进内核，而不是丢掉。
- `worktrees` host 面的本地文件浏览器方法（`listLocalDirectory`/`readLocalFile`/`readLocalImage` 及其 Remote schema）随抽屉一起失去了客户端调用方；它们仍有测试覆盖，但已是死重，应在一次 host 面清理中删除。
- 与官方 HTML 渲染器之间的相对资源差距依然存在：2026-08-21 的裁决「`srcdoc` 面板不解析相对资源」不变，现在也写进了内核 README。

## Related

- `proposals/active/2026-09-23-preview-kernel.md`——本次交付所依据的能力清单 A–H，以及退休路径。
- `proposals/active/2026-08-21-file-view-html-rendering.md`——Tier0/Tier1 HTML 渲染能力的提案，本内核承接其产物。
- `proposals/closed/2026-08-26-local-files-browser.md`——它推迟的「共享预览层抽提」由本次完成。
- `.agents/notes/implemented/feature/2026-09-18-canvas-html-cards.zh.md`——已经假定共享渲染包存在的那条 note。
