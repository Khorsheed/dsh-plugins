/**
 * The `3d-three` kit (proposal 2026-10-21-game-3d §4): three.js plus the
 * package's own thin runtime `dsh3d` (parts-recipe models with an open
 * body/part set, style as data with two starting presets, a 45° camera, and
 * the workbench hooks pick / pause / highlight).
 *
 * Both modules ride every bundle under `_dsh/` and resolve through the
 * loader's bare-import map, so a game writes `import * as THREE from 'three'`
 * and `import { createWorld, build } from 'dsh3d'`. They are read from disk
 * once, on first use: three.js from the pinned `three` dependency, dsh3d from
 * this package's `runtime/` folder. A missing file degrades to a runtime that
 * reports why, so the smoke check names the problem instead of crashing.
 * @module @khorsheed/dsh-game
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOOK3D_HINT, normalizeLook3d } from '../look3d.ts'
import { ART_STYLES_3D, BODY_BASES, type BundleFile } from '../types.ts'
import { BLANK_PROBE } from './canvas2d.ts'
import { KIT_IMPORTS_FILE, KIT_RUNTIME_FILE, type RuntimeKit } from './types.ts'

const THREE_FILE = '_dsh/three.module.js'
const DSH3D_FILE = '_dsh/dsh3d.js'

/** `runtime/dsh3d.js` beside the package root: one level up from `lib/`, two from `src/kits/`. */
function dsh3dPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  return [join(here, '..', 'runtime', 'dsh3d.js'), join(here, '..', '..', 'runtime', 'dsh3d.js')].find(p => existsSync(p))
}

/** The pinned three.js module build (the package's exports only expose the unminified one). */
function threePath(): string | undefined {
  try {
    const entry = createRequire(import.meta.url).resolve('three')
    const min = join(dirname(entry), 'three.module.min.js')
    return existsSync(min) ? min : undefined
  } catch {
    return undefined
  }
}

let cached: Record<string, BundleFile> | undefined

function load(): Record<string, BundleFile> {
  if (cached !== undefined) return cached
  const three = threePath(), dsh3d = dsh3dPath()
  if (three === undefined || dsh3d === undefined) {
    // Not cached: a later install can still fix it without a restart.
    const missing = [three === undefined ? 'three.js' : '', dsh3d === undefined ? 'dsh3d' : ''].filter(Boolean).join('、')
    return { [KIT_RUNTIME_FILE]: { type: 'text/javascript', text: `console.error(${JSON.stringify(`3D 套件缺文件：${missing}（插件安装不完整）`)})` } }
  }
  cached = {
    [THREE_FILE]: { type: 'text/javascript', text: readFileSync(three, 'utf8') },
    [DSH3D_FILE]: { type: 'text/javascript', text: readFileSync(dsh3d, 'utf8') },
    [KIT_IMPORTS_FILE]: { type: 'application/json', text: JSON.stringify({ three: THREE_FILE, dsh3d: DSH3D_FILE }) },
  }
  return cached
}

const STYLE_LINES = ART_STYLES_3D.map(s => `- \`${s.id}\` ${s.label}：${s.look}`).join('\n')

