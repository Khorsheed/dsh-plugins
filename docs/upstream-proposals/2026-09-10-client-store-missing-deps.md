# 上游缺陷报告：`@deepseek-ai/dsh-client-store` 0.1.5 丢失运行时依赖声明

- **状态**：缺陷报告（待上游修复）
- **提出方**：dsh-plugins 社区仓（`@khorsheed/dsh-*` 系列包的消费者）
- **目标读者**：deepseek-harness 上游维护者（`packages/client/store`）
- **发现日期**：2026-09-10（0.1.5-rc.1 适配期间）

## 一句话

`@deepseek-ai/dsh-client-store@0.1.5-rc.1` 的发布产物以裸说明符 `import … from "zustand/vanilla" | "zustand/middleware" | "zustand/shallow" | "immer"` 引用 zustand/immer，但 package.json **没有声明这两个依赖**——0.1.2-rc.1 是声明了的，这是 0.1.5 的回归。

## 证据

npm 产物（`npm view` + 解包核对，pnpm store 实读）：

| | 0.1.2-rc.1 | 0.1.5-rc.1 |
|---|---|---|
| `lib/index.js` 裸导入 | `zustand/vanilla` 等 ×3 + `immer` | 同左 |
| `dependencies` | `{ "immer": "^10.1.1", "zustand": "~4.4.7" }` | **无（缺省）** |
| `peerDependencies` | `@deepseek-ai/cordis` | `@deepseek-ai/cordis ^4.0.2` |

上游源码清单同步回归：`packages/client/store/package.json` 在 0.1.2-rc.1 声明了 `immer`/`zustand`，0.1.5-rc.1 的同名文件里这两条消失。

## 影响

- 官方 web bundle 自身不踩雷：harness workspace 根部能解析到 zustand/immer（其他包声明了），构建期被内联。
- **外部消费者必踩**：任何把 `dsh-client-store` 当库引用的第三方包（我们仓的约定是客户端 bundle 把它按 INLINE_SAFE 内联），bundle 时遇到 unresolvable import——构建期告警、运行期 `Cannot find module 'zustand'`。Node 直接 `import '@deepseek-ai/dsh-client-store'` 同样炸。
- 我们目前的绕行：消费方各自把 `zustand ~4.4.7` + `immer ^10.1.1` 加进自己的 devDependencies（`@khorsheed/dsh-client-ui-file-preview` 已这么做）。每个内联该包的社区包都要重复这一份。

## 建议修复

`packages/client/store/package.json` 恢复：

```json
"dependencies": {
  "immer": "^10.1.1",
  "zustand": "~4.4.7"
}
```

（或者把产物改回真正打包内联，与 0.1.2 行为等价即可。）

## 退役条件

官方修复发布后，各消费包移除自己的 zustand/immer devDeps 绕行。
