# Agent Note：面板规范 P1——文件预览与文件列表的紧凑排版，AdaptiveSplit 迁入 panel-kit

Status: implemented

## Problem

手机上文件预览正文前有五行控件（文件列表面包屑、「返回文件列表」、文件名加四个图标、完整路径、预览/源码框式切换、搜索框），markdown 外面还包一层带「markdown」标签的卡片；文件列表有面包屑和树标题两行、六个图标，文件名是次级灰。列表/详情布局 `AdaptiveSplit` 放在预览内核 `ui-content-preview` 里，但它是面板层布局。

## Decision

- **AdaptiveSplit 迁入 ui-panel-kit**（含样式、测试、独立样例），ui-content-preview 不留转发；只有 local-files、worktrees 两个使用方，改 import。窄判断由 `< 560` 统一为 `≤ 560`（与 `PANEL_COMPACT_MAX` 和 CSS `max-width: 560px` 一致）。新增 `backInDetail`：详情自带标题栏时，分栏不再画整行返回，改由详情通过 `useAdaptiveSplitBack()` 把返回画进自己的标题栏，焦点仍由分栏移过去。
- **ContentPane 标题栏换成 `PanelHeader`。** 宽面板两行：标题栏（返回、文件名 + 语言标签、最多 4 个图标）＋路径行（路径在左，一行下划线标签在右）。紧凑面板（外层 `PanelRoot` 的宽度，没有时取自身宽度，≤ 560）只两行：标题栏（搜索、重新加载常显；完整路径作为「…」的第一行信息、复制、在文件夹中显示、IDE 进「…」）＋标签行。改动/内容、预览/源码、HTML 档位合成同一行 `UnderlineTabs`；脚本档仍需确认条。多个 IDE 时每个 IDE 是「…」菜单一行，原分裂按钮取消。紧凑时搜索行收成图标，有查询时保持展开，Esc 先清空再收起；结构化文档去掉格式 banner 外框，正文用满宽度。
- **阅读区字号读面板变量。** `.structuredBody` 的 markdown 正文改为 `var(--dsh-panel-text-reading, 14px)` / `var(--dsh-panel-reading-line-height, 1.65)`；触屏紧凑时标题 22/19/17。mobile 的 `styles.ts` 在 `html[data-dsh-mobile]` 上覆盖 `--dsw-font-markdown-base*`，但 `.structuredBody` 本地重新定义了这些变量，原先就把预览压回 14px（手机上预览字小的原因之一）；现在本地定义改读面板变量，mobile 设置的触屏值得以生效，两处不再打架，mobile 那几行不用改（它们仍服务于聊天区）。
- **文件列表（local-files）。** 根节点换成 `PanelRoot`（`dsh-panel` 容器取代原 `file-workspace`）。宽：标题栏标题是原面包屑，右侧四个工作区操作。紧凑：一行标题栏，标题为当前目录名、附注为上级路径（家目录缩成 `~`），搜索与「上一级目录」常显，选择工作区、退回原始工作区、在文件夹中显示、刷新、显示/不显示隐藏文件进「…」；树自己的标题条隐藏（`FileTree headerless`），搜索行照常展开；打开文件时列表标题栏让位，只剩预览的标题栏（带返回）。文件名一律主色、字号读 `--dsh-panel-text-body`；紧凑时选中为强调色浅底；触屏行高 44。
- **worktrees** 根节点包一层 `PanelRoot`，让 ContentPane 按整个标签页宽度而不是详情列宽度决定紧凑与否。
- 新增文案键：预览内核 `action.more`、`detail.views`（三个使用方中英都补）；local-files `local.goUp`、`local.showHiddenFiles`、`local.hideHiddenFiles`。`action.chooseIDE`、`preview.htmlToggle`、`preview.htmlScriptStop` 不再被渲染，暂留在键表里，避免牵动三个使用方。

## Alternatives considered

- **紧凑判断只看 ContentPane 自身宽度。** 否决：桌面宽面板里详情列常窄于 560，会让桌面也收起路径、退化。外层有 `PanelRoot` 时按面板宽度判断。
- **宽面板也把搜索收成图标。** 否决：桌面多一次点击，属于把操作藏深。
- **紧凑时保留树的「展开/收起全部」。** 未做：它是树内部状态，挪进标题栏要把状态上提；手机上有搜索替代，留到有需要再说。

## Consequences

- 截图自查（390 深浅两色、桌面 960）见汇报，不入库。
- 三个使用方的 ContentPane 外观一起变化（file-preview 的会话产物页也是）；它们的测试改为按 tab / ⋯ 菜单查找控件。
