# 上游功能请求：给 `@deepseek-ai/dsh-client-ui-primitives` 增加正式 `./icons` 发布出口

- **状态**：功能请求（待上游评估）
- **提出方**：dsh-plugins 社区仓（`@khorsheed/dsh-*` 系列包作者）
- **目标读者**：deepseek-harness 上游维护者（`packages/client/ui-primitives`）
- **提出日期**：2026-09-26（0.1.5↔rc.1 双线兼容实证期间）

## 一句话

图标是纯 artwork、零宿主运行时态，但当前**没有任何合法路径让第三方插件把图标内联进自己的客户端 bundle**：唯一的子路径出口 `./src/*` 在 npm 产物里指向不存在的文件（产物只含 `lib/`）。请参照 `dsh-agent-preset-registry` 的 `./display` 先例，给图标一个正式发布出口。

## 背景与证据

1. **图标名两线零交集**。0.1.5 的图标导出是像素后缀（`IconCheckOutline16`、`IconChevronDownOutline14`,75 个），rc.1 是 Regular/Medium 后缀（`IconCheckOutlineMedium`,93×2=186 个）——两条线没有任何同名导出。
2. **外部化即断裂**。社区插件的客户端 bundle 把 ui-primitives 当平台模块外部化（宿主运行时用宿主副本）；于是任何引用 rc.1 图标名的插件在 0.1.5 宿主上拿到 `undefined`,React 抛 #130,所在槽位（`conversation.session.header.actions`、`conversation.chat.node` 等）整块不渲染。我们 20 个包 40 个图标名中招。
3. **内联无路**。图标模块源码在 `packages/client/ui-primitives/src/icons/index.tsx`,package.json 声明了 `"./src/*": "./src/*"` 出口，但**发布的 npm 产物不含 `src/` 目录**（pnpm store 实读：`lib/ LICENSE package.json README*`)——`import '@deepseek-ai/dsh-client-ui-primitives/src/icons/index.tsx` 在任何安装树上都是 MODULE_NOT_FOUND。
4. **先例已在仓内**。`@deepseek-ai/dsh-agent-preset-registry` 的 `./display` 出口正是「纯 fold、无运行时身份、发布出来就是给浏览器 bundle 内联的」——我们 purity gate 对它的注释原文如此。图标是同构的情况，缺一个同构的出口。

## 建议形态（二选一，倾向前者）

- **A. 发布 lib 级 icons 入口**:exports 加 `"./icons": { "types": "./lib/types/icons/index.d.ts", "default": "./lib/icons.js" }`,lib 多一个 icons 入口文件（`lib/types/icons/index.d.ts` 今天已经在产物里，缺的只是 JS 半边与出口登记）。
- **B. 发布 src/**：把 `src/`（至少 `src/icons/`)加进 `files`。产物变大但零新增构建面。

两者都让插件可以 `import { IconCheckOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives/icons'` 并在自己的 bundle 里内联——tree-shake 后每个 bundle 只带实际用到的几 KB。

## 我们的临时绕行（供评估紧迫性）

仓内生成器 `scripts/sync-icon-artwork.mts` 从 harness 检出抽取各包实际用到的图样，摊平成每包自持的 `src/client/icons.tsx` 提交进仓（客户端 bundle 内联它们，双线免疫）。它是同步成本与漂移风险的双重负担——上游出口落地后，我们迁移到该出口并退役生成器（retirement：逐包把 `./icons.tsx` 的相对导入换成 `./icons` 出口，删除生成器与钉例）。
