# Agent Note: 3D conveniences — follow camera, rim light, swaying scatter

Status: implemented

## Problem

[开门](../architecture/2026-10-25-game-plugin-boundary.zh.md)之后，游戏已经能自己做第三人称镜头、额外的光照和风吹效果。但游戏 agent 的清单里，跟随镜头、轮廓光和随风摆的草，仍然是风格化 3D 游戏最先想要的几样东西。它们属于边界的第二层：多数游戏想要、游戏可以不用、而且永远不能把门关上的便利功能。

## Decision

- **`world.followCamera({ target, distance, height, yaw, pitch, fov, mouse, sensitivity })`** 在 `target` 身后放一台透视镜头，并返回一个镜头架。它的 `yaw`、`pitch`、`distance` 随时可以改；`rig.look(dx, dy)` 接收鼠标位移，俯仰角有上下限。world 在 `sync()` 里摆放镜头架的镜头，所以点选、高亮圈和绘制都用它。`mouse: true` 时，点击会申请指针锁定，锁定后移动鼠标就转视角。之后再用 `setCamera` 换成别的镜头，镜头架就会被丢开。
- **`style3d.rim`（0–2）和 `rimColor`** 给每一种卡通材质（缓存的、独立的、glTF 转换的）加上按视角计算的轮廓光。它用 `onBeforeCompile` 注入，共用一个程序键；风格里没写 rim 时完全不注入。清单解析会保留这两个字段。
- **`scatter(…, { sway: { amplitude, period } })`** 给批量摆放的物件（连同它们的描边外壳）各用一份独立的材质，顶点按高度、跟着 world 的时钟摆动；每一份按实例位置错开相位。影子不跟着摆。
- **泛光仍然是做法，不做成功能。** 技能文档示范了怎样在 `world.onRender` 里通过 `three/addons` 接泛光（EffectComposer、RenderPass、UnrealBloomPass、OutputPass），发光的物体用带自发光的 `own` 材质。有一个测试原样跑了这套做法，这也顺带证明扩展解析能跟着 EffectComposer 的整条引用链走。

## Alternatives considered

**内置一个泛光开关。** 后期处理会改变每一帧的开销，也会改变检查截出来的图；而想要泛光的游戏通常也想自己调参数。绘制接管已经在了，一套经过测试的做法能得到同样的效果，又不让每个游戏都为它付出代价。

**跟随镜头的碰撞**（墙挡在镜头和玩家之间时把镜头拉近）。这取决于游戏自己的几何体和可行走模型。镜头架的 `distance` 是开放的，游戏可以自己缩短。

**让影子的深度材质也跟着摆。** 着色器的工作量翻倍，换来的是风格化影子里很少看得出来的细节。

## Consequences

- 已有的游戏不受影响：每个开关不写就是关的。
- 轮廓光会让所有卡通表面的边缘变亮，所以它是一个风格决定，对 agent 也是这样描述的。
- 随风摆的物件用的是独立材质，换风格不会立刻影响它们，要等重新生成（切换场景或重新加载）。
