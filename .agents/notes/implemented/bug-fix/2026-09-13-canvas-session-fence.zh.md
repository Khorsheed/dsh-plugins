# Agent Note: the pad's writes carry the calling session's fence

Status: implemented

## Problem

在灵感画布点「新建」得到的是「这个位置不可写」。`CanvasService` 的三条写路径只把
`(target, content, expected)` 交给 `ctx.fs.writeText`，完全没用上已挂载后端的沙箱。
于是 `SandboxedFileSystem.checkedTarget` 在**没有会话**的情况下解析策略，拿到的是
部署默认值：base bundle 里 `workspace-write` 的回退根，也就是**宿主进程的
`process.cwd()`**（`DSH_PERMISSION_MODE ?? 'workspace-write'`）。稿纸在会话的工作区
里，宿主进程却是从别的目录起来的，所以每一次写都被拒绝——而读全都不设围栏地通过，
这正解释了为什么列表能显示「还没有灵感」，只有写失败。

能力事实是 `ctx.fs.sandboxMode`：裸本地后端是 `undefined`，带围栏的后端是部署默认
模式。`ctx.sandboxPolicy` 是逐会话解析的唯一归属；harness 在所有有会话的地方都是逐
调用解析的（`tool-fs` 经它的 sandbox controller、`tool-bash`、`tool-pwsh`、
`terminal-bash`），并把结果当作 `writeText` 的第五个实参传下去。

## Decision

**一次稿纸写入，由发起这次点击的会话来围栏。**

- 三个写接口的第一个参数改成调用方 `agent`（`@Remote('create')`、
  `@Remote('write')`、`@Remote('setArchived')`）。浏览器半边把 tab 的 `sessionId`
  传进去；生成出来的 client 类型把这个首参写成 `agentId: SessionId`。这是既有的
  wire 查找约定，不是新发明——datasets tab 用的就是同一个形状。
- `CanvasService.create/write/setArchived` 现在**必须**带 `session`：每次调用解析一次
  `ctx.sandboxPolicy.resolve({ session })`，并把结果盖在正文写入**和**
  `.index.json` 写入上。`list`/`read` 保持原签名：围栏是写围栏，只被读取的会话也必须
  能浏览稿纸。
- 策略 home 只在构造时 `ctx.fs.sandboxMode !== undefined` 才捕获，因此不围栏的本地后
  端（单元测试、只装 `dsh-fs-local` 的部署）依旧不传任何策略，行为与从前完全一致。
- 失败即关闭：会话自己的工作区不包含稿纸目录 → 拒绝；会话是 `read-only` → 拒绝。两
  者读到的都是既有的 `error.denied` 文案（`这个位置不可写`），而现在这句话是准确的。
- 挂了围栏后端却没有策略 home 的组合，**静默降级**而不是加载失败：那次写入不带策略，
  由后端自己的回退来裁决（仍是拒绝，绝不会变成无围栏写入）。

## Verification

- `packages/canvas/tests/service.spec.ts`：测试替身现在照搬 `dsh-fs-sandbox` 的围栏
  ——会围栏的替身拒绝一切落在调用方解析根之外的目标，并在调用没带策略时回退到宿主
  cwd 根。因此删掉这次盖章会让测试失败，而不是悄悄退回回退根。四个用例：正文**和**
  索引写入都带会话根；编辑与归档写入从不碰回退根；外来会话被拒；不围栏后端不带策略。
- `packages/canvas/tests/remote.spec.ts`（新增）：三个写方法把 `agent.session` 转交给
  store；两个读方法不需要 agent。

## Alternatives considered

**用部署默认模式 + 请求自带的目录当根**（`{ mode: ctx.fs.sandboxMode, workspaceRoot:
dir }`）。不新增 peer 依赖、不动 wire，而且能修好上报的这个案例——部署默认模式确实就
是 `workspace-write`。它输在一点：模式来自部署而不是来自调用方。被操作者切成
`read-only`（或提权到 `danger-full-access`）的会话，会被部署默认值围栏，而不是被它
自己的决定围栏；而 harness 其他所有地方都是逐会话解析策略的，一次人手触发的 UI 写入
没有理由成为例外。

**让浏览器把模式发上来**（客户端传 `{ mode, workspaceRoot }`）。围栏不归客户端所有；
模式必须在宿主侧从会话解析，任何 wire 传上来的模式都是迟早要被利用的绕过口。

**文件系统会围栏却没有策略 home 时直接抛错**，即 `FsSandboxController` 对 tool-fs 的
做法。否决：本仓的规矩是降级而不是爆炸，缺一个能力就抛错会把整个 boot 拖下水。后端
自己的回退让这次降级仍然是失败即关闭。

**为了 wire 整齐，把 `agent` 也加到 `list`/`read` 上**。读本来就不设围栏，而且没有活
agent 的会话（旧的、已归档的会话）也必须能渲染自己的稿纸。一个永远会被丢掉的参数，比
一个不对称但有理由的契约更糟。

## Consequences

上报这个 bug 的部署里，稿纸重新可用了：写入落在会话自己的工作区，围栏跟着会话走，而
不是跟着宿主进程的目录走。

wire 契约变了：`remote.canvas` 的每个写方法现在第一个参数是会话。本包是它唯一的消费
者，浏览器半边是唯一的客户端，所以没有别的调用方需要迁移。

peer 面多了三个官方包——`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-sandbox`、
`@deepseek-ai/dsh-sandbox-policy`（仅类型，peer + dev，并补上 workspace 的
`overrides`/`minimumReleaseAgeExclude` 条目）。这是「对着真实宿主服务解析策略、而不
自己重写一遍策略」的代价。

`read-only` 的会话依旧完全用不了稿纸。这是对该模式的诚实解读而非疏漏，但确实意味着
按那种方式配置的部署里这个功能不可用——拒绝文案会这么告诉使用者。
