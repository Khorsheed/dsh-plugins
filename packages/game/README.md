# @khorsheed/dsh-game

[English](README.en.md) | 中文

和 agent 一起做小游戏：对话里定玩法和细节，右栏「游戏」看分章节的策划、玩每一轮通过检查的最新版本。

没做过游戏策划也能上手——agent 既写代码也当策划搭档：先和你定一句话玩法、有哪几类元素、选哪种美术风格（从示例里挑），再动手做出能玩的最小版本，之后照着你玩下来的感受一点点改。每一轮结束，插件自动检查改过的项目（数据校验、加载冒烟、agent 随代码写的测试脚本）；没过就把问题交回 agent 在同一轮里修（最多 2 次），过了就直接进试玩区。

## 特性

- **游戏开发模式**：`@khorsheed/dsh-presets` 里的 `dsh-gamedev`（游戏开发模式）preset——开发者兼策划导师的 persona，`game_open` / `game_read` 两个工具，`gamedev`（做法）与 `game-design`（带你做策划）两个技能。
- **项目在工作区里**：一个项目就是会话工作区里的一个文件夹（`game.json`、`index.html`、`src/`、`assets/`、`elements/`、`design/`、`tests/`），插件自己的版本快照、检查结果、试玩记录都在项目里的 `.game/`，整个文件夹拷走就带走。`$DSH_HOME/state/game/` 只放项目登记和会话绑定。
- **轻量门**：建项目前必须有游戏名、一句话玩法、元素类型、用户选定的美术风格；缺什么工具就回什么，agent 去问你，不替你编。
- **右栏「游戏」**：试玩（沙箱 iframe，存档存在你的浏览器里）、策划（固定章节，设计支柱置顶，状态 未写/草稿/定稿；「元素与数值」「试玩记录」两章自动生成）、元素（按类型成表）、检查（最近一次的结论与问题）。
- **每轮自动检查**：`game.json` 与元素文件校验 → 本机 Chrome 无头加载跑 2 秒冒烟（报错、`window.dshGame.ready`、画面不能全空）→ 跑 `tests/*.test.js`。失败同一轮里交回 agent 修，最多 2 次；通过就生成新版本，自动确认默认开着时直接进试玩区，关掉后要你点「确认上线」。

## 安装

```sh
dsh plugin --profile <name> add @khorsheed/dsh-game
dsh plugin --profile <name> add @khorsheed/dsh-presets   # 游戏开发模式 preset
```

本包的 `cordis.patch.yml` 插入两行：`game`（服务核心、Remote、每轮检查）与 `game-agent`（`./agent` 入口：工具、提示段、技能），后者**出厂停用**，由 `dsh-gamedev` preset 按会话授予。想让所有会话都有游戏工具，就启用 `game-agent` 行且不用该 preset——两者绝不能同时生效（同名工具会注册两次）。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/game` | 项目登记与会话绑定的目录 |
| `chromePath` | `CHROME_PATH`，再试常见安装位置 | 每轮检查用的 Chrome；找不到时只跑数据校验，浏览器那部分记为跳过 |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：❌ 不支持——每轮检查靠 `agent/turn-stopping` 与 `agent.steer`，preset 靠 `@deepseek-ai/dsh-agent-preset` 行，0.1.5 都没有。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.0-rc.2）。降级项：插件交回 agent 的检查结果是插件来源的上下文消息，0.2.0 聊天视图不显示这类消息（聊天里的折叠行是后续里程碑）；无头检查要本机装有 Chrome。headless profile 没有浏览器消费方，右栏不出现，但检查照常跑。

## 已知限制

- 只支持 2D（原生 canvas + HTML 界面层）；沙箱 CSP 拦掉一切外部请求，代码和资源都得放项目里。
- 宿主没有文生图，画面全靠代码画，美术风格只在能用代码画好的范围里挑。
- 还不能分享给别人玩（导出单文件、发布到 itch.io 是后续里程碑；排行榜、联机要服务器，更后面）。
- 元素和策划在面板里只读：改动在对话里提给 agent。

## 实现原理

- 试玩区与无头检查用同一个加载器（`src/vfs.ts`）：`sandbox="allow-scripts"` 的不透明源 iframe 收到项目文件后，在自己的源里生成 blob URL，改写相对 import 与 CSS `url()`，接管 `fetch`、图片/音频 `src`，再把 `index.html` 写进自身；`localStorage` 由桥接替身代管，写入回传给面板存进浏览器。
- 每轮检查挂在 `agent/turn-stopping`（只在正常结束时触发，用户中止不会被顶掉）；只看绑定了项目、`index.html` 存在、构建文件指纹变了的会话。失败用 `agent.steer` 把结论送回同一轮，每轮最多 2 次，第 3 次失败记为「已停止自动修复」。
- 版本是 `.game/versions/<n>/` 下的构建快照（保留最近 5 个），`current.json` 指向试玩区里的那个。

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/game`）。`probes/` 是动工前的探针脚本，不随包发布。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
