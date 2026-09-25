# Agent Note: preset-registry consumers dual-name-probe the module at runtime — pack-dist strips dependencies, and 0.1.5 has no install gate

Status: implemented

## Problem

0.1.7-rc.1 宿主把官方包 `@deepseek-ai/dsh-agent-presets` 改名为 `@deepseek-ai/dsh-agent-preset-registry`——API(`resolve` / `mount` / `livePresetMounts` / `agentPresetProjectionDefinition`)原样沿用。0.1.5/0.1.6 宿主只装旧名;0.1.7 宿主只装新名。

rc.1 适配波把三个消费方对该包的值导入改写成了新名的顶层静态导入。这在 0.1.5 上是致命的,原因与本仓的发货方式直接相关:pack-dist 会把发布清单里的 `dependencies` 删掉(`@deepseek-ai/*` 全部外部化,运行时靠宿主的安装树解析),所以一个 `@deepseek-ai/*` 说明符的值导入就是「宿主安装树里必须存在同名包」的硬要求。在 0.1.5 宿主上,loader 入口的导入直接死于 `Cannot find package '@deepseek-ai/dsh-agent-preset-registry'`,整个插件树加载失败,实例 boot 即挂。而 0.1.5 没有任何安装期版本门:tarball 装得上,boot 才是第一个能拒绝的时刻——所以在那条宿主线上,运行期探测是唯一存在的防线。

post-0.1.5 审计发现,处于值导入位置的改名包名只有这一个,共四个点:`packages/ankh-guard/src/index.ts`(preset 派生命名空间)、`packages/capability-catalog/src/scoped-delivery.ts`(`livePresetMounts`)、`packages/capability-catalog/src/client/preset-display.ts`(`/display` 子路径——安全:tsdown 会把它内联进浏览器 bundle,运行期不存在导入)、`packages/room/src/agent-setup.ts`(派生命名空间)。已对 0.1.5 检出核实:旧名包同时导出 `livePresetMounts` 和 `agentPresetProjectionDefinition`,所以在 0.1.5 上探测落到旧名得到的是全功能,不是降级。

## Decision

三个包各自在使用该包的模块内持有一个极小的双名探测加载器(不新建跨包依赖),Promise 缓存放模块级,并导出供测试复位的接缝:

```ts
let presetRegistryProbe: Promise<unknown> | undefined

export function loadPresetRegistry(): Promise<unknown> {
  presetRegistryProbe ??= import('@deepseek-ai/dsh-agent-preset-registry')
    .catch((): unknown => import('@deepseek-ai/dsh-agent-presets'))
    .catch((): null => null)
  return presetRegistryProbe
}
```

三条规则保证探测安全:

- 两个说明符必须保持静态字符串字面量:tsdown 才能外部化(旧名是 optional peer),tsc 才能做类型检查(旧名是 devDependency,`^0.1.0-rc.6`——npm 上已发布的旧名线)。这个解析上下文有一个消费者不是包级 tsc,而是 gen-typert 的宿主 overlay——overlay 里没有旧名包的副本:`scripts/gen-typert.mts` 现在在 overlay 的 tsconfig paths 里把旧名别名到新名的 source-plane 映射——按上游契约两面相同,且每个消费方本来就是结构强转。
- 禁止 `createRequire`:宿主 vendored loader 走 install-anchor 回落解析,`createRequire` 会绕开它,探测本身会在恰恰必须继续工作的生产拓扑(3080)上解析失败。
- 新名在前:0.1.7+ 上解析结果与修复前的静态导入逐字节一致;0.1.5/0.1.6 上旧名给出全功能;两者皆无(无 preset 组合的宿主)时探测落定 `null`,消费方走既定的无-preset 降级——与无 preset 会话一贯的结局相同。

各包接入:

- **ankh-guard**(`src/index.ts`):删掉静态命名空间导入;`buildResumeOptions`(本就在异步上下文)`await loadPresetRegistry()` 后把 `(host ?? {}) as PresetDerivationSurface` 传给 `deriveSessionPreset`,后者「传入 `{}` 返回 undefined、回落部署默认预设」的契约不变。
- **capability-catalog**(`src/scoped-delivery.ts`):`ScopedSkillDelivery.start()`(异步)在首次 reconcile 前把探测到的模块的 `livePresetMounts` 预载进私有字段;`liveKeys()` 在字段为 undefined 时返回空集(文件事件可能在 `start()` 完成前触发,在两者皆无的宿主上则永远 undefined)——语义与调用处原已存在的 catch 分支完全一致:不知道任何 live mount,所需 preset 的注册仍保留,只丢陈旧代。
- **room**(`src/agent-setup.ts`):导出的 `agentPresetsDerivationHost` 命名空间常量替换为模块级 `probedHost = {}`、`presetDerivationHost()` 取值器和 `preloadPresetDerivationHost()`;`RoomService` 构造函数(即插件的 apply)把预载作为第一个 `ctx.effect` 执行,两个派生调用点(`roomSessionPreset`、`src/index.ts` 的冷 room 读取)改用取值器。所有派生都发生在 apply 之后的 resume/create 路径,探测必然先落定。

