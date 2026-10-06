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
