# 面板设计规范：一套界面，桌面与手机两端可用

本文回答一个问题：**一个插件的面板（右侧栏 tab、浮窗、手机全屏面板）怎样写，才能在桌面宽栏、桌面窄栏和手机上都好用**。所有带面板的插件按此执行。新插件从第一天就按本文写；存量插件改面板时顺手接入。

做完后用 `pnpm check:panels --package packages/<你的包>` 自查（见「[自查](#自查)」），再按「[截图自查](#截图自查)」在 390px 宽度下看一遍。

## 原则：一套界面，按面板宽度自适应

**不写 web、mobile 两套界面。** 每个插件只有一套组件、一套 CSS，面板变窄时切到紧凑排版。

- 窄面板不只出现在手机上：桌面上拖窄的侧栏、浮窗也只有三四百像素宽。按宽度适配，两种情况一次解决。
- 两套界面会分叉：新功能只进桌面版，手机版落后。
- 紧凑排版通常只是同一个样式文件里的一段容器查询覆盖。先例：`ContentPane.module.css` 六百多行，窄屏适配十几行。

三个维度互相独立，别混用：

| 维度 | 怎么判断 | 管什么 | 依赖 mobile 包吗 |
|---|---|---|---|
| **宽度** | 面板自己的宽度 ≤ 560px（容器查询） | 几行头部、图标是否收进「…」、是否单列、是否去掉卡片边框 | 否 |
| **输入方式** | `@media (pointer: coarse)` | 点击区域大小、悬停操作的替代 | 否 |
| **字号** | 读 `--dsh-panel-*` 变量 | 标题、正文、附注、阅读区的字号 | 只有触屏调大要它；没装时用桌面值 |

还有第四个容易被误当成「手机判断」的维度：**页面是不是在宿主电脑本机打开**。见「[只在宿主电脑上生效的操作](#只在宿主电脑上生效的操作)」。

## 依赖：ui-panel-kit

共享组件在 `@khorsheed/dsh-client-ui-panel-kit`（`packages/ui-panel-kit`）。它是**源码层共享库**：不是插件，不注册任何东西，构建时被内联进你自己的 `lib/client.js`，运行时插件之间没有依赖。

接入三步：

1. `package.json` 的 `devDependencies` 加 `"@khorsheed/dsh-client-ui-panel-kit": "workspace:*"`（它在构建时被内联，发布的包不需要它；放 devDependencies 和现有接入包一致）。
2. 从源码入口导入：`import { PanelRoot, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'`。
3. 在 `scripts/check-plugin-independence.ts` 的跨包依赖允许表里登记这条边：表以包目录名为键、值是允许依赖的包名数组（照着 `'dsh-reader': ['@khorsheed/dsh-client-ui-panel-kit']` 写；已有条目的包往数组里追加），附一行注释说明用途，然后跑 `pnpm check:plugins`。

**不要依赖、也不要 import `@khorsheed/dsh-mobile`。** 插件必须能单独安装；mobile 只通过 CSS 变量影响你，你读变量时带默认值即可。

### 组件速查

| 导出 | 作用 | 要点 |
|---|---|---|
| `PanelRoot` | 面板根节点，声明 `dsh-panel` 容器 | 子节点可以是函数 `compact => …`，拿到当前是否紧凑 |
| `usePanelCompact(ref)` / `usePanelCompactContext()` | 在 JS 里判断是否紧凑（≤ 560） | 只在要改**结构**时用；改样式用容器查询 |
| `PanelHeader` | 一行标题栏：返回、标题、附注、图标操作、「…」 | 见下 |
| `UnderlineTabs` | 下划线分段切换（`role=tablist`，方向键/Home/End；触屏下高 44px） | `tabs` `value` `onChange` `label`；每个 tab 可带 `badge`（计数、圆点，画在标签旁边、不在下划线下）；`trailing` 把这一行自己的「…」、布局切换放进同一行，共用一条底边线 |
| `ChipRow` | 一行筛选 chip，可横向滑动 | `value` 可单选或多选，切换策略由你决定；`count`、`color` 可选；`tools` 放这一行的图标按钮（全部已读、筛选），固定在右侧、不随 chip 滑走 |
| `ListRow` | 列表行：图标、主色标题、附注、尾部 | 有 `onSelect` 时是按钮；`selected` 用强调色浅底 |
| `AdaptiveSplit` | 列表/详情：宽时左右分栏，窄时只显示一边 | `backInDetail` 时返回按钮交给详情的标题栏画 |
| `panelVar(role)` | 带默认值的字号变量写法 | `panelVar('body')` → `var(--dsh-panel-text-body, 13px)` |
| `browserOnHost()` | 页面是否在宿主电脑本机打开 | 见「只在宿主电脑上生效的操作」 |
| `PANEL_COMPACT_MAX` / `PANEL_CONTAINER` | `560` / `'dsh-panel'` | 写容器查询时用 |

### PanelHeader

```tsx
<PanelHeader
  title="梦境守护者"
  meta="2 张卡"
  onBack={close} backLabel={t('back')}
  actions={[
    { id: 'add', label: t('add'), icon: <IconPlus />, onSelect: add },
    { id: 'search', label: t('search'), icon: <IconSearch />, onSelect: openSearch, pinned: true },
    { id: 'refresh', label: t('refresh'), icon: <IconRefresh />, onSelect: refresh },
    { id: 'folder', label: t('workspace'), icon: <IconFolder />, onSelect: pick, menuOnly: true },
  ]}
  moreLabel={t('more')}
/>
```

- `actions` **按常用程度排序**。紧凑时显示 2 个图标，宽时 4 个，其余进「…」。
- `pinned`：始终显示（仍占名额，少用）。`menuOnly`：永远只在「…」里（不常用的、或者是一行信息）。
- 全部放得下时没有「…」；「…」里只会剩一项时，这一项直接显示，不开只有一行的菜单。
- `extra`：放一个复合控件（如翻译的地球加下拉），不占图标名额。
- 「…」用的是宿主的 `Menu`，键盘、Esc、点外部关闭都由宿主处理，不要自己写弹出菜单。

## 面板根与紧凑排版

面板最外层用 `PanelRoot`（或在 CSS 里自己声明 `container-type: inline-size`）。紧凑排版写在容器查询里：

```css
@container dsh-panel (max-width: 560px) {
  .toolbar { flex-wrap: wrap; }
  .card { border: 0; border-radius: 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
}
```

紧凑排版下的硬规则：

1. **正文前最多两行控件**：一行 `PanelHeader`，加一行可选的切换（`UnderlineTabs` 或 `ChipRow`）。搜索默认收成图标，点开再占一行。
2. **标题栏最多 2 个常显图标**，其余进「…」（`PanelHeader` 自动处理）。
3. **不重复名字**：面板标签已经显示的名字、正文顶部已经有的大标题，标题栏不再写一遍。需要时用「滚过大标题后再在标题栏淡入」（先例：灵感空间文章详情）。
4. **路径用可点的面包屑**，不要「目录名 + 上级路径附注 + 上一级箭头」（先例：文件列表）。
5. **不嵌套卡片**。一层容器时用分隔线，不用边框、灰底、大圆角。例外是**可操作的实体卡片**：画布卡板上可以拖动、连线、选中的卡，本身就是用户操作的对象，可以保留卡片样式。本条针对的是纯展示的列表，以及卡片里再套卡片。
6. **高度按内容撑开**，不为标题预留固定行数。
7. **结构上的差异**（如「只有一个画布时不显示内部标签栏」）用 `usePanelCompactContext()` 判断；只有样式差异时一律用容器查询。
8. **「…」和工具按钮放进组件提供的槽**：标题栏用 `PanelHeader` 的 `actions`，切换栏用 `UnderlineTabs` 的 `trailing`，筛选行用 `ChipRow` 的 `tools`。不要在组件外面另起一个容器、另画一条分隔线把它们拼在旁边——那样会多出一条线，触屏高度也对不齐。计数用 tab 的 `badge`，不要塞进 `label`。

宽面板可以同样受益，但**不能退化**：信息不能丢，操作不能比原来藏得更深。

## 字号

| 变量 | 用途 | 桌面默认 | 触屏（mobile 设置） |
|---|---|---|---|
| `--dsh-panel-text-title` | 面板标题、卡片标题、文件名（字重 600） | 14px | 17px 起，跟随宿主字号设置 |
| `--dsh-panel-text-body` | 列表项、正文、按钮文字 | 13px | 15px |
| `--dsh-panel-text-meta` | 时间、字数、路径、计数 | 12px | 13px |
| `--dsh-panel-text-reading` | 长文阅读区（markdown 预览、文章正文） | 14px | 17px 起 |
| `--dsh-panel-reading-line-height` | 阅读区行高 | 1.65 | 1.7 |

- **永远带默认值**：CSS 写 `var(--dsh-panel-text-body, 13px)`，TS 用 `panelVar('body')`。没有默认值时，没装 mobile 的面板字号会丢。
- 不要在阅读区写死 `font-size: 14px`。文件预览曾因为这一行，手机上的大字号传不进来。
- **不要直接用宿主的桌面字号变量**（`--dsw-font-xs-*`、`--dsw-font-xxs-*`、`--dsw-font-xxxs-*`），无论写在 `font` 还是 `font-size` 里。它们在手机上不会放大。先例：画布的切换栏写死了 `--dsw-font-xxs-12`，手机上还是 12px。面板文字一律读 `--dsh-panel-*`；字体族可以继续用 `--dsw-font-family`。
- 触屏下不出现小于 13px 的文字。阅读区标题在触屏紧凑下按 22 / 19 / 17 递减。
- 字号的数值只在 mobile 包里改，插件不需要跟着改。

## 颜色

- **只用 `--dsw-alias-*` 变量**，不写死色值；深浅两套主题自动跟随。
- 文字层级靠颜色而不只是字号：标题和名字用 `--dsw-alias-label-primary`，附注用 `--dsw-alias-label-secondary`，不可用态用 `--dsw-alias-label-tertiary`。**文件名、条目名、阅读正文永远是主色**；引用、图注才用次级色。
- 强调色统一 `--dsw-alias-state-business-primary`。选中项用它的浅底：`color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent)`。
- 主按钮用强调色实心或描边，**不用纯黑实心**。一屏最多一个实心主按钮。
- 确实要写字面量时（比如品牌色），在该行或上一行加 `/* panel-check: allow-color */` 并说明原因。`var(--x, #fff)` 里的默认值不算字面量。

## 触屏

在 `@media (pointer: coarse)` 里处理，不要和宽度混在一起（桌面拖窄的侧栏不需要触屏尺寸）：

- 列表行最小高 44px；图标按钮最小 40×40；相邻图标按钮之间不留额外间隔，点击区域本身就是间隔。
- **没有悬停**：只在 `:hover` 时才出现的操作，触屏上要常显，或者收进「…」。长按菜单只能作补充，不能是唯一入口。
- 依赖精确拖拽的操作（比如画布连线）在触屏上要有按钮版本。
- 输入框字号不小于 16px，否则 iOS 聚焦时会放大页面。

## 弹层与溢出

- **面板内的弹层按面板定位**（`position: absolute` 相对面板根），不要用 `position: fixed`。手机外壳里，按窗口定位的弹层会被推出屏幕边缘（先例：灵感空间「新增灵感」弹窗）。
- 弹层宽度不超过面板宽度减 32px，按钮行允许换行；高度不超过可见区域，必要时内部滚动。键盘弹起时标题、输入框、按钮都要在键盘上方。
- **正文只纵向滚动**。滚动容器禁止横向滚动；本来就宽的元素（表格、公式、代码块、`svg`、`iframe`）各自 `max-width: 100%` 并在自己的框里 `overflow-x: auto`；图片 `max-width: 100%; height: auto`；正文 `overflow-wrap: anywhere` 处理长链接（表格单元格除外）。
- 右键菜单、弹出菜单要夹在视口内。

## 只在宿主电脑上生效的操作

「在访达中打开」「在 IDE 中打开」这类操作会在**宿主电脑**上弹窗。人不在那台电脑前时（手机、平板、另一台电脑通过隧道访问），点了什么都不会发生。

- 用 `browserOnHost()` 判断（页面地址是 localhost / 127.0.0.1 / ::1 时为真，读不到地址时按真处理）。为假时**隐藏**这些操作，不要显示一个没反应的按钮。
- 判断依据是「人在不在宿主电脑前」，**不是**屏幕宽度或触屏。
- 同一类操作用同一个名字：文件上叫「打开所在文件夹」，文件夹上叫「打开此文件夹」，「在 IDE 中打开」。
- 宿主侧的系统对话框（如原生目录选择器）同理：远程时隐藏入口，或者提供页面内的替代流程。

## 自查

```bash
pnpm --filter <你的包名> build          # container-match 读构建产物，先构建
pnpm check:panels --package packages/<你的包>
```

检查器读源码和构建产物，几秒跑完。包的任一依赖字段里有 `@khorsheed/dsh-client-ui-panel-kit` 就算「已接入」：已接入的包出现 error 时退出码非 0，gate 会拦；未接入的包只作提示。warn 不拦，但每条都要看一眼——修掉，或在该行（或上一行）加豁免注释并写明原因：`/* panel-check: allow-color — 原因 */`、`allow-hover`、`allow-small-text`、`allow-fixed`、`allow-desktop-font`。全仓跑 `pnpm check:panels`，加 `--json` 输出机器可读结果。

| 规则 | 级别 | 查什么 |
|---|---|---|
| `panel-root` | error | 用了 `PanelRoot`（或基于它的 `ContentPane`），或 CSS 声明了 `container-type: inline-size` |
| `compact-layout` | error | 用了 `PanelHeader`（或 `ContentPane`），或有 `(max-width: 560px)` 的容器查询 |
| `token-fallback` | error | `var(--dsh-panel-…)` 都带默认值 |
| `no-mobile-import` | error | 没有 import 或依赖 `@khorsheed/dsh-mobile` |
| `literal-color` | warn | CSS 里写死的颜色 |
| `hover-only` | warn | 只在 `:hover` 时才显示的元素，且没有触屏替代（启发式，可能误报） |
| `small-touch-text` | warn | 触屏或紧凑块里小于 13px 的字号 |
| `fixed-overlay` | warn | `position: fixed` 的弹层 |
| `desktop-font` | warn | `font` / `font-size` 里直接用了桌面字号变量（豁免：`allow-desktop-font`） |
| `container-match` | error | **构建产物** `lib/client.js` 里，每个 `@container <名字>` 查询都有同名的容器声明。没有产物、或产物比源码旧时只给一条提示并跳过——先 build 再跑。gate 在构建之后会再跑一遍 |

检查器判断不了的，靠截图自查：正文前是不是最多两行控件、有没有重复的名字、信息层级是否清楚、宽面板有没有退化。

## 截图自查

每次改面板都要看图：**390px 宽、深浅两种主题、模拟触屏**，再截一张桌面宽度，对照本文的规则看一遍。截图放仓库根下 `scratch-<主题>/`（已被忽略，不会进提交），用完删掉。

截图分两层，两层都要过：

**1. 样例页（快，改一处看一处）**

给你的面板写一个只在仓库内用的样例页（内存样例数据，不连生产实例），用 Playwright 驱动本机 Chrome 截图。现成的样例可以照抄：

- `packages/mobile/examples/panels`（`pnpm exec tsx examples/panels/serve.ts`，端口 8875）：真实的面板导航、文件列表、工作树。
- `packages/dsh-reader/examples/compact`（端口 8876）：灵感空间列表与详情，支持 `?body=<url>` 回放一份本地正文。

两个要求，缺一个截出来的就不是手机上的样子：

- **模拟触屏**：`browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })`。不加的话 `(pointer: coarse)` 的样式（44px 行高、常显操作）一条都不生效。
- **让触屏字号生效**：页面根节点要有 `data-dsh-mobile` 属性，并加载 mobile 包的样式。`packages/mobile/examples/panels` 已经做了（「移动」开关默认开：给 `<html>` 加 `data-dsh-mobile`，并把 `MOBILE_CSS` 放进 `<style>`）。自己写样例时照抄这两行：从 `packages/mobile/src/client/styles.ts` 导入 `MOBILE_CSS`，`document.documentElement.toggleAttribute('data-dsh-mobile', true)`。只写在样例页里；插件源码（`src/client`）不能引用 mobile 包。

**2. 真实构建产物（合并前必须做一次）**

样例页走的是 vite 直接编译源码，和插件真正发布的 `lib/client.js` 不是同一条构建链。**2026-10-06 的教训**：发布构建把容器名按文件加了哈希，插件里的 `@container dsh-panel` 和 `PanelRoot` 声明的容器永远对不上，所有紧凑样式在线上一直没生效；而样例页不加哈希，截图一直正常，谁也没发现。所以：

1. `pnpm --filter <你的包名> build`，再跑 `pnpm check:panels --package packages/<你的包>`。`container-match` 会核对产物里的容器名。
2. 在跑着构建产物的实例上看一眼：按 `docs/ops.md` 起一个临时实例（一次性 home，`link:` 你的包目录），浏览器开到 390px 宽并模拟触屏；或者部署到 3080 后直接用手机看。和样例页的截图对照，**不一样的地方就是构建链上的问题**。

不论哪一层，还要用脚本确认正文没有横向溢出：滚动容器的 `scrollWidth` 不大于 `clientWidth`。

要模拟「不在宿主电脑上打开」：样例页的 `serve.ts` 用 `PANELS_ALLOWED_HOSTS=phone.remote.test` 放行一个假域名，Chrome 启动参数加 `--host-resolver-rules=MAP phone.remote.test 127.0.0.1`。

**改名或删文件之后**：`lib/types` 里会留下旧文件的类型产物，部署时打包检查会拦下（「stale lib/types emits with no backing src module」）。部署前清掉该包的 `lib/` 再构建，见 `docs/ops.md`「构建卫生」。

## 参考实现

| 面板 | 包 | 看什么 |
|---|---|---|
| 文件预览 | `ui-content-preview`（`ContentPane`） | 两行头部、搜索收成图标、阅读区字号、单项菜单就地显示 |
| 文件列表 | `local-files` | 可点的面包屑、打开文件后标题栏让位、远程时隐藏宿主操作 |
| 工作树 | `worktrees` | `AdaptiveSplit` 列表/详情、`PanelRoot` 按整个面板宽度判断 |
| 灵感空间 | `dsh-reader` | `ChipRow` 筛选、列表行、`extra` 复合控件、滚过大标题后显示标题、弹层按面板定位、正文溢出处理 |
| 画布 | `canvas`、`canvas-novel` | 三个视图用 `UnderlineTabs` 切换、`ChipRow` 的 `tools` 放「全部已读」「管理分类」、触屏上用「连线」模式（先点一张卡、再点另一张）替代拖拽连线、豁免注释写明理由的范例（如阴影、遮罩透明度）、可操作的卡片保留卡片样式 |

## 新插件检查清单

1. 面板根用 `PanelRoot`；样式差异写在 `@container dsh-panel (max-width: 560px)` 里。
2. 头部用 `PanelHeader`，`actions` 按常用程度排序；切换用 `UnderlineTabs`，筛选用 `ChipRow`。
3. 字号只读 `--dsh-panel-*` 并带默认值；颜色只读 `--dsw-alias-*`。
4. 紧凑时正文前最多两行控件，不重复名字，不嵌套卡片。
5. 触屏下没有只能悬停的操作，点击区域够大。
6. 弹层按面板定位，正文不横向溢出。
7. 只在宿主电脑上生效的操作用 `browserOnHost()` 判断。
8. 不装 mobile 包时界面照常。
9. 「…」和工具按钮放进组件的槽（`actions` / `trailing` / `tools`），计数用 `badge`；不直接用桌面字号变量。
10. 先 build 再跑 `pnpm check:panels --package packages/<你的包>`，零 error；样例页 390px 深浅两色、模拟触屏截图自查过，并在真实构建产物上看过一次。
