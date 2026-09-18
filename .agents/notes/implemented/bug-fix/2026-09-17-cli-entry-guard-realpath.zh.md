# Agent Note: the entry guard resolves argv[1] to its real path (T33d)

Status: implemented

[English](2026-09-17-cli-entry-guard-realpath.md) | 中文

## Problem

四个 bin——`dsh-eval`、`dsh-mission`、`dsh-datasets`、`dsh-lab`——用同一句话问同一个问题：*这个模块是被执行的，还是被 import 的？*

```js
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) { /* 执行主体 */ }
```

Node 在给 ESM 主模块 `import.meta.url` 之前会把它解析成**真实**路径；`process.argv[1]` 保留调用时写的那个路径。两者不一致时比较为假，主体不执行——而主体就是整个 CLI，于是进程退出码 0、什么也没写。没有报错，没有告警，也没有任何退出码能把「CLI 跑完了且成功」和「CLI 根本没来过」区分开。

路径里任何一段是软链都会让两者不一致，而包管理器恰好放了一段进去：pnpm 的 `.bin/<name>` shim 把入口拼成 `.bin/../@khorsheed/dsh-eval/lib/cli.js`，其中 `@khorsheed/dsh-eval` 是指向工作区包的软链。于是这四个 bin 从 `PATH` 上调一律是死的。T33a 在 3171 上实测过：`dsh-eval` 与 `dsh-mission` 都静默空跑，当时的绕法是手写 `node …/lib/cli.js`。

代价不止是不便。lab 的释放闸把 `dsh-mission is-releasable` 的退出码读成 `0` = 可释放、`1` = 不可、其它一律 fail closed。这个合约本身是对的，而静默空跑恰好击穿它：`0` 是闸唯一当作放行的答案，于是一个根本没执行的 bin，读出来是一次没人检查过的任务的绿灯。

这是第二个机制杀死同一行代码。第一个是 tsdown 把共享模块挪进 chunk，守卫被搁在那里、`import.meta.url` 成了 chunk 的——此后由 `packages/mission/tests/bin.spec.ts` 钉住。守卫问的*问题*是对的；两个 bug 都出在怎么回答它。

## Decision

**按 Node 解析模块的同一种方式解析 `argv[1]`，再比较。** 转 URL 之前加一次 `realpathSync`，四处入口同一改法，各留一句注释说明缘由：

```js
let entryPath = process.argv[1]
if (entryPath !== undefined) {
  try { entryPath = realpathSync(entryPath) } catch { /* 解析不了——按原字符串比 */ }
}
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) { /* 执行主体 */ }
```

`import.meta.url` 一侧不动：它本来就是解析后的文件，这正是两者走散的全部原因。

**解析不了的路径保留原样。** `realpathSync` 对不存在的路径会抛；回退到传进来的那个字符串，复现的正是这段代码此前做的比较——于是这个修复的失败模式就是它所替换的行为，而不是一个拒绝启动的 CLI。

**lab 的闸语义不动。** `0` / `1` / fail closed 从来不是缺陷——缺陷是它问的那个 bin 从不作答。`packages/lab/src/cli-core.ts` 一行未动。

## 守卫为什么留着

最直觉的修法是把问题删掉：没人 import 的 bin 入口，直接跑就是了。这对 `eval`、`mission`、`lab` 成立，它们的 `src/cli.ts` 是没有模块 import 的薄入口。对 `datasets` 不成立——它的 `src/cli.ts` **就是**实现，`parse` 与 `runCli` 住在那里，三个测试文件 import 它们。无条件执行会让 import 就跑起 CLI，那三个测试当场就断。

四个一模一样的守卫，比三处删除加一处例外值钱：下一个读到这几个文件中任意一个的人，看到的是同一个形状，和解释它的那句注释。

## Alternatives considered

