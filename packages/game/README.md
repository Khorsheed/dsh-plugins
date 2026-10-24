# @khorsheed/dsh-game

[English](README.en.md) | 中文

和 agent 一起做小游戏：对话里定玩法和细节，右栏「游戏」看分章节的策划、玩每一轮通过检查的最新版本。

没做过游戏策划也能上手——agent 既写代码也当策划搭档：先和你定一句话玩法、有哪几类元素、选哪种美术风格（从示例里挑），再动手做出能玩的最小版本，之后照着你玩下来的感受一点点改。每一轮结束，插件自动检查改过的项目（数据校验、加载冒烟、agent 随代码写的测试脚本）；没过就把问题交回 agent 在同一轮里修（最多 2 次），过了就直接进试玩区。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-workbench.png" width="640" alt="左边会话里 agent 在改游戏，右栏「游戏」页签正在试玩最新版本，下面是参数滑块">

## 特性

- **先定玩法，再动手**——建项目前要有游戏名、一句话玩法、元素类型和你选定的美术风格；缺哪样 agent 就来问你，不替你编。美术风格画廊把同一个小场景用六种风格画出来，挑一个即可。
- **尽早做出能玩的最小版本**——agent 先做一个能玩起来的最小版本，再照你的试玩感受迭代。支持 2D（默认）和 3D 两种运行时。
- **每轮自动检查**——每轮结束校验数据、在本机 Chrome 无头加载跑 2 秒冒烟、再跑 agent 写的测试；没过就交回 agent 在同一轮修（最多 2 次），过了就生成新版本进试玩区（关掉「自动上线」后要你点「确认上线」）。
- **试玩、调参**——试玩区默认只显示封面，点「开始试玩」才运行；游戏声明的参数做成滑块，拖动只影响正在玩的这局，觉得对了「定稿」写回并提交成新版本，或「告诉 agent」写进输入框。「点选」认出画面里点到的是哪个元素，可一键引用到对话。
- **本轮改动卡片**——agent 每轮做完，回复末尾出现一张卡片，列出这轮上线的版本、检查结果、改动的元素、策划章节、参数和代码，每行「查看」直接跳到右栏对应位置。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-turn-card.png" width="640" alt="agent 回复末尾的本轮改动卡片：版本、检查结果、改动的元素与策划章节，每行带「查看」">

- **看得见的东西都能改外观**——主角、敌人、道具，连树、石头、建筑这类场景物件都有外观，都出现在「元素」页里：像素编辑器直接画，3D 元素可拖动转盘查看、折叠的「细调外观」改比例和部件；「让 agent 改外观」一次给 3 个方案并排展示，挑一个即写进元素。
- **面板里改，提交成新版本**——在面板里改外观、字段、设定都直接存进项目，预览立刻跟着变；页签上方出现「N 项修改还没进游戏 · 提交为新版本」，走同一套检查，通过就换进试玩区，没过可以「交给 agent 修」。agent 读项目时能看到你改过什么，不会改回去。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-elements.png" width="640" alt="「元素」页打开一个元素：外观编辑器、「让 agent 改外观」的三个方案并排、下面是设定卡片">

- **中途发版**——agent 请你试玩任何东西之前，必须先当场跑检查并发出一个通过的版本（`game_publish`），你点开就是能玩的最新版。
- **版本与回滚**——「版本」页有最近一次检查（三层结论、问题、无头截图）和版本时间线：线上 / 候选 / 已退回 / 历史，候选版本可以「先试玩 / 退回 / 确认上线」，随时切回旧版本、与线上对比文件差异，或导出单文件 `.html` 分享。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-versions.png" width="640" alt="「版本」页：最近一次检查的结论与无头截图，下面是线上、候选、历史版本的时间线">

- **元素设定**——每个元素有一张「设定」卡片：它是谁、什么脾气、遇到玩家会怎样，agent 照着写行为和文案；策划里自动汇总成「元素设定」一章。
- **分章节的策划**——一页纸（玩法、元素类型、风格）与设计支柱置顶，章节就地展开、可直接改；「元素与数值」自动画对比条，「试玩记录」自动写。
- **多个项目随时切换**——标题就是项目切换器，项目卡片列出最近的画面、线上版本、风格、元素数和一句话玩法；第一张「新建项目」把开场白写进对话框。

模型侧是 `game_open` / `game_read` / `game_propose` / `game_publish` 四个工具和 `gamedev`（做法）、`game-design`（带你做策划）两个技能。

## 安装

