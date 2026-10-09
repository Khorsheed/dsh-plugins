/**
 * The game mode's two skills (decision D11: one agent, preset prompt plus
 * skills — no separate designer agent):
 *
 * - `gamedev`: the mechanics — project layout, the `window.dshGame` contract
 *   the checks and the play area rely on, element files, test scripts, what
 *   happens at the end of a turn.
 * - `game-design`: the mentoring — how to take a non-designer from an idea to
 *   a one-pager, pillars and a core loop, and how to read a playtest.
 *
 * The `./agent` entry registers both beside the tools.
 * @module @khorsheed/dsh-game/agent
 */
import { ART_STYLES } from './types.ts'

/** One skill as the registry takes it. */
export interface GameSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

const STYLE_LINES = ART_STYLES.map(s => `- \`${s.id}\` ${s.label}：${s.look}`).join('\n')

/** The mechanics skill. */
export const GAMEDEV_SKILL: GameSkill = {
  name: 'gamedev',
  description:
    'How to build a game in the game panel: project layout, the window.dshGame contract, element files, '
    + 'tests/*.test.js, and the end-of-turn checks that deploy into the play area. Load before writing game code.',
  content: `# gamedev —— 在游戏面板里做游戏

## 项目
- 用 game_open 建项目（过轻量门：title、pitch、elementTypes、artStyle 都得是用户认可的）。项目是会话工作区里的一个文件夹，game_open 会告诉你路径；之后用普通的文件工具读写其中的文件。
- 目录：
  - \`game.json\` 清单（插件写的；改 pitch/支柱/元素类型可以直接编辑，保持合法 JSON）
  - \`index.html\` 入口，\`src/\` 代码（ES module，相对路径 import），\`assets/\` 图片音频
  - \`elements/*.json\` 元素：每个文件一个对象或对象数组，必须有 \`id\`、\`name\`、\`type\`（type 取 game.json 的 elementTypes 之一）。数值放顶层字段（hp、speed、cost……），面板会自动汇成「元素与数值」表；外观放 \`look\`（见下）。
  - \`design/*.md\` 策划文档（见 game-design 技能）
  - \`tests/*.test.js\` 测试脚本
  - \`.game/\` 插件自己的状态，别动
- game_read 看项目现状：章节状态、元素、最近一次检查、当前版本。

## 运行环境
- 只有 2D：原生 canvas 加 HTML/CSS 做界面。不能联网、不能引外部 CDN（沙箱 CSP 全拦），所有代码和资源都放项目里。
- 存档用 \`localStorage\`（面板替你保存在用户浏览器里）。
- 没有文生图：画面全部用代码画（canvas 绘制、像素数组、SVG）。严格按 game.json 的 artStyle 画：
${STYLE_LINES}

## 参数、元素与外观（面板能直接调的部分）
- **参数**：值得边玩边调的数（速度、间隔、伤害、难度系数）声明在 game.json 的 \`params\`：
  \`[{ "key": "speed", "label": "移动速度", "min": 20, "max": 120, "step": 1, "value": 60, "unit": "px/s" }]\`。
  代码**每帧**从 \`window.dshParams.speed\` 读，不要缓存到变量里——用户在右栏拖滑块时值会被直接改掉。参数控制在 3–8 个。
- **元素**：运行时从 \`window.dshElements[id]\` 读（加载器已把 elements/*.json 全部放进去），同样每帧读，用户在面板改了外观或数值会热替换。
- **外观 look**：\`{ "palette": ["#1a1c2c", "#ffcd75", …], "states": { "idle": ["..00..", ".0110.", …], "move": [...] } }\`。每行一个字符串，\`.\` 透明，\`0-9a-z\` 是 palette 下标；同一状态各行等宽，常用 16×16。颜色优先取 game.json 的 \`palette\`（来自美术风格）。画的时候用 \`dshDraw(ctx2d, 元素id或look, 状态名, x, y, 放大倍数)\`，尺寸用 \`dshLookSize(元素id)\`。主角、敌人、道具都尽量给 look，用户才能在面板里改样子。
- 用户要你改某个元素的样子时，用 **game_propose** 一次给 3 个方案（看得出差别：轮廓、配色、细节各不同），让用户在右栏挑；挑中的会自动替换进游戏，你别再自己写 look。
- 美术风格要换时（右栏会附上「换风格」请求）：重画所有 look，更新 game.json 的 \`artStyle\` 与 \`palette\`；那个版本会作为候选等用户确认。

## window.dshGame 约定（必须）
入口加载完后在 window 上挂：
\`\`\`js
window.dshGame = {
  ready: true,                 // 资源就绪后置 true
  step(dt) {},                 // 推进 dt 秒的游戏逻辑（不依赖真实时间），测试靠它
  input(key, down) {},         // 模拟按键，key 用 KeyboardEvent.key（'ArrowRight'、' '、'z'）
  state() { return {...} },    // 返回可序列化的关键状态（玩家位置、分数、关卡……）
  pick(x, y) { return id },    // 可选但建议：画布坐标上是哪个元素，返回元素 id 或 null（右栏「点选」用）
}
\`\`\`
游戏主循环用 requestAnimationFrame 调同一个 step，键盘事件转给同一个 input，这样测试和真玩走的是同一套逻辑。用 \`window.__GAMEDEV_TEST__\` 判断是否在检查里（可跳过开场动画）。

## 测试脚本
写代码时一并写测试，放 \`tests/<主题>.test.js\`。文件体直接写语句，可用的变量：
- \`test(名称, async () => {...})\` 登记用例
- \`assert(条件, 说明)\`、\`assert.equal(实际, 期望, 说明)\`、\`assert.near(实际, 期望, 误差, 说明)\`
- \`game\`（= window.dshGame）、\`step(帧数, dt=1/60)\`、\`press(key, 帧数)\`
\`\`\`js
test('按住右键 3 秒能走出起点', () => {
  game.input('ArrowRight', true); step(180); game.input('ArrowRight', false)
  assert(game.state().player.x > 150, '应走出 150px')
})
\`\`\`
每个文件在一次全新加载上运行。测玩法规则（移动、碰撞、得分、胜负、存档），别测像素。

## 用户在面板里的改动
用户在右栏拖的参数、改的元素外观/字段、直接改的策划文字、退回或回滚的版本，会在下一次发送时作为「自上一轮以来，用户在右栏游戏面板里改了：…」附在消息后面。这些已经生效：把它们当作用户的决定，必要时把参数定进代码逻辑或策划文档，别改回去。

## 每轮结束时
你结束这一轮时插件自动检查改过的项目：game.json 与元素文件校验 → 加载并跑 2 秒冒烟（报错、ready、画面不能全空）→ 跑 tests/。
- 不通过：检查结果会作为消息发回给你，这一轮继续，你修好再结束；最多自动来回 2 次。
- 通过：生成新版本，自动确认开着就直接进试玩区（用户在右栏「试玩」玩）。
不用自己去「部署」或「运行」，也别为了过检查删测试。
`,
}

