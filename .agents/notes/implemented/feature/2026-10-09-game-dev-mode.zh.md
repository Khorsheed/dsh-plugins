# Agent Note: Game-development mode (dsh-game)

Status: implemented

## Problem

用户想和 agent 一起做小游戏：对话里定玩法，右栏面板看策划、玩成品。用户没当过策划，agent 既要写代码也要当策划导师。提案（`proposals/active/2026-10-09-gamedev-mode.md`，决定 D1–D17）定了形态；本笔记记录 M1 怎么落地、放弃了什么。

## Decision

新包 `@khorsheed/dsh-game`（`packages/game`），并在 `@khorsheed/dsh-presets` 里加第四个 preset `dsh-gamedev`（游戏开发模式）。

- **两行。** 核心行 `game` 提供 `ctx.gameStore`、挂 `game` Remote、跑每轮检查。`./agent` 行 `game-agent`（`game_open`、`game_read`、一段提示、`gamedev` 与 `game-design` 两个技能）在根上出厂停用，由 preset 点名——画布 `./agent` 模式。
- **存储。** 项目是会话工作区里的一个文件夹（`game.json`、`index.html`、`src/`、`assets/`、`elements/*.json`、`design/*.md`、`tests/*.test.js`）。插件自己的状态在项目内的 `.game/`：`versions/<n>/` 构建快照（留最近 5 个）、`current.json`、`candidate.json`、`checks.json`、`playtest-log.jsonl`。`$DSH_HOME/state/game/registry.json` 只记项目列表和会话绑定。建项目时的 `game.json` 与 `design/pillars.md` 走 `ctx.fs`，带调用方的 policy。`.game/` 的写入和二进制快照拷贝走 node，先查不是只读——二进制写入沿用画布的先例。
- **轻量门。** `game_open create` 缺游戏名、pitch、元素类型、美术风格（`ART_STYLES` 之一或 `custom:描述`）任何一样都拒绝，并原样回告缺什么，agent 去问用户而不是替用户编。
- **没有写入工具，也没有测试工具。** agent 用普通 fs 工具写文件，测试随代码一起写。
- **检查。** 会话绑定了项目、`index.html` 存在、构建加测试的指纹变了时，插件在 `agent/turn-stopping` 上跑三段：
  1. 校验 `game.json` 与元素文件。
  2. 无头 Chrome 冒烟：4 秒内 `window.dshGame.ready`，调 120 次 `step`，画面不能全是一种颜色，不能有运行报错。
  3. 每个 `tests/*.test.js` 各在一次全新加载上跑。

  失败用 `agent.steer` 以 `dsh-game` 来源的 snapshot 消息送回同一轮。每轮上限 2 次，第 3 次失败记 `gaveUp`，同一指纹不再重跑。通过就生成新版本：`autoConfirm` 开着（默认）直接成为当前版本，关着则成为候选。
- **共用加载器。** 试玩区与无头检查用同一个加载器（`src/vfs.ts`）。它跑在 `sandbox="allow-scripts"` 的 srcdoc iframe 里，靠 postMessage 喂文件，全部以字符串保存，打包器改名破坏不了它。桥接替身代管 `localStorage`，面板按项目把存档存在浏览器里。
- **Chrome。** 浏览器用本机装的 Chrome（依次是 `chromePath`、`CHROME_PATH`、常见安装路径）。`puppeteer-core` 动态 import，并通过 `dsh.runtimeDependencies` 留在发布包里。找不到 Chrome 时只跑数据校验，记录里写明浏览器部分为何跳过。
- **面板——策划操作台。** 基于面板 kit，四个视图。tab 显隐用画布的双重判据，判 `@khorsheed/dsh-game/agent` 行。
  - 试玩：游戏画面带状态条（版本、报错、点选、重开），候选条（先试玩 / 退回 / 确认上线），参数抽屉。
  - 元素：卡片网格、像素外观编辑器、字段编辑、A/B/C 方案。
  - 策划：一页纸与支柱置顶，章节就地展开、可直接改，元素数值自动成表画对比条。一页纸只有一个来源 `game.json`，在卡片上编辑。`design/pillars.md` 只作「支柱说明」：建项目时不生成，`pillarNotes` 会滤掉复述一页纸的行，因为早先的项目里有一份副本。
  - 版本：三层检查结论与无头截图、时间线（切回、对比）、单文件导出、试玩记录。首页与换风格共用一个美术风格画廊。
