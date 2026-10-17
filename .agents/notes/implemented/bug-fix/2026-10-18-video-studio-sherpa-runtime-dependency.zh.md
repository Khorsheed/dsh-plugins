# Agent Note: video-studio —— sherpa-onnx-node 必须声明为运行时依赖

Status: implemented

## Problem

生产 3080 上每次转写任务都以 `Cannot find module 'sherpa-onnx-node'` 失败。包在 dependencies 里声明了它、开发检出里也正常，但 pack-dist 会从发布清单里剥掉 `dependencies`（运行时依赖预期打进 `lib/` 或由宿主提供），装出来的 tarball 只剩 `zod`。而 sherpa-onnx-node 打不了包：它是按平台预编译的原生 addon，由 fork 出来的语音 worker 在运行时从安装树里 `require`。

## Decision

在 `package.json` 的 `dsh.runtimeDependencies` 里声明（`["sherpa-onnx-node"]`)——pack-dist 现成的逃生口（capture 包的 `@puppeteer/browsers` / `puppeteer-core` 先例）：列名的条目原样保留进发布清单，profile 会把 addon 随包安装，worker 的 require 经包自己的 `node_modules` 解析到。

## Alternatives considered

- **把 sherpa-onnx-node 打进 lib/**：否决——它的 JS 包装按自身路径定位平台 `.node` 二进制，打包会破坏该定位，还按平台放大 tarball 体积。
- **从开发检出的路径解析该模块**：否决——生产绝不能看到开发路径，profile 才是安装单元。

## Consequences

- 修复要等下一次 `pnpm deploy:3080 --package packages/video-studio` 才到生产；此前的安装里转写会持续以同一错误失败。
- 本包未来新增的原生/不可打包运行时依赖都进这个列表——列了不在 `dependencies` 里的名字会在打包时立刻报错。

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build` + 包测试绿（29/29)。pack-dist 的保留名单逻辑由脚本测试覆盖；故障本身是环境级的（缺失安装），已通过检查生产 profile 里实际部署的清单确认。