推荐装游戏开发套件，连同基础体验一起：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```

装好后重启实例，在会话的模式选择器里切到「游戏开发模式」：游戏开发者兼策划导师的人格，加上上面的工具与技能。

进阶：只装本包。

```sh
dsh plugin --profile web add @khorsheed/dsh-game
```

单装时游戏工具与技能**所有会话可用**（与 canvas 对齐）。想让它们只出现在游戏开发模式，就在 profile 里停用 `game-agent` 行并改装套件。卸载用对应的 `remove`。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/game` | 项目登记与会话绑定的目录 |
| `chromePath` | `CHROME_PATH`，再试常见安装位置 | 每轮检查用的 Chrome；找不到时只跑数据校验，浏览器那部分记为跳过 |

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：❌ 不支持——每轮检查靠 `agent/turn-stopping` 与 `agent.steer`，preset 靠 `@deepseek-ai/dsh-agent-preset` 行，0.1.5 都没有。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。降级项：插件交回 agent 的检查结果是插件来源的上下文消息，0.2.0 聊天视图不显示这类消息（聊天里的折叠行是后续里程碑）；无头检查要本机装有 Chrome。headless profile 没有浏览器消费方，右栏不出现，但检查照常跑。

## 已知限制

- **两种运行时**——2D（原生 canvas + HTML 界面层，默认）和 3D（建项目时选 `runtime: 3d`：内置 three.js 0.170 与薄运行时 dsh3d，部件配方拼精怪、水墨 / 青绿两种风格、俯视斜 45° 镜头）。沙箱拦掉一切外部请求，代码和资源都得放项目里。3D 的 glTF 外观目前只显示占位方块（加载器随精修一起做）。
- **画面全靠代码画**——宿主没有文生图，美术风格只在能用代码画好的范围里挑。
- **还不能分享给别人玩**——导出单文件之外，发布到 itch.io 是后续里程碑；排行榜、联机要服务器，更后面。
- **检查未通过的提示藏在步骤分组里**——插件放进对话的「检查未通过 n/2」折叠行会被宿主收进本轮的步骤分组：轮次结束后要展开「已完成，用时…」和步骤分组才看得到（宿主决定哪些节点独立显示的名单不对插件开放）。同样的信息在右栏「版本」里也有。
- **外观只能是像素行格式**——元素外观是像素行格式（`look`）；SVG / 矢量外观还不能在面板里编辑。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**项目在工作区里。** 一个项目就是会话工作区里的一个文件夹（`game.json`、`index.html`、`src/`、`assets/`、`elements/`、`design/`、`tests/`），插件自己的版本快照、检查结果、试玩记录都在项目里的 `.game/`，整个文件夹拷走就带走。`$DSH_HOME/state/game/` 只放项目登记和会话绑定。

**两行挂载。** 本包的 `cordis.patch.yml` 插入两行：`game`（服务核心、Remote、每轮检查）与 `game-agent`（`./agent` 入口：工具、提示段、技能），两行都默认使能。`@khorsheed/dsh-gamedev-suite` 的 `dsh-gamedev` 模式包不重复挂载根行，只在自己的 preset 组合里授予同一入口：宿主 0.2.x 下该模式的会话看到 scoped 副本遮蔽全局行，不再双注册崩 boot（宿主 scoped.spec.ts 钉死）。

**轻量门。** `game_open` 建项目前检查游戏名、一句话玩法、元素类型、用户选定的美术风格；缺什么工具就回什么。

**试玩区与无头检查共用一个加载器**（`src/vfs.ts`）：`sandbox="allow-scripts"` 的不透明源 iframe 收到项目文件后，在自己的源里生成 blob URL，改写相对 import 与 CSS `url()`，接管 `fetch`、图片/音频 `src`，再把 `index.html` 写进自身；`localStorage` 由桥接替身代管，写入回传给面板存进浏览器。

**每轮检查**挂在 `agent/turn-stopping`（只在正常结束时触发，用户中止不会被顶掉）；只看绑定了项目、`index.html` 存在、构建文件指纹变了的会话。三层依次是：`game.json` 与元素文件校验 → 本机 Chrome 无头加载跑 2 秒冒烟（报错、`window.dshGame.ready`、画面不能全空）→ 跑 `tests/*.test.js`。失败用 `agent.steer` 把结论送回同一轮，每轮最多 2 次，第 3 次失败记为「已停止自动修复」。`game_publish` 按需跑同一套检查；agent 向你提问并不会结束这一轮，所以技能和模式人格规定请你试玩前必须先发出通过的版本。

**版本**是 `.game/versions/<n>/` 下的构建快照（保留最近 10 个），`current.json` 指向试玩区里的那个，`versions.json` 记历史（含已退回）。

**用户层**在 `.game/user.json`：滑块试玩值、agent 还没看过的改动（`game_read` 总览列出一次后清掉）、还没提交成版本的面板修改（下一个版本——不管是面板提交还是 agent 发版——把它们写进版本说明「面板修改：…」后清掉）、换风格请求；外观方案在 `.game/proposals.json`。项目中途换风格会让 agent 全部重画，结果一律走候选版本。

**运行时接口。** 参数、元素由加载器在启动前放进 `window.dshParams` / `window.dshElements`，滑块试玩值通过 postMessage 热替换，游戏每帧读即可生效；`dshDraw` 画像素外观，`dshGame.pick(x, y)` 支持点选。3D 场景物件在 `src/looks.js` 里用 `defineBase` 登记，建一次、在场景里克隆，元素网格因此能显示和细调它们。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/game`）。`probes/` 是动工前的探针脚本，不随包发布。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
