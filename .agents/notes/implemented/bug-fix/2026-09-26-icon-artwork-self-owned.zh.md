# Agent Note: client bundles inline the rc.1 icon artwork from package-owned generated modules (the icon name lines share zero exports)

Status: implemented

## Problem

两条受支持宿主线从 `@deepseek-ai/dsh-client-ui-primitives` 导出的图标集互不相交:0.1.5 的名字带像素后缀(`IconCheckOutline16`、`IconChevronDownOutline14`,共 75 个),rc.1 的名字带字重后缀(`IconCheckOutlineMedium`;93 图样 × Regular/Medium = 186 个)——没有任何名字在两线同时存在。社区客户端 bundle 把 ui-primitives 当平台模块外部化,所以 rc.1 适配波引入的每个 `Icon*Medium` 引用在 0.1.5 宿主上都解析为 `undefined`:React 抛 #130(元素类型 undefined),整个槽位渲染失败——0.1.5 实证实例上 `conversation.session.header.actions` 与 `conversation.chat.node` 均因此不渲染。二十个包从包根导入了四十个图标名。

## Decision

二十个包各自持有一个生成并提交进仓的 `src/client/icons.tsx`,导出与原先导入同名的组件(`IconCheckOutlineMedium` 等),由 `scripts/sync-icon-artwork.mts` 从 harness 检出的 `packages/client/ui-primitives/src/icons/{index.tsx,shared-artwork.tsx}` 生成。生成器解析上游模块的均匀结构(字重包装 → artwork 常量 → 共享 `IconProps`、stroke 常量 `ICON_REGULAR_STROKE`/`ICON_MEDIUM_STROKE`、共享路径常量),把每个用到的图标摊平成自包含 SVG 组件(stroke 宽度内联为字面量,artwork 的 size 默认值保留,复合 artwork 与 shield 路径常量一并折叠),确定性排序输出,并拒绝覆盖不带生成标记的文件——canvas 与 message-tools 既有手写图标文件为此迁名 `icons-local.tsx`。调用点只换说明符(`./icons.tsx` 相对路径,绝不写包根);非图标组件(Button、Modal、FileTypeIcon 等)保持包根外部化导入——它们带宿主主题/上下文身份,且已核实全部存在于 0.1.5 根导出。纯度门无需改动:相对导入不碰它的 `@deepseek-ai/*` 规则。

图标是纯 artwork、零宿主运行时态,所以每个 bundle 各带一份在任何宿主线上行为一致——dsh-client-store 内联先例。体积:各 bundle 增量在 +0.4 KB 到 +18.5 KB 之间(tree-shake 后只带用到的图样)。

## Alternatives considered

**运行期按宿主挑选图标名**(两个后缀名都导入,探测宿主后选择)。设计期即被否:每个 bundle 要背 ~40 名 × 2 线的查表,探测启发式在下一条宿主机线上可能猜错,而 React 元素类型失败模式在名字漂移那天重新变成静默——内联产物在运行期无物可解析,因而不可能错。

**经 `./src/*` 出口导入官方 `src/icons/index.tsx`。** 证据否决:npm 产物不含 `src/`(该出口的目标文件在安装树里不存在),所以该说明符只在 vitest 源码面可解,在 tsc 与 tsdown 的构建面双双失败。已从包目录做直接解析测试证实。

**tsdown 用 env 别名指到 harness 检出,tsc 用每包 ambient 声明。** 被否:两条绝不能不一致的平行解析通道,加上要手抄四十个符号签名、对上游静默漂移的 ambient 声明——严格劣于直接自持图样,后者至少漂移是可见的。

## Consequences

所得:二十个客户端 bundle 的图标对宿主线免疫——图样自包含,安装树上无物可解析——0.1.5 boot 的 React #130 槽位崩溃消失(已在 0.1.5 实证 profile 浏览器实证)。生成器保证副本诚实:新增图标导入或升级 harness 检出后重跑一次;`--check` 遇漂移即失败。`FileTypeIcon`/`CodeFileIcon` 与我们用到的其余全部非图标根符号均已核实存在于 0.1.5 根导出,同一断裂今天没有第二战场。

所费:四十个图标组件在每个消费 bundle 里各复制一份(tree-shake 后每包 ≤18.5 KB),副本只在有人重跑生成器时跟上上游;上游若给出正式的 `./icons` 发布出口,整套机制退役——提案已提交至 [docs/upstream-proposals/2026-09-26-ui-primitives-icons-export.md](../../../docs/upstream-proposals/2026-09-26-ui-primitives-icons-export.md)。

## Testing

`scripts/sync-icon-artwork.spec.ts` 用合成 fixture 钉住解析器与渲染器(九例:本地/共享/fill/复合 artwork 摊平、stroke 常量代入、共享路径常量按需发射、缺名报错、逐字节幂等输出)外加 `collectIconUsage` 的 fixture 例;真跑的 `--check` 模式挡住漂移。二十个包的全量 build+test 与仓级脚本测试套件保持全绿。

## Related

- [typert-faced tarballs carry zod as a real dependency](../../implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md) —— 「裸导入必须被产物自己钉住」的同课姊妹篇;本篇是同一教训在浏览器面上的形态。