/** The 3D kit. */
export const THREE_3D: RuntimeKit = {
  id: '3d-three',
  version: 1,
  label: '3D（three.js）',
  runtimeFiles: load,
  normalizeLook: normalizeLook3d,
  lookHint: LOOK3D_HINT,
  // dsh3d's renderer keeps its drawing buffer, so the 2D read-back works on the WebGL canvas too.
  blankProbe: BLANK_PROBE,
  styles: ART_STYLES_3D,
  skillSection: `## 运行环境 · 3D 套件（game.json 的 runtime.kit 是 3d-three）
- three.js 0.170 已内置，再加插件的薄运行时 dsh3d。代码里直接写 \`import * as THREE from 'three'\` 和 \`import { createWorld, build, defineBase, definePart, ink, toon, flat } from 'dsh3d'\`（不要写路径、不要引 CDN）。
- 题材、世界、角色全由用户的描述决定；插件只给机制和几个起点，别往用户没提的题材上靠。
- **风格是数据**：写在 game.json 的 \`style3d\`，按用户描述的画风生成，createWorld 自动读取：
  \`{ "preset": "ink", "bg": "#efe7d6", "ground": "#e5dbc5", "ground2": "#d6c9ac", "water": "#a7bab4", "outline": "#2a2622", "outlineWidth": 0.032, "shades": 3, "fog": [26, 62], "light": 1.1 }\`
  preset 是起点（下面两个），其余键覆盖它；outlineWidth 为 0 就没有描边，shades 是卡通明暗层数（2 硬朗 … 5 柔和）。用户说「霓虹赛博」「糖果色」「黑白剪影」之类，就据此调颜色、描边和层数；artStyle 写 custom:用户的描述。现成起点：
${STYLE_LINES}
  自己加的物体用 \`ink(geometry, toon('#颜色'))\`（卡通材质 + 描边），地形、石头、树用 \`flat('#颜色')\`，这样换 style3d 时全场跟着变。别用写实贴图和 PBR 材质。
- 世界：\`const world = createWorld({ region: (x, z) => '区域名' })\`，然后
  - \`world.terrain({ size, height: (x, z) => 高度 })\` 地形；\`world.place(obj, x, z)\` 放到地面上
  - \`world.add(obj, { id: 元素id, inst: 实例id, name, state: () => '当前在干什么' })\` 登记实体（右栏「指一下」靠它认出东西）
  - \`world.follow(玩家)\` 镜头跟随（俯视斜 45° 正交镜头）；\`world.onUpdate((dt, t) => {...})\` 写游戏逻辑
  - \`world.step(dt)\` 推进一帧（dshGame.step 就调它），\`world.start()\` 开始实时播放
  - \`world.pick(x, y)\`、\`world.pause(on)\`、\`world.highlight(list)\` 是给面板用的，dshGame 里转发即可
- 外观 look（3D）：部件配方，\`build(元素id或look)\` 拼出模型并自带程序动效。例子（一只长尾猫）：
  \`{ "kind": "parts3d", "base": "quadruped", "proportions": { "bodyLength": 0.9, "bodyHeight": 0.4, "legLength": 0.3, "headSize": 0.34, "snout": 0.1 }, "parts": [{ "type": "ear", "count": 2 }, { "type": "tail", "count": 1, "length": 0.9, "thickness": 0.06 }], "palette": { "body": "#f2a65a", "accent": "#7a4a2a", "eye": "#1d1d1f" }, "motion": { "tailSway": { "amplitude": 20, "period": 1.4 }, "breath": { "amplitude": 0.02, "period": 2.4 } } }\`
  - 内置身体 base：${BODY_BASES.join(' / ')}（四足、禽、鱼、蛇形、人形）。比例：bodyLength、bodyHeight、legLength、headSize、snout、legs（足数）、heads（头数）；禽另有 beak；蛇形是 length、thickness、segments；人形是 height。
  - 内置部件 parts：ear、horn、tail（count/length/fan/thickness）、wing（count/size）、fin、eye（count）、face（style: "human"）。color 写 palette 的键或 #rrggbb。
  - palette 的键：body、accent、eye，另可 belly、horn、wing、beak、face、skin。motion：tailSway、breath、flap、swim、bob（amplitude 角度，breath/bob 是比例；period 秒）。
  - **内置的不够就自己注册**（机器人、史莱姆、车、建筑……）。注册代码一律放 \`src/looks.js\`（入口先 \`import './looks.js'\` 再 build）——右栏的外观预览只加载这个文件，写在别处面板就拼不出来：
    \`defineBase('robot', (look, kit) => { const g = new kit.THREE.Group(), body = new kit.THREE.Group(); g.add(body); body.add(kit.ink(new kit.THREE.BoxGeometry(0.8, 0.6, 0.5), kit.toon(kit.color('body', '#888888')))); return { g, body } })\`
    \`definePart('antenna', ({ spec, anchors, kit }) => { const a = kit.ink(new kit.THREE.CylinderGeometry(0.02, 0.02, spec.length ?? 0.4), kit.toon(kit.color(spec.color ?? 'accent', '#ff0000'))); a.position.y = 0.5; anchors.body.add(a); return { update: t => { a.rotation.z = 0.2 * Math.sin(t * 3) } } })\`
    之后配方里就能写 \`"base": "robot"\`、\`{ "type": "antenna", "length": 0.5 }\`（自定义部件的其他参数在 spec.extra 里）。注册过的名字用户在面板里同样能调。
  - 面数预算：单个元素 1 万三角面以内，整个场景 15 万以内（\`world.stats()\` 可查）。
- dshGame 约定照旧，3D 推荐这样接：
\`\`\`js
window.dshGame = {
  ready: true,
  step: dt => world.step(dt),
  input(key, down) { /* 记到按键状态里，onUpdate 里读 */ },
  state: () => ({ player: { x: player.position.x, z: player.position.z } }),
  pick: (x, y) => world.pick(x, y),
  pause: on => world.pause(on),
  highlight: list => world.highlight(list),
}
world.start()
\`\`\`
`,
}
