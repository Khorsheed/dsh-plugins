# Agent Note: typert-faced tarballs carry zod as a real dependency — a generated face's bare `import 'zod'` must never drink a profile-hoisted zod@3

Status: implemented

## Problem

每个生成的 typert face(`lib/typert.host.js`、`lib/typert.remote-client.js`)都以裸 `import { z } from 'zod'` 开头,每个 strict codec 的 zod schema 都由该说明符**在运行时的安装树里**解析到的副本来构建。pack-dist 会剥掉 `dependencies`,所以在本修复之前没有任何 tarball 钉住这次解析:它落到 profile 的 hoisted linker 放在根 `node_modules/zod` 的任意版本上。

全量 0.1.5 实证(42 包同 profile)揭示了它的实际后果。`@khorsheed/dsh-capture` 正当携带 `puppeteer-core` 运行时依赖(`dsh.runtimeDependencies`,动态导入消费);puppeteer-core → chromium-bidi → `zod@3.25.76`,hoisted linker 恰好把这个 v3 放到 profile 根。于是全部 15 个带 typert face 的包都把 `zod` 解析到 v3,生成的 schema 全部失品牌(v3 classic 带 `spa`/`_def`/`parse`,无 `_zod`),0.1.5 typert-loader 的 `_zod` 品牌校验拒绝了首批扫描到的 13 个贡献者——boot 死亡,整棵插件树陪葬。rc.1 loader 不做品牌校验,所以同一组成在那条线上**静默运行 v3 codec**:在役 3080 profile 实测根 `zod` 今天就是 3.25.76——本修复一并关闭的潜在生产 bug。更小的 profile(三包实证 profile)侥幸逃过,只是因为根上没有 v3 时 face 会经 loader 的 install-anchor 回落爬到宿主自己的 zod@4。

## Decision

`scripts/pack-dist.ts` 的 `rescopePackageJson` 在 family 边与 `dsh.runtimeDependencies` 之外增加第三条保留规则:manifest 的 `exports` 含 `./typert` 或 `./remote` 时,`zod` 并入保留集合、原样进入 dist manifest。声明了 face 却**没有** zod 依赖的包在打包时大声报错——报错文案写明根因链——因为静默剥除就是在制造这个故障。

机制就是普通的包管理器解析,不引入新概念:每个带 face 的 tarball 以 `zod: ^4.4.3` 为真实依赖后,pnpm 要么把 v4 抬到 profile 根(实证中发生的:根 `zod@4.6.5`,chromium-bidi 的 v3 嵌在 `chromium-bidi/node_modules/zod`),要么在根被占时把 v4 嵌进各包内部。两种布局都让每个 face 的裸导入确定性地命中 v4,两条宿主线、npm 用户与 file: tarball profile 通吃——无需任何 profile 侧手工 override,chromium-bidi 也保有其自身 manifest 声明的 v3。

## Verification

`pnpm test:scripts` 绿(226;新增三枚 `rescopePackageJson` 钉例:带 face 的 manifest 保留 zod、无 face 的丢弃、带 face 却无 zod 依赖时报错)。42 个非 presets 包全部重打成功;room tarball 的 `dependencies` 恰为 `{ zod: ^4.4.3 }`,无 face 的 ankh-guard tarball 依旧为空。在重建的 42 包实证 profile 里——**含 capture,这正是考点**——逐包解析核查 15/15 个 typert face 命中 `zod@4.6.5`,chromium-bidi 命中自己的嵌套 3.25.76;四个抽查 face 的 node 导入断言 `_zod: true`、`create() === schema`。3096 端口的 0.1.5 boot 干净:`plugin tree failed to load` / `failed to import loader entry` / `Cannot find package` / `not backed by a zod v4 schema` 四类零命中,实例 listening,`curl /` 应答 401,65 秒观察窗无任何错误。3080 按定案不动;消除那里的静默 v3 codec 交由下一波由人拍板的部署。

## Alternatives considered

**用各 profile 的 pnpm overrides 钉 `zod: ^4`。** 被否:它要求每个消费方 profile 手工携带修复——npm 安装的用户一无所获,哪次忘了写 override 就静默重现毒化 profile,产物依旧不能自给自足。依赖应当属于那个带着导入的产物本身。

**用 override 把 capture 的依赖链抬离 zod@3**(强制 chromium-bidi 用 v4)。被否:改写第三方包声明的版本区间,把 puppeteer 的运行时兼容性收养为自己的风险——而且只治了一个已知的 v3 来源,未来任何捎来 zod@3 的依赖都会重现同一毒化。

**rc.1 线不做品牌校验,索性不管。** 被否:品牌校验只是 0.1.5 线替两条线共有的问题发声——3080 实测此时就在用 v3 schema 跑 strict codec,这是稳定部署上一条无人观测的正确性敞口。

## Consequences

所得:当前与未来每一个带 typert face 的 tarball 都把自己的 face 的 zod 自钉到 v4,两条宿主线与 npm 用户通吃;capture 正当的 puppeteer 链与另外 14 个 typert face 共存于同一 profile;下一部署波无需改代码即可消除 3080 的静默 v3 codec。规则锚在 `exports` 形状上,所以任何长出 `./typert`/`./remote` face 却不声明 zod 的包都会在打包时带着根因文案失败——绊线是结构性的,不靠文档。

所费:15 个 dist manifest 各多一行依赖;保留规则成为「pack-dist 剥除 `dependencies`」的第三个例外——前两个是 family 边与 `dsh.runtimeDependencies`,每个例外的存在都因为有一类裸导入对着安装树解析,第四个例外若来,必须带同样的证明。

## Related

- [typert strict codecs emit both an eager `schema` and a lazy `create()`](../../implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md) —— 第二层 0.1.5 修复;其被品牌校验的 `schema` 键正是这次 v3 毒化击垮的环节。
- [preset-registry consumers dual-name-probe the module at runtime](../../implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md) —— 第一层 0.1.5 修复;三者共享同一根不变量:pack-dist 发布的产物对着宿主的安装树解析它的导入。