- **面板改动依赖的运行时约定。** 加载器在游戏启动前把 `game.json` 的 `params` 放进 `window.dshParams`、所有元素放进 `window.dshElements`；面板改动经 postMessage（`params`、`element`）热替换，游戏每帧读就即时生效。加载器另提供 `dshDraw`/`dshLookSize` 画像素行格式的 `look`；`dshGame.pick(x, y)` 支持点选。
- **用户层，显式发送**（2026-10-22 已被取代：面板修改改为提交成版本，改动条已删除，见 [面板提交](2026-10-22-game-panel-commit.zh.md)）。 `.game/user.json` 存滑块试玩值（定稿写进 `game.json`）、还没告诉 agent 的改动、换风格请求。元素编辑同时写进工作文件和线上版本快照，所以立刻生效。改动攒在 `conversation.input.dock` 的「面板改动」里，可逐项去掉。「写进对话」把它们以 `【面板改动】` 开头写进对话框，用户补一句意图再发送。`agent/pre-step` 遇到带这个标记的批次，只清掉其中列到的改动，批次本身不动。没发的改动会出现在 `game_read` 总览里，agent 不会把它们改回去。
- **外观方案。** `game_propose` 存最多 3 个规范化方案（`.game/proposals.json`）；用户挑中即替换外观并记为待附上改动。换风格请求会让下一个通过的版本强制成为候选。
- **本轮改动卡片。** 核心在 `turn/start` 给绑定项目拍快照（文件哈希、元素、参数、版本），在 `turn/end` 对比并把 `TurnReport` 存到 `$DSH_HOME/state/game/turns/<session>.json`。前端用 `uiConversation.events` 的 Definition 跟踪轮次，在 `conversation.chat.turnTail` 里渲染（回复末尾、不随折叠，canvas-novel 的先例），每行可跳到右栏对应位置（`openAt` → 元素页、策划章节、试玩、版本）。
- **询问而不是推送。** 滑块只是试玩，不进待发送队列。会进队列的改动（策划、外观、字段、挑方案、定稿参数、退回、切回）之后，面板询问是否告诉 agent：写进对话（发前可改）、不发这次（丢掉）、稍后、关闭提醒（按浏览器记；标题栏「自动上线」旁的「改完提醒」开关随时可开关）。
- **试玩手动开始。** 先显示封面（最近一次检查的截图）和「开始试玩」；点了才挂载游戏，新版本上线时停止。
- **对话行。** `uiConversation.events` 的 Definition 把 `dsh-game` 消息投影成 `dsh-game-message` 聊天节点，由带 key 的 `conversation.chat.node` 行渲染：红色「检查未通过 n/2」带问题，灰色「已附上」带条目。官方 `context` 节点仍隐藏，不会重复显示。

## Alternatives considered

**打开试玩页就自动运行游戏。** 2026-10-10 否决：大游戏每次打开都会占资源。

**拖滑块就记成要告诉 agent 的改动。** 2026-10-10 否决：滑块是边玩边找感觉的，值不值得告诉 agent 由用户事后决定。

**面板改动在下一次发送时自动附上。** 先上线过（提案决定 D3），2026-10-10 应用户要求换掉：拖一下滑块就搭在用户下一句话后面，哪怕那句话跟它无关，太碎。现在由用户显式告诉 agent。代价是 agent 可能不知道某个改动；`game_read` 列出没发的改动，覆盖了「别改回去」这一点。

**`game_write` / `game_check` 工具。** 否决（用户决定）。不同类型的游戏测法不同，单独的检查工具还会让模型跳过不调。测试随代码一起写、轮末由插件跑，就不会被忘掉。

**依赖 `@khorsheed/dsh-capture` 起浏览器。** 否决。这是许可配对之外的跨插件依赖；capture 的队列和 URL 策略是为截网页设计的，不是为跑游戏。

**宿主 HTTP 路由或 service worker 提供游戏文件。** P0-1 已否决。路由不带鉴权，桌面端对 Origin null 回 403；iframe 内 blob 加载器两者都不需要。

**失败用 `agent.followup` 开新一轮。** 否决。steer 让修复留在用户发起的那一轮里；而且 `turn-stopping` 在中止或出错时不触发，用户的停止永远不会被顶掉。

**钩子挂在 `./agent` 入口。** 否决。核心里的钩子只处理有绑定的会话，而只有 `game_open` 会绑定，所以出了 preset 钩子自然不起作用，用不着依赖 preset 平面的事件作用域。

## Consequences

- 在第二台临时实例上走查过操作台：
  - 拖滑块即时改变游戏，并进入「面板改动」；写进对话再发送后清空。
  - 点选认出守夜人。
  - 改雾灵外观的请求产出 3 个方案；挑 B 后游戏里随即替换。
  - 策划、版本、风格画廊在宽、窄两种宽度下都正常。
- 这种对话行会被宿主收进步骤分组（`TURN_PROCESS_INDEPENDENT_KINDS` 是模块常量，不可扩展）。轮次结束后要展开轮次和步骤分组才看得到；要根治得改宿主，在那之前「将附上」和「版本」页承载同样的信息。

- 在 0.2.0-rc.2 临时实例上用脚本化模型验证过。一条消息建了项目、写了 6 个文件。检查在真 Chrome 里失败（守夜人太慢，没过测试），结果送回同一轮，agent 读了并改好 `rules.js`；重检通过，v1 在右栏能玩。第二轮部署了 v2。故意写错的测试送回两次后停下，记为 `gaveUp`，试玩区留在 v2。
- 送回的检查结果是上下文消息，0.2.0 聊天视图不显示。在 M2 的自定义聊天行（提案方案 B，探针 P1-8）落地之前，用户只能在「检查」页看到。
- 尚未做：编辑器里的 SVG/矢量外观、文生图风格、itch.io 发布、排行榜与联机（需服务器，另立提案）。
