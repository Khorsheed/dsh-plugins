# @khorsheed/dsh-client-ui-panel-kit 完整参考

> 面向开发者的完整说明：字号变量、各组件的行为与用法。2026-10-26 前它是本包的 README；面向用户的简介见 [README](../README.md)。

[English](reference.en.md) | 中文

> **内部源码面库，不发布。** 本包标记 `private: true`，只在构建期被各插件内联，运行时从不单独存在。

社区插件面板的共享底座：一套带桌面默认值的字号变量、一个声明容器宽度的面板根节点，以及每个面板都会用到的紧凑控件。目标是让每个插件**只写一套界面**，按自己拿到的面板宽度自适应——桌面拖窄的侧栏、浮窗和手机用的是同一份代码。规范见提案 panel-responsive-spec（2026-10-06）。

**这不是插件。** 它不注册 slot、service、locale，没有自己的 loader row 和 client bundle。各插件把它声明为 `workspace:*` 依赖，直接 `import '@khorsheed/dsh-client-ui-panel-kit/src/client/…'`，各自的 tsdown client bundle 把它内联进自己的 `lib/client.js`。零运行时耦合，各插件仍然各自可独立安装、独立卸载。

## 内容

- **字号变量**——`--dsh-panel-text-title`（14）、`-body`（13）、`-meta`（12）、`-reading`（14）、`--dsh-panel-reading-line-height`（1.65），括号内是桌面默认值。本包**从不定义**这些变量，只以带默认值的形式读取（`panelVar('body')` → `var(--dsh-panel-text-body, 13px)`）。装了 `@khorsheed/dsh-mobile` 时，它在触屏上把这些值调大；没装时面板保持桌面字号。插件不依赖 mobile。
- **`PanelRoot` / `usePanelCompact`**——面板根节点声明 `dsh-panel` 尺寸容器，插件 CSS 写 `@container dsh-panel (max-width: 560px)` 即可进入紧凑排版；需要改变结构（而不只是样式）的组件通过同一宽度判断读紧凑状态。
- **`PanelHeader`**——返回（可选）、标题、附注，加一排按优先级排列的图标操作。紧凑面板最多显示 2 个，宽面板最多 4 个，其余收进「…」（宿主 `Menu`）；全部放得下时不出现「…」。
- **`UnderlineTabs`**——与 mobile 面板标签同款的下划线分段切换（选中加粗、2.5px 强调色下划线），方向键 / Home / End 漫游焦点并跳过禁用项；每个 tab 可带 `badge`（画在标签旁、不在下划线下），`trailing` 把这一行的「…」或布局切换放进同一行、共用一条底边线；触屏下高 44px。
- **`ChipRow`**——单一样式的筛选 chip：选中强调色浅底，未选描边；可选计数与色点；整行横向滚动，永远一行高；`tools` 放这一行的图标按钮，固定在右侧、不随 chip 滑动。
- **`ListRow`**——图标、主色标题、附注、右侧尾部；选中为强调色浅底；有 `onSelect` 时是按钮。
- **`AdaptiveSplit`**——保留挂载的列表/详情布局（P1 从 ui-content-preview 迁入）：宽时并列，宽度 ≤ 560px 时详情打开即替换列表，返回回到原样的列表。详情自带标题栏时设 `backInDetail`，用 `useAdaptiveSplitBack()` 把返回画进自己的标题栏，窄屏少占一行。仓库根运行 `node packages/client-ui-panel-kit/examples/adaptive-split/serve.mjs` 可看真实组件配合模拟数据的独立预览。
- **`browserOnHost()`**——页面是否在宿主电脑本机打开（地址为 localhost / 127.0.0.1 / ::1；读不到地址时按本机处理）。会在宿主上打开程序的操作（访达、IDE、原生目录对话框）在远程访问时应隐藏（2026-10-06 从 ui-content-preview 迁入）。

`PanelHeader` 的操作可标 `pinned`（常显）、`menuOnly`（只进「…」，如完整路径这类信息行）、`pressed`（开关的按下态）；`PanelRoot` 的子节点可以是函数，拿到当前紧凑状态。

颜色只用宿主的 `--dsw-alias-*` 变量，深浅主题自动跟随；触屏（`pointer: coarse`）下列表行至少 44px、图标按钮 40×40。

## 使用

```ts
import { PanelRoot, PanelHeader, UnderlineTabs, ChipRow, ListRow, panelVar } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
```

文案由调用方提供：本包不持有 locale 命名空间，所有可见文字和无障碍名称（`moreLabel`、`backLabel`、各操作的 `label`）都由调用方传入。

## 安装

**不作为插件安装。** 它没有可挂载的行，`dsh plugin add` 它不会产生任何效果。它在构建期随消费它的插件一起到达。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——唯一的官方运行时导入是 ui-primitives 的 `Menu`（「…」菜单），0.1.5-rc.1 线已提供，与 ui-content-preview 相同；图标为内联 SVG。
- 源码线（deepseek-harness master）：✅（verifiedHost: `0.2.1-rc.1`）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化；源码面库不注册任何 slot / service / locale / row，兼容面等于 `Menu` 的类型导出。
