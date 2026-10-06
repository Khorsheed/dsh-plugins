# Agent Note: ui-panel-kit——面板一套界面按宽度自适应，配共享字号变量

Status: implemented

## Problem

2026-10-06 手机走查时，画布、文件列表、文件预览、灵感空间四个面板各用一套字号、灰度、分段控件和 chip 样式，正文前最多堆了五行控件。每个插件都按桌面侧栏设计，手机上只是被拉到全宽；mobile 包适配的是外壳，进不了面板内部，从外部覆盖也不安全。插件又必须能独立安装，所以它们渲染的任何东西都不能依赖 `@khorsheed/dsh-mobile`。

## Decision

新建源码面库 `@khorsheed/dsh-client-ui-panel-kit`（`packages/ui-panel-kit`，`private`，`dsh.composition.component: source-plane-library`），形式与 `ui-content-preview` 完全相同：使用方 import `./src/client/*`，tsdown 把它内联进各插件自己的 `lib/client.js`。它不注册任何东西，没有自己的 bundle；`check-plugin-independence` 把它与 ui-content-preview 一起列入 `NO_OWN_PATCH`。

它包含三样东西：

- **字号变量** `--dsh-panel-text-title` / `-body` / `-meta` / `-reading` 与 `--dsh-panel-reading-line-height`，一律以桌面值作 `var()` 默认值读取（`panelVar(role)`）。本库从不定义它们。`@khorsheed/dsh-mobile` 在 `html[data-dsh-mobile] body` 下设置触屏值（标题与阅读区跟随 `--mobile-text`，正文 15px，附注 13px，行高 1.7），且不 import 本库；mobile 有一条测试同时钉住这条规则和「不依赖」。
- **宽度是排版维度。** `PanelRoot` 声明 `dsh-panel` 尺寸容器；插件 CSS 用 `@container dsh-panel (max-width: 560px)` 写紧凑排版，断点与 ContentPane、local-files 现用的一致。`usePanelCompact` 量同一宽度（560 含），给需要改变结构的组件用。
- **共享紧凑控件。** `PanelHeader`（按优先级排列的图标操作：紧凑 2 个、宽 4 个常显，其余进 ⋯ 后的宿主 `Menu`，全部放得下时不出现 ⋯，`pinned` 可固定一个常显）、`UnderlineTabs`（mobile 面板标签同款，漫游焦点跳过禁用项）、`ChipRow`（单一 chip 样式，选择策略由调用方决定）、`ListRow`（名字主色，选中强调色浅底）。颜色只用 `--dsw-alias-*`；`pointer: coarse` 下列表行 44px、图标按钮 40×40。图标为生成模块格式的内联 SVG。

触屏与宽度是两个独立维度：桌面窄面板用紧凑排版、桌面字号；手机两者兼得。

## Alternatives considered

- **每个插件写 web、mobile 两套。** 否决：桌面窄面板仍然难看，两套会分叉。
- **组件随 mobile 运行时下发（插件取服务）。** 否决：每个插件仍要为 mobile 缺席写兜底界面（又是两套），桌面窄面板享受不到，还引入加载顺序与版本耦合。
- **放进 `ui-content-preview`。** 否决：那是预览内核且已声明退休路线，多数使用方（画布、灵感空间、eval）并不预览文件。

## Consequences

- 每个使用方各带一份；本库更新需各使用方重新构建发布才生效，在发布波次追平之前不同插件的样式可能短暂不一致。
- 调字号只需改 mobile 样式表一处，不改任何插件。
- 目前还没有插件接入；`AdaptiveSplit` 在第一轮接入（文件预览与文件列表）时从 ui-content-preview 迁入。
