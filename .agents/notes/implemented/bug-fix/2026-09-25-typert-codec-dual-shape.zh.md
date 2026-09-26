# Agent Note: typert strict codecs emit both an eager `schema` and a lazy `create()` — dual-shape for the 0.1.5↔rc.1 loader split

Status: implemented

## Problem

typert strict codec 契约在两条宿主线之间换了形状。0.1.5 的 typert-loader 校验并消费立即求值的 zod-v4 实例:`requireStrictCodec`(packages/typert/loader/src/index.ts:263-274 @ 0.1.5)要求 `mode: 'strict'`、`typeSymbol`,且 `codec.schema` 必须带 `_zod` 和 `parse`;`TYPERT.schemas` 清单项同样按此校验(:82-88)。rc.1 把实例换成了惰性工厂：同名函数(:265-284 @ rc.1)要求 `codec.create` 是函数,rc.1 协议类型携带 `create: () => TypertSchema`。两版 loader 都不拒绝对方那一行的键——各自只校验、只读取自己的键。

rc.1 生成器跟随了 rc.1 loader:schema 以记忆化惰性工厂发射(`const X$schema = () => (X$schema$value ??= z…)`,递归经 `z.lazy` 延迟),codec 字面量只带 `create: X$schema`。所以任何对着 rc.1 harness 重新生成的 typert face 都过不了 0.1.5 的清单校验——报 `parameter codec is not backed by a zod v4 schema`——0.1.5 的 boot 死在 typert-loader 的 apply 阶段,整个插件树陪葬。这在已发布的 capability-catalog 0.1.95 tarball 上就已存在(其 face 与全新生成逐字节一致),只是因为 [preset-registry 双名探测](../../implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md)修掉了掩盖它的导入阶段死亡才露头。波及面是每一个带 typert face 的包(15 个包 × host 与 remote-client 两面——0.1.5 浏览器侧 typert 运行时消费的同样是旧形状),不是单个插件。而 0.1.5 没有安装期版本门,这个失败只能发生在运行时、在宿主自己身上。

## Decision

在我们自己的 write 接缝做双形状发射。`scripts/gen-typert.mts` 的 `generate()` 持有写出全部生成产物的回调;写 `.js` 产物前先过 `dualShapeCodecs(content)`,把每个 `create: <标识符>,` 字面量改写成同一行加上同缩进的 `schema: <标识符>(),`。`.d.ts` 产物不动。

为什么这一个窄变换是安全且充分的:

- **0.1.5 读 `schema`**:对工厂做一次立即调用即得 zod 实例。工厂自带的 `$value` 记忆化使这次调用返回的正是之后每次 `create()` 交出的同一个实例(`create() === schema`),且所有递归都经 `z.lazy` 延迟,立即调用不会重入任何构造到一半的工厂。
- **TDZ 安全是验证过的,不是期望**:全部 30 个生成 face 里,每个工厂 const 都声明在引用它的第一个清单字面量之前,且没有工厂体直接调用另一个工厂(变换落笔前已机械核查)。在字面量处插入 `<工厂>()` 不可能碰到暂时性死区。
- **rc.1 读 `create`**:与之前逐字节一致,现宿主线上的东西按构造不变。
- **两边 loader 各自忽略对方的键**,多余键在任一侧零代价。
- **一个字面量形状覆盖所有发射点**:调用参数/结果/Context codec 与 `TYPERT.schemas` 清单项都发成 `create: <标识符>,`(今天每个 face 的 `schemas` 清单都为空;哪天出现清单项,同一个变换自动覆盖)。
- **freshness cache 无需特殊处理**:脚本本身是缓存的哈希输入之一,这次改动自然使 stamp 失效,一次强制全量构建即重生成全部 typert 包——正是要覆盖的范围。

## Verification

强制全量重生成(`GEN_TYPERT_FORCE=1 pnpm run build`)后,15 个 typert 包的全部 30 个 face 都带 `schema`+`create` 成对出现,无未配对的 `create:` 字面量残留。对 capability-catalog 与 room 的 face 做 node 导入断言:每个 codec 满足 `schema._zod !== undefined`、`typeof create === 'function'`、`create() === schema`(记忆化同一实例)。全仓构建绿;三个实证包全量 build+test 绿(ankh-guard 215、capability-catalog 241、room 296);`pnpm test:scripts` 绿(223,含新增的 `dualShapeCodecs` 钉例)。

0.1.5 真 boot:三个重打 tarball(capability-catalog 0.1.95、ankh-guard 0.3.0、room 0.1.0)装入实证 profile,实例在 3095 端口 boot,日志无 `failed to import loader entry`、无 `not backed by a zod v4 schema`、无 `plugin tree failed to load`;日志可见 capability-catalog / ankh-guard / room 三个 fiber,`curl /` 应答 401(无 token;带 token 为 303)。rc.1 侧回归无需重启:rc.1 loader 只校验 `create`,而它逐字节未变——3080 未动。rc.1 loader 其余的 codec 校验就是同一个 `requireStrictCodec` 的三个调用点加 `TYPERT.schemas` 清单项检查,全部只查 `create`,不存在第三个要配对的严格形状。

## Alternatives considered

**给带 typert face 的包把 `minHost` 抬到 0.1.7。** 被否:0.1.5 没有安装期版本门,抬地板挡不住 0.1.5 用户装上 tarball 然后 boot 被杀——与探测层否掉它的理由相同。

**请上游做 loader 容忍(两键皆收)然后等待。** 作为修复被否:上游变更管线只能让未来的宿主发布版带上它,已经发布出去的 0.1.5 宿主永远收不到——产物自己必须会说两种形状。该请求仍可作为退役路径提交。

**钉住最后一批 0.1.5 形状的 face 永不重生成。** 被否:那正是 freshness cache 造成的事实状态,而它在一次正当的全量重生成(即本次兼容波)到来时即告破碎——已发布的 0.1.95 tarball 早已带上 rc.1 专有形状。face 必须跟随当前生成器,所以兼容性只能活在 write 接缝里,不能活在逃避里。

## Consequences

所得:当前与未来每一个重新生成的 typert face 都能在两条宿主线上 boot;0.1.5 验证门(干净 boot 加 HTTP 应答)对三个实证包端到端通过。兼容性只活在一个地方——我们自己工具链的 write 接缝——上游生成器与两版上游 loader 按「跟踪不分叉」原则原样不动。

所费:生成的 `.js` 产物每个 codec 字面量多一行(全仓今天约一千行);变换假设生成器只有 `create: <标识符>,` 这一种发射形状——未来生成器若以第二种形状发射 codec,必须重审 `dualShapeCodecs`(验证环节的「零未配对字面量」检查是绊线)。当被支持的宿主线不再包含 schema 时代的 loader,这个函数及其 spec 可干净删除。

## Related

- [preset-registry consumers dual-name-probe the module at runtime](../../implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md) —— 第一个 0.1.5 boot 阻塞,它的修复让本阻塞露头。
