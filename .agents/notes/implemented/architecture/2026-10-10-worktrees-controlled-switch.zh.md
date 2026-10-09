# Agent Note: worktrees agent-free 查询与受控切换——Remote 线上的接入接缝

Status: implemented

## Problem

一个按授权工作区消费本插件的可信服务端调用方需要两件本包做不到的事。其一，为它已授权的路径**读**仓库/worktree 状态：每个仓库维度的 Remote 动词（`summary`、`changes`、`repoFiles`、`listWorktrees`、`commitLog`、`commitFiles`、`fileDiff`、`readFile`、`readFileAtCommit`、`readRepoImage`）都收一个 `agent: Agent` 查找参数，只为推导一个 cwd（`activeWorktreeOf(agent.id) ?? agent.session.header.cwd`），而宿主的统一 agent 查找可能**唤醒**离线会话——代表成员发起的查询绝不能触发它。其二，在并发下**写**按会话的 worktree 绑定：当时唯一的切换是内存 map 上的 last-write-wins（宿主一重启就丢），没有 compare-and-swap，除了从 `summary` 反推之外无法读当前绑定，绑定变化也没有任何事件。

## Decision

全部演进都是 Remote 线上的增量（`packages/worktrees`，版本保持 0.3.1）：agent 绑定动词与原生 UI 逐字节不动；从不调用新动词的部署行为与之前完全一致——唯一的例外是绑定新获得的持久性。

- **agent-free 查询动词**（`packages/worktrees/src/remote.ts`）：`summaryAt` / `changesAt` / `repoFilesAt` / `listWorktreesAt` / `commitLogAt` / `commitFilesAt` / `fileDiffAt` / `readFileAt`（带 `commit` 参数即 `readFileAtCommit` 的孪生）/ `readRepoImageAt`。每个都收 `{ at, … }`——目标仓库/worktree 内任意绝对路径，由既有 `assertSafeLocalPath` 校验——并委托同一个服务核心，因此与 agent 绑定孪生的一致性由构造保证。与本地文件动词同理：授权/圈禁是可信调用方的职责，本面不做任何准入。
- **受控切换** `switchWorktreeControlled(sessionId, { path, expected? })`（`src/service.ts` 的 `controlledSwitch`，Remote 是薄包装）：sessionId 是裸字符串，仓库从**目标路径**解析，返回类型化回执联合（`src/bindings.ts` 的 `ControlledSwitchReceipt`）而非抛错谱系——`switched`（WorktreeInfo + 生效绑定 + `persisted`）| `conflict`（携带**实际**当前绑定）| `not-a-repo` | `no-worktree` | `invalid-request` | `persistence-failed`。给了 `expected`（`{ kind: 'override', path }` 或 `{ kind: 'none' }`）就是 compare-and-swap，绝不静默 last-write-wins。CAS 是**单进程**语义：进程内 map 加它的写穿文件，没有跨进程锁。
- **持久化**：override map 写穿到解析出的状态根下的 `bindings.json`（`resolveWorktreesStateRoot`——显式配置 `stateRoot` → `$DSH_HOME/state/worktrees` → `<cwd>/.dsh-worktrees`，sidechat/canvas 惯例），tmp 文件 + rename，挂载时加载。回执只在写盘成功后返回；写失败是 `persistence-failed` 回执、内存保持原状（legacy 动词抛错），绝不假成功。文件损坏/不可读时降级纯内存且**绝不重写**；此时回执带 `persisted: false`——诚实信号。变更顺序是先持久化再改内存，因此内存与文件不会静默分叉。
- **getter 与事件**：`worktreeBinding(sessionId)` 返回 `WorktreeBinding`（`override`/`none`；`none` = 会话跟随自己的静态 cwd，本面在结构上读不到它）。每次绑定被成功 SET——legacy switch/create 与受控切换都算——经 cordis 事件 `worktrees/switched` 发出 `{ sessionId, path }`（在 `apply` 里经服务的 `onSwitched` 钩子接线；v1 里清除不发事件）。这是进程内事件，**不是浏览器推送**；桥接/重读是消费方的事。
- **既有执行永不迁移**：接缝改写的只是绑定（数据面跟随哪个 worktree）；既有执行的恢复工作目录锚定在它自己的执行记录上，因此新绑定只对新成员/新执行生效。两份 README 都把这条写成消费方不得违背的契约。

## Alternatives considered

