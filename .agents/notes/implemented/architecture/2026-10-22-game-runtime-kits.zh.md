# Agent Note: 游戏运行时套件

Status: implemented

## Problem

`@khorsheed/dsh-game` 处处默认 2D 画布：沙箱桥接里定义了像素画法（`dshDraw`、`dshLookSize`），元素校验只认像素行外观，冒烟检查的黑屏判断用 2D 上下文拷贝画布，`gamedev` 技能直接告诉模型「只有 2D」。下一步要加 3D 运行时（three.js、部件配方外观、WebGL 黑屏判断），既不能分叉工作台，也不能弄坏任何一个已经在磁盘上的 2D 项目。另外 `store.ts` 已经长到 1153 行，文件工具函数也混在服务里。

## Decision

凡是取决于「游戏怎么画」的东西，都归**运行时套件**管。`src/kits/types.ts` 定义 `RuntimeKit`：

| 成员 | 负责什么 |
|---|---|
| `runtimeFiles()` | 每个 bundle 里加在 `_dsh/` 下的文件：`_dsh/runtime.js`（沙箱里的运行时）、内置库、`_dsh/imports.json`（裸模块名 → bundle 路径） |
| `normalizeLook` / `lookHint` | 套件接受的外观格式，以及外观不可用时给模型的说明 |
| `blankProbe` | 冒烟检查用来判断黑屏的页面内表达式 |
| `skillSection` | 套件在 `gamedev` 技能里的那一段 |
| `styles` | 轻量门提供的美术风格 |

原有行为原样迁进 `2d-canvas` 套件（`src/kits/canvas2d.ts`）。`src/kits/index.ts` 是注册表（`KITS`、`DEFAULT_KIT`、`kitOf`、`withKitRuntime`）；`src/kits/ids.ts` 只放 id 列表，这样清单解析器（浏览器端也用）校验套件 id 时不必引入套件本身。

- **清单**：`game.json` 可选 `runtime: { kit, version }`。没有这个字段、或写了未知套件，都按 `2d-canvas` 运行；解析器从不补这个键，所以已有的清单读写后逐字节不变。
- **bundle**：`store.bundle` / `versionBundle` 和轮末检查都经 `withKitRuntime` 加上套件文件。套件文件从不写进版本快照；回放某个版本时，由快照自己的 `game.json` 决定用哪个套件。项目里有同路径文件时以项目文件为准。
- **加载器**（`src/vfs.ts`）：桥接只保留通用全局变量（`dshParams`、`dshElements`）。加载器把 `_dsh/runtime.js` 作为 blob 脚本插在桥接之后、游戏自己的脚本之前，并在原有相对路径改写之外，按 `_dsh/imports.json` 改写裸 `import`。
- **检查**：`BrowserChecker.run` 从项目的套件拿 `{ blankProbe }`。
- **拆 store**：文件工具函数（`inside`、`writeAtomic`、`readText`、`readJson`、`walk`、`bundleOf`、`fingerprintOf`）移到 `src/fsutil.ts`。

## Alternatives considered

**另起一个 3D 包。** 会复制一遍项目登记、版本、检查和面板，以后每个修复都得落两次。工作台本身与引擎无关，与引擎有关的只有套件这一部分。

**在 store、检查、技能里写 `if (is3d)` 分支。** 只多一种运行时时代价小，但提案的目标是通用工作台，以后每多一种运行时就要在五处再加分支。一个接口能让新运行时只占一个文件。

**把套件文件复制进每个版本快照。** 快照会完全自包含，但光 three.js 就约 700 KB，而版本要保留十个。快照通过自己的 `game.json` 锁定套件，`runtime` 里的 `version` 留给套件不兼容升级的那一天。

**`dshDraw` 留在桥接里。** 桥接会装两次（外壳一次、写入的文档一次），而且所有套件共用。2D 画法留在那里，就会出现在 3D 游戏里，桥接也就得知道套件。运行时脚本在同一时刻、在游戏自己的脚本之前到达游戏。

## Consequences

- 2D 项目行为不变；唯一可见的差别是 bundle 里多了一项 `_dsh/runtime.js`，导出的单文件 HTML 也带着它。
- `gamedev` 技能目前仍静态嵌入 2D 套件那一段。加第二个套件时，这一段要跟随会话绑定项目的套件（按套件拆技能，或者由 `game_read` 说明用的是哪个套件及其说明）。
- 裸模块名映射是通用机制：任何套件都能内置 ES 模块，游戏不需要知道它们在 bundle 里的路径。

## Testing

`tests/project.spec.ts` 固定了 runtime 的解析：已发布的套件会保留，未知套件和旧清单都不会多出 `runtime` 键，`kitOf` 退回 2D。`tests/checks.chrome.spec.ts` 让所有无头用例都经 `withKitRuntime` 带上 2D 套件，所以原有的 `dshDraw` 用例现在就证明了运行时注入；新增一个用例证明裸 import 能解析到内置的 `_dsh/` 模块。`tests/store.spec.ts` 期望检查运行和试玩 bundle 里都有 `_dsh/runtime.js`。
