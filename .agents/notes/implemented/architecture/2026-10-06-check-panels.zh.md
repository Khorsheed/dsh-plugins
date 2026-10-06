# Agent Note: check:panels——面板规范里能机器判断的那一半

Status: implemented

## Problem

面板规范（docs/panel-design.md）马上要交给画布负责人，由他只凭文档接入。只有文字的话，负责人和验收人都没法判断接入是否完成，以后的改动悄悄把它改坏了也没人拦。大多数插件还没接入 panel-kit，如果检查器对所有不符合的包都报错，gate 第一天就会红。

## Decision

`scripts/check-panels.ts`（`pnpm check:panels`，同时作为 gate 里紧跟插件独立性检查的一步）扫描所有带 `dsh.client` 的包，只看它的 `src/client` 下的 CSS 和 TS。任一依赖字段里出现 `@khorsheed/dsh-client-ui-panel-kit` 即算**已接入**（它是源码层共享库，实际多写在 devDependencies）。只有已接入包的错误会让检查失败；未接入的包只打印一行提示。所以现在全仓是绿的，一个包接入 panel-kit 的那一刻起就开始强制。

规则如下，文档会引用规则 id，所以 id 固定：

- 错误：`panel-root`（用了 PanelRoot 或基于 panel-kit 的 ContentPane，或 CSS 里有 `container-type: inline-size`）、`compact-layout`（用了 PanelHeader 或 ContentPane，或有 560px 的 `@container` 规则）、`token-fallback`（每个 `var(--dsh-panel-…)` 都带默认值）、`no-mobile-import`（源码不导入、依赖也不包含 `@khorsheed/dsh-mobile`）；
- 提醒：`literal-color`、`hover-only`（启发式）、`small-touch-text`（触屏或 560px 块里小于 13px）、`fixed-overlay`（灵感空间的新增弹窗就是被 `position: fixed` 推出了手机外壳边缘）。

提醒可以用写在同一行或上一行的 `panel-check: allow-<what>` 注释豁免那一行。输出是中文，按包分组，每条带规则 id、`文件:行` 和一句指向文档对应小节的修法。`--package <dir>` 列出某个包的全部条目（未接入时也列为提示）；`--json` 输出机器可读结果。

`browserOnHost` 从 ui-content-preview 移进了 panel-kit（`src/client/host.ts`）：「看页面的人在不在宿主电脑前」是所有面板都会遇到的问题，不是预览内核的细节。ui-content-preview、local-files、file-preview 都改为从 panel-kit 导入，没有留副本。

## Alternatives considered

- **现在就对所有不符合的包报错。** 否决：画布和二十多个其他包会在任何人接入前就把 gate 弄红。
- **用 manifest 字段显式声明接入。** 否决：依赖 panel-kit 本身就说明接入了规范，再加一个字段会和它不一致。
- **写死颜色直接算错误。** 暂时否决：已接入的包里存量很多（仅 worktrees 就有 19 条提醒）。先提醒加豁免注释，等存量清理完再升级为错误。

## Consequences

- 提交时已接入的包是 local-files、dsh-reader、file-preview、worktrees，都是 0 个错误，提醒分别为 1、5、0、19 条。
- canvas 一旦接入 panel-kit，它现在的问题（面板根没有宽度容器、9 条提醒）就立刻生效，这正是预期的强制时点。
- spec 会对真实仓库重跑检查器（已接入包 0 错误），所以即使不跑 gate，`pnpm test:scripts` 也能拦住回退。

## 后续（P3 验收，2026-10-06）

画布负责人只凭文档接入 panel-kit 时发现：发布构建把 CSS Modules 的容器名按文件加了哈希，插件里的 `@container dsh-panel` 永远对不上 `PanelRoot` 声明的容器，所有紧凑样式在线上从未生效；源码级检查和 vite 样例页（不加哈希）都看不出来。构建修复在 `build/tsdown.client.ts`（容器名保持全局）。本次补上的：

- **新规则 `container-match`（error，只对已接入包）**：读构建产物 `lib/client.js`，每个 `@container <名字>` 查询都要有同名声明（`container:` / `container-name:` / 内联样式）。没有产物、或产物比源码或共享构建配置旧时只给 `info` 并跳过——既不放过也不误报。gate 在 build 之后再跑一次 check:panels，保证核对的是新产物。
- **新规则 `desktop-font`（warn）**：`font` / `font-size` 直接读宿主桌面字号变量（`--dsw-font-xs-*` 等）时提醒，豁免 `allow-desktop-font`。来源：画布切换栏写死 xxs-12，手机上不放大。canvas / canvas-novel 目前各有上百条，留给画布负责人按文档处理。
- **计数统一**：文本逐包行、汇总行、`--json` 都从 `countReport` / `totalsOf` 取数；汇总行改为「已接入包 E 个错误、W 个提醒；未接入包 H 条提示」，spec 断言三者一致。`info` 不计数。
- **`panel-root` 认 `container: <名字> / inline-size` 简写。**
- **ui-panel-kit**：`ChipRow` 加 `tools`（固定在右侧、不随 chip 滑动），canvas 卡板的「全部已读 / 管理分类」迁入；`UnderlineTabs` 加每个 tab 的 `badge`（画在标签旁、不在下划线下）、行尾 `trailing`（与 tabs 共用一条底边线），触屏下高 44px。按协调者要求，canvas 的切换栏、「…」位置和「章节」角标没有迁移，交给画布负责人凭文档自己改（检验文档）。
- **docs/panel-design.md**：截图自查分「样例页（模拟触屏 + `data-dsh-mobile` + `MOBILE_CSS`）」和「真实构建产物」两层并写明 10-06 教训；可操作的实体卡片可保留卡片样式；「…」/工具放进组件的槽、不另画分隔线；不直接用桌面字号变量；规则表加两条新规则；参考实现加画布；改名后 `lib/types` 残留会拦部署。