- **包根工厂（file-preview read-surface / canvas workspace-access 先例）**：形状不对——file-preview 的接缝是对可完全由注入源推导的状态做**只读**，而本接缝的核心是对**宿主持有状态**的写：绑定 map、它的持久化与 switched 事件都住在宿主实例上挂载的服务里。调用方进程里的工厂会造出第二个分叉的 CAS 状态。查询动词跟随写入落到同一条线、同一个调用方推导授权模型上。
- **给既有动词传 facade `Agent`**：伪造 `Agent`/`Session`（canvas facade 先例）会重新引入接缝恰恰要避开的查找语义——而且一个意外触达真实统一查找的假对象可能唤醒离线会话。纯 JSON 动词让「够不到 agent」成为结构事实。
- **`bindings.json` 走 `ctx.fs` 会话盖章围栏（sidechat/canvas）**：那条围栏按**会话**解析沙箱策略；绑定键是裸会话 id，在消费拓扑里不是宿主 `Session` 对象，无法为它们解析会话盖章策略。对插件自己的状态目录用裸 `node:fs` 有 canvas 状态目录先例（它的 `rm -r`）。代价如实记录：部署的只读**模式**不参与这个文件的裁决——它是部署级插件状态，不是会话工作区内容。
- **只做静默 last-write-wins**：两个获授权调用方竞争同一会话时，各自只看到自己的写赢、没有任何信号。`expected` 的 compare-and-swap 配上携带**实际**绑定的 conflict 回执，给了调用方重新决策所需的事实；`expected` 缺席则保留 legacy 的 fire-and-forget 语义可用。

## Consequences

- Remote 命名空间新增十一个动词（`summaryAt`、`changesAt`、`repoFilesAt`、`listWorktreesAt`、`commitLogAt`、`commitFilesAt`、`fileDiffAt`、`readFileAt`、`readRepoImageAt`、`worktreeBinding`、`switchWorktreeControlled`）；生成的 wire 类型已带上它们，词汇表（`WorktreeBinding`、`ControlledSwitchRequest`、`ControlledSwitchReceipt`、`WorktreeSwitchedEvent`、`WORKTREES_SWITCHED_EVENT`、`resolveWorktreesStateRoot`）从 `./types` 再导出。
- `WorktreesService` 新增 options 参数（`stateRoot`、`onSwitched`）；裸 `new WorktreesService(baseRef)` 保持纯内存，因此全部既有测试的构造方式不变。插件配置新增 `stateRoot`（schema 默认 `''` → 解析链）。legacy 变更动词现在先等绑定加载再写穿；Remote 的 `cwd()` 同样等加载，因此重启后徽标跟随持久化的 override（两份 README 里「仅内存」的旧已知限制随之退役）。
- cordis 事件 `worktrees/switched` 声明在 cordis `Events` 接口上；清除绑定（删掉被绑定的 worktree）在 v1 不发事件——需要清除信号的消费方走 getter 重读。
- 全部 97 个既有测试原样通过；13 个新契约测试（共 110）在 `packages/worktrees/tests/controlled-switch.spec.ts` 钉住接缝。消费方仍欠自己的准入层（按成员推导授权路径集合与会话 id 命名空间）——本包刻意不做。

## Testing

`packages/worktrees/tests/controlled-switch.spec.ts` 驱动真实临时仓库（主检出在特性分支、`main` 上一个链接 worktree）：agent-free 动词与 agent 绑定孪生在同一夹具上 `toEqual` 对比（summary/changes/repoFiles/listWorktrees/commitLog/commitFiles/fileDiff/readFile/readFileAtCommit/readRepoImage，主检出与链接锚点各一遍）；CAS 序列（none → switched、过期 none → 携带实际绑定的 conflict、匹配 override → switched、legacy↔受控共享状态）；not-a-repo / no-worktree / invalid-request 分类；经模拟重挂载的持久化往返，并对照磁盘文件断言「回执在持久化之后」的顺序；损坏文件降级（纯内存、`persisted: false`、文件绝不重写）；强制写失败（chmod 0555）产出 `persistence-failed`、内存不动、legacy 动词抛错；事件载荷覆盖（legacy switch、create、受控切换；conflict 与清除时静默），含真实 cordis Context 上 `apply` 接线的 `ctx.emit` 路径；以及在 stub 的 `DSH_HOME` 下的状态根解析链。
