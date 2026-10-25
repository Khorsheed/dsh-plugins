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
 *
 * three's own add-ons (`three/addons/…`: GLTFLoader, EffectComposer, …) map
 * to `_dsh/addons/` too, but only the ones a project's code imports ride its
 * bundle, with whatever they import in turn: the whole add-on tree is far too
 * big to carry on every load.
 * @module @khorsheed/dsh-game
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOOK3D_HINT, normalizeLook3d } from '../look3d.ts'
import { ART_STYLES_3D, BODY_BASES, type BundleFile } from '../types.ts'
import { BLANK_PROBE } from './canvas2d.ts'
import { KIT_IMPORTS_FILE, KIT_RUNTIME_FILE, type RuntimeKit } from './types.ts'

const THREE_FILE = '_dsh/three.module.js'

/** The 2D probe after one render: under the checks dsh3d's \`step\` advances logic only, so the canvas is drawn on demand here. */
const BLANK_PROBE_3D = `(window.dsh3dWorld && window.dsh3dWorld.render(), ${BLANK_PROBE})`
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
    // dsh3d loads glTF looks with three's GLTFLoader: always aboard, since a panel preview may
    // load a model the live version does not carry yet.
    ...addonFiles({ 'dsh3d.js': { type: 'text/javascript', text: "import 'three/addons/loaders/GLTFLoader.js'" } }),
    // A key ending in '/' maps a prefix (import-map style).
    [KIT_IMPORTS_FILE]: { type: 'application/json', text: JSON.stringify({ three: THREE_FILE, dsh3d: DSH3D_FILE, 'three/addons/': ADDONS_DIR }) },
  }
  return cached
}

const ADDONS_DIR = '_dsh/addons/'
/** An add-on set larger than this is cut off (the loader then reports the missing module). */
const ADDONS_MAX_BYTES = 6 * 1024 * 1024

/** three's `examples/jsm` folder (what `three/addons/` names). */
function addonsRoot(): string | undefined {
  try {
    const dir = join(dirname(createRequire(import.meta.url).resolve('three')), '..', 'examples', 'jsm')
    return existsSync(dir) ? dir : undefined
  } catch {
    return undefined
  }
}

