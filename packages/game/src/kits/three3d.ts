/**
 * The `3d-three` kit (proposal 2026-10-21-game-3d §4): three.js plus the
 * package's own thin runtime `dsh3d` (parts-recipe models, the ink / 青绿
 * styles, a 45° camera, and the workbench hooks pick / pause / highlight).
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
- three.js 0.170 已内置，再加插件的薄运行时 dsh3d。代码里直接写 \`import * as THREE from 'three'\` 和 \`import { createWorld, build, ink, toon, flat } from 'dsh3d'\`（不要写路径、不要引 CDN）。
- 风格：\`createWorld({ style })\` 的 style 取 game.json 的 artStyle：
${STYLE_LINES}
  风格只靠 dsh3d 的材质和描边实现：自己加的物体用 \`ink(geometry, toon('#颜色'))\`（卡通材质 + 墨线描边），地形、石头、树用 \`flat('#颜色')\`。别用写实贴图和 PBR 材质。
- 世界：\`const world = createWorld({ style: 'ink', region: (x, z) => '阳坡' })\`，然后
  - \`world.terrain({ size, height: (x, z) => 高度 })\` 地形；\`world.place(obj, x, z)\` 放到地面上
  - \`world.add(obj, { id: 元素id, inst: 实例id, name, state: () => '摆尾中' })\` 登记实体（右栏「指一下」靠它认出东西，state 写当前在干什么）
  - \`world.follow(玩家)\` 镜头跟随（俯视斜 45° 正交镜头）；\`world.onUpdate((dt, t) => {...})\` 写游戏逻辑
  - \`world.step(dt)\` 推进一帧（dshGame.step 就调它），\`world.start()\` 开始实时播放
  - \`world.pick(x, y)\`、\`world.pause(on)\`、\`world.highlight(list)\` 是给面板用的，dshGame 里转发即可
- 外观 look（3D）：部件配方，\`build(元素id或look)\` 拼出模型并自带程序动效：
  \`{ "kind": "parts3d", "base": "quadruped", "proportions": { "bodyLength": 1, "bodyHeight": 0.45, "legLength": 0.35, "headSize": 0.32, "snout": 0.18, "legs": 4, "heads": 1 }, "parts": [{ "type": "ear", "count": 2 }, { "type": "tail", "count": 9, "length": 0.95, "fan": 140, "thickness": 0.09, "color": "accent" }], "palette": { "body": "#e9dfcc", "accent": "#b8442f", "eye": "#1d1d1f" }, "motion": { "tailSway": { "amplitude": 18, "period": 1.6 }, "breath": { "amplitude": 0.02, "period": 2.4 } } }\`
  - base：${BODY_BASES.join(' / ')}（兽、禽、鱼、蛇、人形）。比例：bodyLength、bodyHeight、legLength、headSize、snout、legs（足数，可 6）、heads（首数）；鸟另有 beak；蛇是 length、thickness、segments；人形是 height。
  - parts：ear、horn、tail（count/length/fan/thickness）、wing（count/size）、fin、eye（count，一目、三目都行）、face（style: "human" 是人面）。color 写 palette 的键或 #rrggbb。
  - palette 的键：body、accent、eye，另可 belly、horn、wing、beak、face、skin。motion：tailSway、breath、flap、swim、bob（amplitude 角度，breath/bob 是比例；period 秒）。
  - 山海经式的「其状如 X 而 Y」：X 选 base 和比例，Y 是 parts（九尾 = tail count 9，六足 = legs 6，人面 = face human）。
  - 面数预算：一只精怪 1 万三角面以内，整个场景 15 万以内（\`world.stats()\` 可查）。
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