package.json 三包同则:旧名加入 `devDependencies`(`^0.1.0-rc.6`,编译期解析)和 `peerDependencies` 并标 `optional: true`——「可缺装」的既定拼写;宿主兼容门只对已安装包做 semver 检查,0.1.5/0.1.6/0.1.7 全过。ankh-guard 和 room 的新名 peer 一并标 optional(它们的用法本就是探测式);capability-catalog 的新名保持留在 `dependencies`(编译期解析——pack-dist 会删,运行时走 loader 解析)。

## Verification

三个包的构建与全量测试全绿(ankh-guard 车道清单共 215 例,capability-catalog 241 例,room 296 例)。新增的各包探测 spec 把两个名字都 mock 成拒绝:加载器落定 `null` 而不抛(且结果入缓存),ankh-guard 与 room 的派生收到 `{}` 并返回 `undefined`——回落部署默认预设的行为本就被各自既有 derive spec 钉住——catalog 的 `start()` 正常完成、`liveKeys()` 返回空集,且向指定 preset 层的投递不受影响。

0.1.5 真机证据(实证 profile 装入三个 tarball——capability-catalog 0.1.95、ankh-guard 0.3.0、room 0.1.0,均从修复后的 `lib/` 打包):三个 `lib/index.js` 现在都能在 0.1.5 安装树上干净导入,而此前 boot 正死于 `Cannot find package '@deepseek-ai/dsh-agent-preset-registry'`;探测链解析到旧名模块,其 `agentPresetProjectionDefinition` 对「header + 选择事件」的日志折叠正确(`from-header` → `switched`)——0.1.5 上是全功能,不是降级。3095 端口的真 boot 现已通过模块导入阶段:`Cannot find package` 为零、`failed to import loader entry` 为零。

boot 随后在一个阶段之后死于第二个、独立的 0.1.5 不兼容——本修复当时明确不触碰:0.1.5 的 typert-loader 校验每个调用编解码器必须是立即求值的 zod-v4 `schema`,而当前(rc.1)typert 生成器发出的是惰性 `create()` 工厂——0.1.7 的 loader 接受 `create`,0.1.5 的拒绝(报 `parameter codec is not backed by a zod v4 schema`)。已发布的 capability-catalog 0.1.95 tarball 的 face 与重新生成的逐字节一致,所以这第二个阻塞先于本探测修复存在,只是被导入阶段的死亡掩盖。它现已由 gen-typert write 接缝的双形状 codec 发射修复——见 [typert strict codecs emit both an eager `schema` and a lazy `create()`](../../implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md)——两层都落地后,同三个 tarball 在 0.1.5 实证 profile 上干净 boot。

0.1.7 路径无需额外复验:探测顺序新名在前,3080(rc.1)的解析结果与修复前完全一致,未动。

## Alternatives considered

**把三个包的 `minHost` 整体抬到 0.1.7。** 被否:npm 稳定宿主线仍是 0.1.5;更决定性的是 0.1.5 没有安装期版本门,抬了地板也挡不住 0.1.5 用户装上 tarball 然后 boot 被杀。在无门的宿主上,唯一防线是运行期探测。

**用 `createRequire` 做同步探测。** 被否:它绕开 vendored loader 的 install-anchor 回落解析,探测本身会在必须继续工作的生产拓扑(3080)上解析失败;且只有静态字面量的动态导入形式才是 tsdown 能外部化、tsc 能类型检查的形式。

## Consequences

所得:三个包在 0.1.5 上 boot 且 preset 全功能(旧名应答),在 0.1.7+ 上保持与修复前逐字节一致的解析(新名先探),在无 preset 组合的宿主上降级而非死亡。不变量自此对全仓显式成立:pack-dist 发布的包对 `@deepseek-ai/*` 的值导入 = 对宿主安装树中该确切名字的硬依赖,所以任何上游改名——或插件想用的任何新增官方包——都必须走双名运行期探测,绝不写顶层静态导入。

所费:每个进程的首次 preset 派生 / mount 列表读取要为每个包付一次带缓存的异步探测;三个模块各多一个探测加测试接缝,未来单名世界可以删掉;gen-typert 的 overlay paths 多一条改名别名,等旧名从插件源码里彻底消失时退役。

## Related

- [capability-catalog resolves rc.1 preset scopes through the leased roster face](../../implemented/bug-fix/2026-09-24-capability-catalog-rc1-leased-scope.md) —— 同一波 rc.1 适配,roster 面一侧。