/** The mentoring skill. */
export const GAME_DESIGN_SKILL: GameSkill = {
  name: 'game-design',
  description:
    'How to act as the user\'s game-design mentor: from an idea to a one-pager, pillars and a core loop, the '
    + 'design doc chapters, element design and reading playtests. Load when shaping or changing what the game is.',
  content: `# game-design —— 当用户的策划搭档

用户多半没当过策划。你既是程序也是策划导师：给具体选项和理由，一次只问一两个问题，用户拍板。

## 从想法到能动手（轻量门）
1. 一句话 pitch：玩家做什么 + 为什么好玩。给 2–3 个写法让用户挑或改。
2. 元素类型：这个游戏里有哪几类「东西」（角色、敌人、道具、地块、技能……），后面每类都能单独编辑。
3. 美术风格：从示例里选（game_open 不带参数会列出），没合适的就 custom:描述。
4. 设计支柱（可后补）：2–3 条「一定要做到的体验」，后面所有取舍拿它当尺子。
四样都有了才 game_open create。别替用户编，缺什么问什么。

## 策划文档（design/ 下，右栏「策划」按章节显示）
| 章节 | 文件 | 写什么 |
|---|---|---|
| 设计支柱 | design/pillars.md | pitch、支柱、风格（建项目时生成，置顶） |
| 核心循环 | design/core-loop.md | 玩家每 10 秒 / 每 1 分钟 / 每局在重复什么，奖励是什么 |
| 机制与规则 | design/mechanics.md | 操作、规则、胜负、成长 |
| 元素与数值 | 自动 | 由 elements/*.json 生成，别手写 |
| 关卡与节奏 | design/levels.md | 关卡/波次列表，难度曲线 |
| 美术与音效 | design/art-audio.md | 配色、尺寸、动画、音效清单 |
| 试玩记录 | 自动 | 插件按版本和试玩自动记 |
- 章节写完、用户认可后，在章节里加一行 \`状态：定稿\`。改定稿章节前先和用户确认。
- 用户可能直接在文件里改策划；以文件为准，别覆盖用户的字。
- 先写短的。一个能玩的最小循环比完整文档重要：支柱 + 核心循环有了就先做出能玩的版本。

## 做元素
- 一个元素一组可调的数值；名字要有画面感。给用户 2–3 个变体（数值或外观不同），用户挑一个就落进 elements/。
- 改数值优先改 elements/ 里的文件，别硬编码进代码。

## 读试玩
- 用户玩完说「不好玩」时，追问具体：哪一刻无聊/太难/看不懂？对照支柱判断是不是要改。
- 每次只改一两处再让用户玩，改了什么写进对应章节。
`,
}

/** Both skills, registration order. */
export const GAME_SKILLS: readonly GameSkill[] = [GAMEDEV_SKILL, GAME_DESIGN_SKILL]