const SPECIFIER = /(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)(['"])([^'"]+)\1/g

/**
 * The add-on files a project's scripts import (`three/addons/x`), plus the
 * add-on files those import relatively, as bundle entries under `_dsh/addons/`.
 * @param project - the project's bundle files.
 * @returns the entries to add to the bundle.
 */
export function addonFiles(project: Readonly<Record<string, BundleFile>>): Record<string, BundleFile> {
  const root = addonsRoot()
  if (root === undefined) return {}
  const queue: string[] = []
  for (const [path, file] of Object.entries(project)) {
    if (!/\.m?js$/.test(path) || !('text' in file)) continue
    for (const m of file.text.matchAll(SPECIFIER)) if (m[2]!.startsWith('three/addons/')) queue.push(m[2]!.slice('three/addons/'.length))
  }
  const out: Record<string, BundleFile> = {}
  let total = 0
  while (queue.length > 0) {
    const rel = posix.normalize(queue.shift()!)
    if (rel.startsWith('..') || rel.startsWith('/') || out[ADDONS_DIR + rel] !== undefined) continue
    const full = normalize(join(root, rel))
    if (!full.startsWith(root) || !existsSync(full)) continue
    const text = readFileSync(full, 'utf8')
    if (total + text.length > ADDONS_MAX_BYTES) break
    total += text.length
    out[ADDONS_DIR + rel] = { type: 'text/javascript', text }
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[2]!
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(posix.join(posix.dirname(rel), spec))
    }
  }
  return out
}

const STYLE_LINES = ART_STYLES_3D.map(s => `- \`${s.id}\` ${s.label}：${s.look}`).join('\n')

/** The 3D kit. */
export const THREE_3D: RuntimeKit = {
  id: '3d-three',
  version: 1,
  label: '3D（three.js）',
  runtimeFiles: project => (project === undefined ? load() : { ...load(), ...addonFiles(project) }),
  normalizeLook: normalizeLook3d,
  lookHint: LOOK3D_HINT,
  // dsh3d's renderer keeps its drawing buffer, so the 2D read-back works on the WebGL canvas too.
  blankProbe: BLANK_PROBE_3D,
  styles: ART_STYLES_3D,
  skillSection: `## 运行环境 · 3D 套件（game.json 的 runtime.kit 是 3d-three）
- three.js 0.170 已内置，再加插件的薄运行时 dsh3d。代码里直接写 \`import * as THREE from 'three'\` 和 \`import { createWorld, build, defineBase, definePart, ink, toon, flat } from 'dsh3d'\`（不要写路径、不要引 CDN）。
- 题材、世界、角色全由用户的描述决定；插件只给机制和几个起点，别往用户没提的题材上靠。
- **风格是数据**：写在 game.json 的 \`style3d\`，按用户描述的画风生成，createWorld 自动读取：
  \`{ "preset": "ink", "bg": "#efe7d6", "ground": "#e5dbc5", "ground2": "#d6c9ac", "water": "#a7bab4", "outline": "#2a2622", "outlineWidth": 0.032, "shades": 3, "fog": [26, 62], "light": 1.1 }\`
  preset 是起点（下面两个），其余键覆盖它；outlineWidth 为 0 就没有描边，shades 是卡通明暗层数（2 硬朗 … 5 柔和）。用户说「霓虹赛博」「糖果色」「黑白剪影」之类，就据此调颜色、描边和层数；artStyle 写 custom:用户的描述。现成起点：
${STYLE_LINES}
  自己加的物体用 \`ink(geometry, toon('#颜色'))\`（卡通材质 + 描边），地面起伏、石头、树这类场景用 \`flat('#颜色')\`，这样换 style3d 时全场跟着变。别用写实贴图和 PBR 材质。
- 世界：\`const world = createWorld({ region: (x, z) => '区域名' })\`，然后
  - \`world.terrain({ size, height: (x, z) => 高度 })\` 地形；\`world.place(obj, x, z)\` 放到地面上
  - **能站上去的模型**（楼梯、平台、桥、屋顶）：\`world.add(obj, { walkable: true })\` 或 \`world.walkable(obj)\`。角色移动时用 \`world.groundAt(x, z, 脚底高度 + 台阶高)\` 取落脚高度：只认这个高度以下最高的面，所以能一级级爬楼梯，不会被吸到头顶的屋顶上。要挡墙就再问一次不设上限的 \`groundAt(x, z)\`，比脚底高出一个台阶以上就别走过去。它只管「站在哪」，不管撞墙、滑坡。
  - \`world.add(obj, { id: 元素id, inst: 实例id, name, state: () => '当前在干什么' })\` 登记实体（右栏「指一下」靠它认出东西）
  - \`world.scatter(元素id, 数量或位置列表, { seed, spread, center, scale: [0.85, 1.15] })\` 把一种元素批量撒在地面上：外观只生成一次、批量绘制，每棵按地形高度落地、随机朝向和大小（同一个 seed 每次摆得一样）；点到任意一棵，「指一下」认出是哪个元素、第几棵。树林、石滩、草地都用它，别自己循环 clone。加 \`sway: { amplitude: 0.06, period: 2.4 }\` 让草木随风摆（越高处摆得越大，每棵错开；影子不跟着摆）；除此之外撒出来的是静物，没有逐棵动效。
  - **多个场景**（地图上的几座山、室内外）：\`world.enterScene('场景名', w => { w.terrain(…); w.scatter(…); w.add(…); w.onUpdate(…) })\`。切到下一个场景时，上一个场景里登记的地形、实体、批量物件、onUpdate 全部移除并释放；在任何场景之外登记的（玩家、镜头跟随）保留。各场景的底色、地面颜色、水色、雾、光照写在 game.json 的 \`style3d.scenes\`：\`{ "北坡": { "bg": "#cfd6dc", "ground": "#d8dcd6", "fog": [12, 40], "light": 0.8 } }\`（名字由游戏自己定；明暗层数和描边全局共用，不能按场景换）。别在同一个场景里堆所有区域，也别手动去删 scene 里的东西。
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
  - **场景物件也走配方**：树、石头、草丛、远山、建筑这类有形状的元素，同样在 \`src/looks.js\` 里 defineBase 注册造型（用 \`kit.flat(kit.color('body', '#…'))\`，尺寸读 \`look.proportions\`），元素文件写 \`look\`，成片的用 \`world.scatter(元素id, …)\` 撒开、单个的 \`build(元素id)\`（数量、分布范围这类仍是元素字段）。别在 main.js 里直接手写几何体——那样右栏看不到它的样子，用户也没法调。只有地面高度场（world.terrain）和水面这种铺满整个场景的不算元素。
  - 面数预算：单个元素 1 万三角面以内，同屏一个场景 15 万以内（\`world.stats()\` 可查，批量物件按份数算）。这是建议不是硬限制，超了先看帧率。
- 贴图与素材：图片放 \`assets/\`，\`new THREE.TextureLoader().load('assets/xx.png')\` 就能用（贴到 toon/flat 材质的 map 上）；纸纹、墨晕这类也可以用 canvas 现画，再 \`new THREE.CanvasTexture(canvas)\`，不用另存文件。
- **模型文件做外观（glTF）**：Blender 做的角色、建筑导出成 .glb 放进 \`assets/\`，元素文件写 \`"look": { "kind": "gltf", "src": "assets/yumin.glb", "scale": 1, "material": "toon" }\`。代码里照样 \`build('yumin')\`：它立刻返回，模型加载完自己出现（要等就 \`await model.userData.loaded\` 或 \`await loaded()\`）。\`material\` 取 \`toon\`（默认：套当前风格的卡通明暗和描边，保留模型的颜色、顶点色和贴图）或 \`original\`（模型自己的材质，默认不描边）；\`outline: true/false\` 单独开关描边。右栏能预览、切换材质、调大小。导出建议：Y 轴朝上、单位米、原点在脚底、**脸朝 +X**（插件的约定，内置的异兽也是；在 Blender 里就是让角色面向 +X 轴，glTF 默认的 +Z 朝向要转过来）、贴图打包进 .glb、单个模型 1 万面以内。右栏预览按这个约定拍正面偏 3/4；某个元素想换默认角度，写 \`"preview": { "yaw": 35, "pitch": 18 }\`（度数：yaw 0 正面、90 侧面、180 背面，pitch 往下看的角度），配方外观也能写。检查会等模型加载完再截图、跑测试；外观引用的文件不在项目里，检查会拦下。用现成的 CC0 素材时，在 \`assets/LICENSES.md\` 记下来源和授权。
  - 骨骼动画：Blender 里每个动作做成一个 Action（名字就是动画名，如 idle、walk），导出时勾选动画。模型加载后自动循环播放 \`look.animation\` 指定的那个，没写就挑名字带 idle / 待机 / stand 的，再没有就第一个。代码里 \`model.userData.play('walk')\` 切换（默认 0.2 秒过渡；\`{ loop: false }\` 只播一遍），\`model.userData.animations\` 是全部动画名（加载完才有）。动画跟着 world 的时钟走：模型要 \`world.add\` 登记（或者自己每帧调 \`model.userData.update(world.time)\`），测试里 \`step\` 照样推进动画。描边跟着骨骼动；「指一下」能点中摆着姿势的角色。右栏转盘下面列出全部动画，点一下就播。
  - 按名字微调（游戏和右栏一致，都由 build 生效）：\`"tint": { "冠": "#c9a23a" }\` 按材质名换基础色（材质用了顶点色时是相乘，会偏暗）；\`"bones": { "head": { "scale": 1.2, "rotate": [0, 10, 0] } }\` 按骨头名缩放（一个数或 [x,y,z]，子骨头跟着变）、加旋转（度），叠在动画之上，播动作也不会被冲掉；\`"morphs": { "smile": 0.6 }\` 按形态键名设权重，描边跟着变形。所以 Blender 里材质、骨头、形态键要起有意义的名字（羽_青、冠、head、wing.L、smile……）。右栏「细调外观」读出模型里的这些名字，列成色块和滑块（带 DEF-/MCH-/ORG- 前缀的绑定辅助骨默认不列，可以搜）。代码里加载后改了的东西右栏看不到，能写进外观的就写进外观。
- three 自带的扩展直接引：\`import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'\`，后期处理 \`three/addons/postprocessing/EffectComposer.js\` 等都行（只打包你引用到的文件）。
- 镜头：默认是 45° 俯视的正交镜头。第三人称跟随直接用现成的：\`const rig = world.followCamera({ target: player, distance: 7, height: 1.4, mouse: true })\`（\`mouse: true\` 点画面锁定鼠标、移动鼠标转视角，Esc 退出），\`rig.yaw\` / \`rig.pitch\` / \`rig.distance\` 随时可改，dshGame 上写 \`look: (dx, dy) => rig.look(dx, dy)\`，测试里用 \`drag\` 模拟；角色朝镜头前方走时用 \`rig.yaw\` 换算方向。要别的镜头就自己建 \`new THREE.PerspectiveCamera(…)\`，\`world.setCamera(cam)\`，然后每帧（onUpdate 里）自己摆位置、朝向；「指一下」、高亮圈都跟着这台镜头走，\`world.setCamera(null)\` 换回默认。鼠标转视角可以在点击里 \`canvas.requestPointerLock()\`（Esc 退出），并在 dshGame 上提供 \`look(dx, dy)\`，测试里用 \`drag(dx, dy)\` 模拟拖动。
- 光与投影：\`world.lights.hemi\`（天光）、\`world.lights.sun\`（太阳）可以直接调；style3d 里写 \`"shadows": true\` 开太阳投影（之后 world.add / scatter 进来的东西都投影、受影）；\`"rim": 0.6\`（0–2）加轮廓光，角色边缘亮一圈、从地面上「浮」出来，\`"rimColor"\` 换颜色。
- 后期处理（泛光、调色）：\`world.onRender(({ renderer, scene, camera }) => composer.render())\` 接管绘制，返回的函数交还。泛光（狐火、灯笼）这样接：\`import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'\`、\`RenderPass\`、\`UnrealBloomPass\`、\`OutputPass\`（同目录），建 composer 依次 addPass(new RenderPass(world.scene, world.camera))、addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 强度 0.6, 半径 0.4, 阈值 0.85))、addPass(new OutputPass())，然后 onRender 里 \`composer.render()\`；发光的东西用 \`toon(颜色, { own: true, emissive: 颜色 })\`。换镜头后记得把 RenderPass 的 camera 一起换。
- 材质：toon / flat 按颜色共用一份。要让某一个东西单独发光、变色、淡出：\`toon('#ff8a3d', { own: true, emissive: '#ff8a3d' })\` 拿一份自己的。
- 加载资源时（glb、大贴图）先挂 \`window.dshGame = { ready: false, loading: true, … }\`，加载完再设 \`ready = true\`：检查会等最多 20 秒（不写 loading 只等 4 秒）。
- 检查里（\`window.__GAMEDEV_TEST__\`）\`step\` 推进逻辑和镜头但不画画面，测试可以放心多跑帧；要读像素时先 \`world.render()\`。
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
