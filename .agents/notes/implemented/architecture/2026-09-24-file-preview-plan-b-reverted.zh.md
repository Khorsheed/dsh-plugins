# Agent Note: 方案 B 回退——ui-file-preview 两条宿主线上都保持自绘产物页

Status: implemented

## Problem

方案 B(2026-09-24 以 `2fdc81ad` 落地,记录见[官方文档页 note](2026-09-24-file-preview-official-document-pane.md))把
ui-file-preview 的内容面搬进了 rc.1 官方 document tab:共享内容面板以 extension 档注册进
`ctx.documentPreviews` 成为该 tab 的默认渲染器,自建 FilePreviewTab 页类型在该线退役。二期
(`ada7ac89` / `2dee4958`,记录见[二期 note](../feature/2026-09-24-artifacts-phase-two-headless-shadow-shell.md))随后把面板无头嵌入以消除框架
chrome 叠加、遮蔽官方 deliverables 回合卡、并以 file-artifacts 薄列表壳恢复了会话产物入口。在
rc.1 实例上实测组装结果后,仓主同日否决了整个嵌入方案:

- 接缝成本真实且永久:渲染器自持加载协议(`loading: 'renderer'` + revision /
  `loaded(version)` / `failed()` 结算)、extension 档接管默认渲染的语义、headless 布局耦合,
  全都把我们的面板绑死在官方框架的内部细节上——上游每动一次那个框架就是我们的破损点。
- UX 妥协是纯亏不是交换:改动记录(本包存在的理由)被降格进 document tab 的渲染器下拉,
  复制路径手势退化成压在搜索行上的浮动钮。
- 自绘页的路由根本不需要官方框架:tab 类型地址认领(`patterns: dsh-resource://file/**` +
  静态后缀收口,extension 档)在两条宿主线上都压过官方 `text` 类型的 fallback 档——rc.1 的
  tab registry 保留了 band 机制——文件点击零嵌入接缝地落进我们全 chrome 的页。

## Decision

方案 B 与二期整体回退;两条宿主线发同一形态:

- `file-preview` 页类型**无条件注册**(不再有 `documentPreviews` 探测与延迟退役 fiber):
  向导页入口 + extension 档 `dsh-resource://file/**` 可渲染后缀认领,本体进 keyed
  `sidebar.right.pane.tab` seat。文件树、mention(经包装)、回合卡、产物行全部路由到详情
  页;decline 的后缀(pdf、压缩包、二进制)落回官方 document tab。
- 删除:`FileContentBody.tsx`、`FileHistoryBody.tsx`、`FileArtifactsTab.tsx`、
  `content-definition.ts`、`artifacts-definition.ts` 及各自 spec;`history-definition.ts`
  把存活的认领收口(`RENDERABLE_EXTENSIONS`/`renderablePath`)并入 `definition.ts`。
  官方 tab 下拉里的改动记录渲染器(方案 B 之前就存在的接缝)随否决一并退役——改动记录重新
  只活在页内详情视图。「会话产物」入口回到产物页本身,薄列表壳不再单独存在。
  manifest 摘掉 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` / `dsh-client-resources` /
  `dsh-api-workspace-files` 三面。
- 共享内核的 `headless` 模式整体退役(prop、渲染分支、`rootHeadless`/`copyFloat` CSS、spec
  块)——它唯一的消费者就是被否决的嵌入;local-files 与 worktrees 从未用过它。
- **不**回退:turnTail 的 deliverables 遮蔽(list 槽宿主上官方 present/changes 卡仍让位于我
  们的持久全量行——否决只针对嵌入)与 FilePreviewTab 读 `navigation.params.path` 的
  `'path' in` 收窄修复(真实的预存 bug 修复)。
- minHost 保持 `0.1.5-rc.1`:回退后包内没有 rc.1 专有 API(turnTail 的 list/chain 双臂本就
  带 0.1.5 回退)。

## Alternatives considered

- **保留方案 B 继续补缝**(二期的轨迹)——否决的要点在于接缝数量是结构性的而非增量式
  的:每修一处叠加就更紧地绑上框架内部(headless 布局、加载协议),而改动记录的下拉降格根
  本无解。
- **恢复产物页的同时保留 file-artifacts 薄壳**——冗余:恢复的页本身就是会话产物清单加详情
  视图;再发一个只读列表入口没有路由收益。
- **官方下拉里保留改动记录渲染器**——它正是否决点名的降格的入口楔子,其注册也是又一条
  documentPreviews 接缝;详情页的「内容 / 改动记录」切换以更好的 chrome 承载这个维度。
- **删掉被回退的 notes**——改为加批注保留作历史记录并各自链接到这里;它们记录的机制证据
  (slot 遮蔽语义、Config 开关不存在)仍然为真、可复用。

## Consequences

- 两条宿主线重新只有一份表面形态:没有双线探测、没有嵌套退役 fiber、包内没有 rc.1 专有代
  码。
- 官方 document tab 只见我们 decline 的后缀;其余全部在我们页内以完整 chrome 渲染(标题栏、
  视图切换、内容搜索、复制/文件夹/IDE 手势)。
- turnTail 遮蔽按当初选择它的证据继续成立;turnTail 为 chain 槽的宿主(0.1.5)保持抢占臂。
- 内核回到恰好一种 chrome 模式——`headless` prop 不复存在,没有消费方能漂移进去。
- 跟踪上游不变:改动记录维度官方无对应物(workspace-changes 内存态、git-only、重启即失);
  官方若日后发布持久的同等物,再评估退役。

## Testing

- `ui-file-preview` 的 browser-plugin spec 回到单形态台架:tab 类型认领语义、本体注册、回合
  行加 deliverables 遮蔽(账册共存、`entriesOfSlot` 赢家、空体)、chain 回退与完全卸载;rc.1
  臂的 spec 文件随其主体一并删除。
- `ui-content-preview` 的 headless describe 块随该模式删除;既有 52 测试原样通过。
- 仓级闸门:`pnpm run build`、`pnpm run test`、`check:plugins`、`test:scripts`、
  `check:hygiene --all` 在回退后的树上全绿。
