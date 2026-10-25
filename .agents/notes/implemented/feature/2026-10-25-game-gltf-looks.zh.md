# Agent Note: glTF model looks (static)

Status: implemented

## Problem

游戏 agent 的下一个切片是一个用 Blender 做的角色（用户正在学），然后是村子的一角。`{ kind: 'gltf', src }` 外观能通过校验，但 dsh3d 只画一个占位方块。[边界说明](../architecture/2026-10-25-game-plugin-boundary.zh.md)已经开放了 `three/addons/` 的引入，游戏可以在代码里自己加载 glb。但外观是面板要预览和编辑的东西，而只有插件能让面板看懂它。游戏 agent 要求先做这件，排在可行走和动画之前。

## Decision

- **运行时。** `build()` 仍是同步的。gltf 外观会立刻返回模型的外框，等 glb 到了再填进去；`model.userData.loaded` 和导出的 `loaded()` 在加载完成时兑现。默认（`material: 'toon'`）下，每个材质都换成当前风格的卡通材质，并保留模型自己的颜色、顶点色、贴图、自发光、透明度和 alpha 测试；所有非蒙皮网格都带描边外壳。`material: 'original'` 保留 glb 自带的材质，`outline` 可以单独开关描边。加载失败会写到 `console.error`（检查会报出来），然后退回外观里的 `recipe`，没有配方就显示占位方块。模型加载完后，`world.add` 会再处理一次投影；`scatter` 遇到 glb 外观，会等它加载完再批量摆放。
- **沙箱里的加载。** three 的加载器会用相对路径创建 `Request`，而在沙箱里（`about:srcdoc`，或检查用的 `data:` 页面）这样的相对路径没有可用的基准地址。所以加载器开放了 `window.__dshFileUrl(path)`（返回项目文件的 blob 地址），dsh3d 的 GLTFLoader 通过 `LoadingManager` 的地址改写，把模型、`.bin` 和贴图的路径都映射过去。GLTFLoader（连同 BufferGeometryUtils）会进每一个 3D 版本，因为面板预览可能要加载线上版本还没有的模型。
- **检查。** `ready` 之后，检查会先等 `window.__dshPending()`（dsh3d 正在进行的加载，最长等到 20 秒的加载上限），再跑冒烟、每个测试文件和截图。gltf 外观的 `src` 不在构建文件里时，检查失败，并写明是哪个元素、哪个文件。`glb` 和 `gltf` 有了对应的 MIME 类型。
- **面板。** 各处预览（转盘、卡片静态图、方案静态图）通过新的 `workingFile` Remote 取外观文件的工作区版本（只限项目内的构建文件，最大 8MB），所以刚导出的模型不用等任何版本带上它，就能先显示出来。预览入口在模型加载完后重新取景，等加载完才拍静态图。换 `src` 会重新加载画面。元素页显示模型文件、卡通着色/原材质切换和大小输入框。
- **技能文档。** 写明了外观的格式、导出建议（Y 轴朝上、单位米、原点在脚底、贴图打包进 glb、最多 1 万面）、CC0 素材的规矩（`assets/LICENSES.md`），以及动画还没接上。

## Alternatives considered

**异步的 `build()`（返回 promise）。** 现有的所有调用处、`scatter` 和实时重建都假设立刻拿到模型。先返回一个之后再填充的外框，这些都能照常工作；需要等待的场合用 `loaded` 解决。

**用普通的相对路径 `fetch` 或 `GLTFLoader.load(path)` 加载。** 在检查的 data URL 页面里会失败，在 srcdoc 画面里也不可靠。沙箱的文件表才是它本来就信任的来源。

**只从线上版本的打包里预览。** 那样用户必须先发版才能看到刚导出的模型，预览就失去了意义。

**现在就给蒙皮网格加描边。** 描边外壳的着色器不会跟着骨骼动。这要和动画一起做（下一步），连同蒙皮网格的点选。

## Consequences

- 游戏开头几帧，模型会一个个冒出来。在意这一点的游戏，可以先设 `dshGame.loading`，等 `loaded()` 完成后再设 `ready`。
- 卡通模式会替换材质，丢掉 PBR 细节（粗糙度、金属度、法线贴图），换成统一的风格。`original` 会保留这些细节。
- 卡片静态图按线上版本和外观缓存。用同一个文件名重新导出 glb 后，转盘会刷新，卡片要等下一个版本才刷新。
- 每个 3D 版本都会带上 GLTFLoader 和 BufferGeometryUtils（未压缩约 150KB）。