**把 `fileURLToPath(import.meta.url)` 与 `argv[1]` 当字符串比。** 少一次转换，什么也没修好：两个路径仍然差着那段没解析的软链，而那才是真正的缺陷。比 URL 还把编码规则（空格、非 ASCII）收在一处，换成字符串形式就得重新交代一遍。

**用 `import.meta.main`。** Node 暴露的正是这个布尔值，回答这个问题完全不需要碰路径。它是管用的：在本机（v22.21.1）实测，`node cli.js`、`tsx cli.ts`、以及经软链的包目录——也就是本文通篇在说的那个场景——三种都是 `true`。两件事把它挡在外面。它是 22.18.0 与 24.2.0 加入的，而本仓的 `engines` 是 `^22.19 || >=24`，其中 `>=24` 容得下 24.0 与 24.1——在那两个版本上这个属性是 `undefined`，守卫会再一次静默地永不触发，正是眼下要修的那种失败。它也仍处于 Stability 1.0 早期开发阶段。`realpathSync` 在本仓允许的每一个版本上行为一致。等哪天 engines 的下界排除掉 24.0/24.1，这里是值得回来简化的地方：守卫会塌缩成 `if (import.meta.main)`。

**改 shim——让 bin 在 exec 前自己解析。** shim 是 pnpm 在 install 时生成的。改生成物不是一个能活过下次 install 的修复，而且这个 bug 触及任何软链路径，不只是 pnpm 造的那一条。

**在模块加载时 realpath 一次并缓存。** 守卫每个进程只跑一次，在启动的时候。没有东西可缓存。

## Consequences

**每个 bin 又能从 `PATH` 上够到了，且在那里的行为与 `node lib/cli.js` 完全一致。** 经 pnpm 的 `.bin` 调 `dsh-eval --help` 会打印用法；这次改动之前它什么也不打印、退出 0。

**lab 的释放闸现在量的是它以为自己在量的东西。** `dsh-mission is-releasable` 给出的 `0` 意味着一个任务被检查过并且通过了。在此之前，它还可能意味着那个 bin 是经软链够到的、从未执行。

**每次进程启动多一次 `realpathSync`。** 一次 stat，发生在任何工作之前——对着模块加载的开销属于噪声以下；用同步版本是有意的：守卫的答案必须在进入主体之前拿到。

**这个修复自身的失败模式就是旧行为。** 解析不了的 `argv[1]` 回退到字面路径，也就是此前那个比较用的东西。它不可能把一次本来能工作的调用变得不能工作。

**源码平面的测试没有覆盖构建产物。** 它们经 tsx spawn `src/cli.ts`，那里的守卫与构建产出的是同一份源码。`mission` 另有 `tests/bin.spec.ts` 跑 `lib/cli.js`；另外三个没有，而 gate 的 pack 步只打包并校验 tarball、不执行任何 bin。于是 eval、datasets、lab 上只出现在构建入口的回归，两边都抓不住——正是 tsdown chunk 那个 bug 掉进去的盲区，这次收窄了，但没有封上。

## Testing

- 四个包各一条：`packages/{eval,mission,datasets,lab}/tests/cli-entry.spec.ts`。
- 每条都经一个**软链的包目录**（`<tmp>/pkg -> packages/<name>`，与 pnpm shim 造出的形状相同）无参数 spawn 入口。无参数是最锋利的探针：主体会在 stderr 上答用法、退出码 **2**，于是这个 bug 的签名——退出 0、空输出——过不去。第二条用例走真实路径 spawn 并断言同样的答案，钉住解析对直连调用没有任何改变。
- 已验证它在没有修复时会红：把守卫改回去，软链那条报 `expected +0 to be 2`、输出为空；直连那条仍绿。
- `pnpm gate`：14 步，284 秒，PASSED。四包测试套件全绿——eval、datasets、lab、mission。
- 本机经 pnpm 的 `.bin` shim：`dsh-eval --help` 与 `dsh-mission --help` 各自打印用法（6429 与 1649 字节）；同样两条命令对着修复前的构建产物则什么也不打印、退出 0。
