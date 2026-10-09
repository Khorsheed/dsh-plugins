# Agent Note: library capabilities 动词与 dispose 护栏

Status: implemented

## Problem

把图书馆按实例挂到隔离 Context + 独立 `stateRoot` 上的消费方（README「工作区接入接缝」记载的支持形态）撞上了两个缺口。（1）可写性只有宿主侧可知：store 的 `available`/`unavailableReason` 探测没有线主动词，客户端（或挂载方的 UI）只有在真正写一次之后才知道部署是只读的——reader 早就用 `ReaderService.capabilities` 解决过同一个问题。（2）没有 dispose 护栏：服务只持有一个内存里的监听器集合，一旦实例被动态挂载与卸载，挂载 Context 销毁之后的调用会在死作用域上静默执行——dispose 后使用必须变成带码拒绝，而不是静默操作。

## Decision

全部演进都是新增且通用命名（代码、类型、注释里没有任何消费方词汇）；版本保持 0.1.0；客户端 UI、`./tool` 入口与 ImageRefCache 均未触碰。

- **线主 capabilities 动词**（`src/types.ts`、`src/service.ts`、`src/remote.ts`）：`LibraryCapabilities`——`{ protocolVersion: 1, hasStorage, storageUnavailableReason?, hasAttachments }`，沿用 reader `ReaderCapabilities` 的演进规则（永远只加可选字段，按 protocolVersion 1 写的消费方持续可用；reason 键是缺席而不是 null）。`service.capabilities()` 读取 `store.available`/`store.unavailableReason`，并在调用时刻重跑按调用探测的附件探测（`ctx.get('attachments')`）；`@Remote('capabilities')` 把它暴露为 `remote.library.capabilities()`。它是只读展示契约——强制执行照旧发生在写边界（`storage-unavailable` / `unavailable` 拒收），与之前逐字节一致。
- **dispose 护栏**（`src/service.ts`）：`LibraryDisposedError`（带码 `'disposed'`，经由 `PACKAGE_NAME` 带包名，`PACKAGE_NAME` 现从 `invariant.ts` 导出；错误类从包根导出）。`dispose()` 幂等且终态，丢弃监听器集合，并在构造时经 `ctx.effect` 接到借入 Context 的销毁上（canvas-novel 先例——直接构造的实例也有接线，不只 `apply` 路径）。`assertAlive` 守在每一个公开动词上，读取也不例外，挂载方永远不会一直消费一个死实例。写边界——`mutate` 里紧邻拿锁之前的 `assertAlive`，刻意放在把 store 错误映射成拒收的 try 之外——钉死位置规则：护栏在拿锁之前执行，于是在 dispose 之后到达边界的写带码拒绝，绝不排进重建实例持有的锁；已经越过边界的写可以完成（store 的锁 / 临时写 / 原子改名本就保证盘侧安全）。本服务里从动词入口到边界全是同步校验，所以今天入口护栏与边界护栏落在同一拍；两处都写，是因为契约点名了边界，而未来演进可能让校验变成异步。同根重建照旧合法：死掉的只是旧实例，已释放的锁文件照常把新实例让进来。
- **测试**（`tests/capabilities-dispose.spec.ts`，新增 9 个）：握手套件钉住「可写存储 + 无附件」形状（reason 键缺席）、不可写根（状态根嵌在一个普通文件之下）及其 reason、写边界仍拒 `storage-unavailable`，以及附件探测在调用时刻的判定；dispose 套件钉住每个公开动词带码带包名拒绝（同步动词抛出）、幂等、随 Context 销毁、竞态写带码拒绝且三个 store 锁间谍全程静默、同根重建（第一个实例写入的数据全部可读、新写照常落盘），以及同一根上两个存活实例经由锁文件真正互斥。`service.spec.ts` / `tool.spec.ts` 的两个手写 ctx mock 各加了一个 no-op `effect`（构造函数现在接 `ctx.effect`）——机械的雪台适配，无任何预期变更。

## Alternatives considered

- **用 `'disposed'` 的 `LibraryErrorCode` 拒收值而不是抛错**：读取回答的形状没有错误通道（`listProjects`、`listCards`、`dueCards`、`stats`……），返回式编码在那里不可见，要么迫使每个签名变宽；抛出的带码包名错误是 canvas-novel/sidechat 先例，对读写一视同仁。
- **只在 dispose 后守护写**：卸载后仍回答陈旧状态的读取会让挂载方无限期消费死实例；交付条件是每个公开动词都拒绝，读取在内。
- **在 `apply` 里接线（sidechat 形态）而不是构造函数**：文档记载的消费形态包括在挂载方自己的 Context 上直接 `new LibraryService(ctx, config)`；构造函数接线（canvas-novel 形态）两条路都覆盖，而真实 cordis Context 必有 `effect`。
- **在锁内临界区里（拿锁之后）复查存活**：否——交付的位置规则是护栏在拿锁之前执行，而附言覆盖了其余情形：dispose 落地时已在等一把竞争锁的写，盘侧由构造保证安全（锁 / 临时写 / 原子改名），再拒绝它一无所获。
- **把 `hasAttachments` 拆成可读 / 可写两个**：服务其余部分用的按调用探测就是 `ctx.get('attachments')` 本身（只有 `savePhoto` 额外需要可选的 `saveImage`）；握手如实镜像这个探测，更细的拆分日后仍可按演进规则以可选字段到来。

## Consequences

- `LibraryCapabilities`、`LibraryService.capabilities`、`LibraryService.dispose`、`LibraryDisposedError` 与线主动词 `remote.library.capabilities` 是新的公开面；`PACKAGE_NAME` 从 `invariant.ts` 导出。68 个既有测试全部原样通过（共 77，新增 9）；对既有测试文件仅有的改动是两处 no-op `effect` mock。
- 客户端可以预先知道可写性（带原因）与附件可用性，而不是靠写一次来试；强制语义不变。
- 挂载方拥有实例生命周期：dispose 跟随借入 Context（或显式 `dispose()`），dispose 后动词带码拒绝，竞态写在拿锁前拒绝，同根重建是新实例的本职。
- 原生 UI 尚未消费该动词（按设计先落展示契约）；待其消费时，可加形状与 protocolVersion 规则已被测试钉住。
