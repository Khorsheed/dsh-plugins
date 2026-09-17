# Agent Note: claude 的凭据同步不能把凭证链往回拨

Status: proposed

[English](2026-09-17-claude-credential-sync-newer-wins.md) | 中文

## Problem

一轮容器化的 claude 委派会把整台实例登出。T33e 实测到了（宿主轮 12.0 秒 ready，容器轮 NOT READY，`.credentials.json` 在探针那一刻被清空：两个 token 都是空串、`expiresAt` 为 0），与题库 pilot 日志里记作 G9 的那条逐字吻合。恢复要人到终端前重登。

三件事必须同时成立，而它们都成立：

1. **两个存储，单向同步。** macOS 上 OAuth 凭证同时在 keychain（按 config 目录路径哈希的条目）与 `<homeDir>/.credentials.json` 里。claude 2.1.236 起写 keychain、读文件，于是 `syncClaudeCredentialFile` 做的是 keychain → 文件这一个方向。它从四处被调用：`claude-cli-provider.ts` 每次 exec spawn 之前、`live-driver.ts` 每次常驻 spawn 之前、`claudeAuthenticated`（于是每次状态读与就绪探针）、以及登录 watch。
2. **单元是同一个文件的第二个写者。** T20c 起容器轮 bind 挂的就是实例自己那个作用域目录（读写），`acquireSpecFor` 声明的正是这一条挂载。单元里没有 keychain，claude 只能读写挂进来的文件：access token 过期 → 续期 → 轮换后的凭证经挂载写回宿主。
3. **即使是容器轮，同步跑的也是宿主目录。** provider 构造的是 `env: delegationEnv({ CLAUDE_CONFIG_DIR: homeDir })`，里面是宿主路径；`containerExecSpawn` 只在 `docker exec -e` 转发那一层把它换成容器内路径。于是 `startClaudeCliRun` 里 spawn 前的 `syncClaudeCredentialFile(configDir)` 作用在宿主作用域目录上——而单元马上要经挂载读的就是这个文件。

之后的链条是必然的：单元轮换 refresh token、把第 N+1 代写进文件；keychain 里仍是第 N 代；下一次同步用 N 盖掉 N+1；再下一次使用递上已被消费的 refresh token；端点拒绝；claude 清空文件。实例随之登出，因为被清空的这个文件就是实例的凭据。

这个状态今天还在 lab 那个 home 里躺着。文件在 2026-09-16 本地时间 15:59 被重写——比清空那一轮晚三小时——现在装的是一份 access 过期时间为 2026-09-09、refresh 过期时间为 2026-10-08 的凭证：一份轮换之前的世代，被后来的同步盖回了被清空的空壳之上。`credentialFileExpiry` 取两个过期时间里较晚的那个，于是 `claudeAuthenticated` 对一份根本续不动的凭证仍然答「是」。

容器内的 CLI 确实是第二个写者：单元镜像装的是 claude 2.1.272，单元用户的 home 是一个普通家目录、没有指向别处的 `.claude` 软链，而条件传的是 `CLAUDE_CONFIG_DIR=/creds/claude`；pilot B 的 claude 就是靠这条挂载在真单元里拿到 4 分的。provider 自己那条关于上游 #47661 的注释（Linux 上读默认 home、只写作用域目录）并不描述 2.1.272 在这里的行为——下面有一步专门去证实，而不是在两种读法里挑一种信。

缺陷不在于有两个写者。在于同步是无条件的：它是唯一一个能把凭证链**往回拨**的参与者，而且恰好在另一个写者动手之前拨。

## Proposal

**把 `syncClaudeCredentialFile` 改成「新者胜」。** 只动 `records.ts` 里这一个函数；四个调用点一个字不改。

今天它读 keychain，拿到可用凭证就覆盖文件（字节相同时跳过）。改法：两边都读，比较 `claudeAiOauth.expiresAt`（access token 的过期时间——续期必然铸出更晚的一个），只有 keychain 那份更晚时才写。不满足 `credentialUsable` 的文件永远不会赢，所以既有的「从 keychain 治好空壳」与「删掉空壳」两条路原样保留。任一侧没有 `expiresAt` 时 keychain 胜——这就是今天的行为，因而是安全的兜底。

实现要负责的判定表：

| 文件 | keychain | 动作 |
|---|---|---|
| 缺失 / 不可用 | 可用 | 写入 keychain 那份（今天如此） |
| 缺失 / 不可用 | 无 | 有空壳则删除，返回 false（今天如此） |
| 可用 | 无 | 不动文件，返回 true（今天也不动，但返回 false） |
| 可用、字节相同 | 可用 | 不写（今天如此） |
| 可用、`expiresAt` 更早 | `expiresAt` 更晚 | 写入 keychain 那份（今天如此） |
| 可用、`expiresAt` 更晚 | `expiresAt` 更早 | **不动文件——新增的那一格** |
| 任一侧无 `expiresAt` | 可用 | 写入 keychain 那份（今天如此） |

返回值的含义从「文件里装的是当前 keychain 凭证」改为「调用之后文件里有一份可用凭证」。没有调用方读它——两个 spawn 点用 `.catch(() => false)` 吞掉，登录 watch 会重新探，`claudeAuthenticated` 自己读文件——所以这是文档注释加测试的改动，对调用方而言不是行为改动。

**加两条 warn 日志，不带任何密文。** 一条在同步拒绝覆盖时（文件领先于 keychain，即容器轮换过的情形，它应当罕见、且发生时应当看得见），一条在从 keychain 治好被清空的空壳时。每条只写作用域目录与两个过期时间，绝不写 token 内容。今天这两件事都是静默的——G9 当初只能靠一个文件 mtime 反推，就是因为这个。

**评测的挂载保持读写。** 不只是为了续期：claude 把会话记录写在作用域目录下的 `projects/` 里，而评测的模型回读正是从同一条挂载的宿主侧解析这些文件。改成只读会让每一格容器化的 claude 的 `model.observed` 都是 null。

**写回 keychain 有意不放进本次改动。** 见备选 (a2)。

改动范围：`packages/local-agent-claude-code/src/records.ts` 与其测试，加上该包 README 的凭据一节与双语伴随记录。`packages/eval` 不动——挂载已经是读写，且必须保持读写。

## Alternatives considered

**(a2) 新者胜，外加写回 keychain。** 文件领先时顺手推回 keychain（`security add-generic-password -U`），让 keychain 保持为一份可用的恢复副本，而不是任由它落后到不知多远。本次否决：这个包至今只**读**过 keychain，写是一项新能力、带着自己的授权弹窗行为，而且正确性并不需要它——文件赢过一次之后，下一轮宿主委派会基于文件续期并自行写 keychain，两个存储会自己重新收敛。若将来真要把 keychain 当恢复路径，再拿出来。

**(b) 容器专用命名 scope。** T29 给每个条件一个 `scope` 字段，claude 的容器条件可以跑在 `claude-code@<scope>` 上，登录时同步一次、此后不再同步，单元成为唯一写者。它是唯一能彻底消除并发续期竞态的候选，也契合「每个 scope 各自 login」这条既有规矩。本次不作为修法，有三个原因：每个容器 scope 要一次人工登录；那个 scope 的同步仍然必须被抑制，因为 `claudeAuthenticated` 在每次状态读与就绪探针里都会同步，于是 (a) 形状的工作照样躲不掉；以及评测侧目前根本没法给条件指定命名 scope——条件文件有这个字段，Remote 面却没有 `conditionsProvision`，那是 T33f 的地界，不是这个包的。推荐作为那条路打通之后的后续项。

**(c) 只读挂载、续期只留在内存。** 与凭据无关的理由就已经把它判死：作用域目录同时是 claude 写 `projects/<cwd-slug>/*.jsonl` 的地方，而评测的 `readClaudeTranscriptModel` 回读正是从挂载的宿主侧解析这些文件。只读会丢掉每一轮容器化 claude 的观测模型。claude 在只读目录下续期究竟是内存里用还是直接报错，因此不值得再去证。

**(d1) 仿 kimi 的哨兵备份。** kimi 的 `credential-guard.ts` 会快照一份有效凭证、在文件变成精确空壳时还原回去。claude 其实已经有等价物——keychain 就是那另一份副本，同步也已经在从它还原——而那次还原正是 lab home 里现在那份陈旧凭证的来源。再加第三份副本，等于再加一条复活已消费 token 的路。否决；上面那两条 warn 才是真正缺的那一半，即可见性。

**(d2) 容器 exec 目标时跳过 spawn 前的同步。** 便宜——两个 spawn 点各加一个以 `spec.exec !== undefined` 为键的条件。但它只修 spawn 点：`claudeAuthenticated` 在每次状态读与每次就绪探针里都会同步，而 T20c 起就绪探针本身就是一次真委派，覆盖照旧发生。作为一个会被读成完整修复的部分修复，否决。

**(d3) 每轮把凭据拷一份到暂存目录。** 与既有凭据规矩正面冲突——凭据不复制，只在 0600 文件与 keychain 里，别处没有——而且同样会打断回读，回读要的是这一轮的产物落在实例自己的作用域目录里。

## Acceptance criteria

1. 一轮轮换过凭据的容器轮之后，文件保持轮换后的状态：紧接着的宿主同步不会把它拨回去，该 scope 的下一轮宿主委派成功。
2. 普通的纯宿主轮换照常工作：keychain 领先于文件时，同步照今天的样子更新文件。
3. 被清空的空壳仍能从 keychain 治好；keychain 里没有可用凭证的空壳仍被删除。
4. 某个 scope 的容器轮报 ready 之后，同一实例该 scope 的宿主轮仍 ready，`/claude-code status` 仍报已认证。
5. `local-agent-claude-code` 测试全绿；`gate` 绿。
6. 任何日志行、测试夹具、Agent Note 与回报中都没有 token 内容。

## Verification recipe

时序不能真等过期，所以要造。下面没有任何一步写 token；对凭据文件唯一的改动是一个时钟字段。

**先做单元层。** `records.spec.ts` 已经会把 `internals.exec` 换成假的 `security`，于是上面判定表的每一行都是一个针对临时 home 的单元测试：文件领先（不动）、keychain 领先（重写）、空壳加可用 keychain（治好）、空壳加什么都没有（删除）、可用文件加没有 keychain（不动）、字节相同（不写、mtime 不变）、以及缺 `expiresAt` 的凭证（keychain 胜）。修复本身是在这里被证明的；下面那轮造出来的时序证的是接线。

**先证一步。** 造任何时序之前，先确认到底是哪个进程写了挂进去的文件：用一个临时 scope 取一个单元，在里面跑一次 `docker exec` 的 claude 委派，看挂载的 `.credentials.json` mtime 是否移动。这一步把 #47661 对镜像里 claude 2.1.272 的问题定死，也告诉我们清空发生在宿主侧还是单元侧。两种归属都被本修复覆盖，但笔记应当写明实际是哪一种，而不是留下两种读法。

**端到端造时序**，在一个用完即弃的命名 scope 上做，不要用默认 scope——一次跑歪的排练不能把实例第二次登出：

1. 指纹，不含密文：一段 node 片段，打印 `sha256(refreshToken)` 截前 8 位十六进制、`expiresAt`、以及文件 mtime。每一步前后各调一次；这是任何记录里唯一的凭据读取。
2. 逼单元续期：只重写 `claudeAiOauth.expiresAt` 为一个过去的时刻，其余字段逐字节不变，权限仍是 0600。这是改时钟、不是改凭据——claude 于是认为 access token 已过期，下一次运行就会续期。
3. 对该 scope 跑一轮容器委派。refresh token 的指纹必须**变化**，`expiresAt` 必须移到未来：单元轮换了链条并经挂载写了回来。
4. 立刻触发一次宿主同步——`/claude-code status --scope <name>` 会走 `claudeAuthenticated` → `syncClaudeCredentialFile`。修复前指纹会退回第 2 步的值，那就是直接观测到的复活；修复后它仍等于第 3 步的值。
5. 随后对该 scope 跑一轮宿主委派并成功，证明活下来的文件就是活着的那条链。
6. 反方向，免得修复靠「干脆永不写」蒙混过关：把**文件**的 `expiresAt` 设到过去，跑一轮**宿主**委派（它会续期进 keychain），确认下一次同步更新了文件。

之后在默认 scope 上做验收跑：容器轮 ready、宿主轮 ready、状态不变。那个 scope 要先重登——它今天装的是轮换之前的世代，续不动——所以登录是第二步验收的前置条件，不是它的结果。

**证据纪律。** 日志、Agent Note 与回报里只有指纹、过期时间、mtime 与布尔值。凭据文件从不打印，keychain 也从不被 dump 进任何记录。

## Risks

- **并发续期的竞态仍在。** 新者胜消除的是系统性的复活——一次把已消费 token 递回来的同步——但两个进程在同一时刻续同一个一次性 token，仍然会有一条链输掉。宿主轮与容器轮重叠时依然可能如此；容器路径每格是串行的，所以窗口小，但真实存在。只有备选 (b) 能消除它，这也正是把它列为推荐后续项的原因。
- **拿 `expiresAt` 当新旧判据。** 它假设续期必然铸出更晚的 access 过期时间。缺这个字段的凭证退回 keychain 胜，即今天的行为；被手工改成未来时间的文件会错误地获胜，而这只有操作者能造成，且配方第 2 步刻意改的是反方向。
- **一份已死的凭据仍读作已认证。** `credentialFileExpiry` 取 access 与 refresh 两个过期时间里较晚的那个，于是一份 access 在九月初就过期、refresh 要到十月才过期的凭证——正是今天 lab 那个 home——在某一轮真失败之前都报已认证。这是另一个缺陷，本次改动**不碰**它：把探针收紧会让一些现在 ready 的 scope 变成 not ready，那是协调者的决定，不该当成副作用夹带进来。
- **不写回会让两个存储越离越远。** 拒绝覆盖意味着 keychain 可以落后到任意远。只要宿主 CLI 读文件就无害，但将来若有某个 claude 版本优先读 keychain，旧凭证会换一条路复活。真到那天，答案是 (a2)。

## Other harnesses

- **codex**：`provisionCodexConfig` 把 `cli_auth_credentials_store = "file"` 钉死，于是只有**一个**存储，宿主与单元经挂载共用它——一条链，没有复活的路，没有分叉。它在 T33e 的失败在宿主轮同样存在，所以不是这个 bug，本次也不处理。
- **kimi**：只有文件存储、没有 keychain，同样不分叉。它的 `credential-guard.ts` 会在文件变成空壳时用 `.bak` 还原，因而**可能**重放一个已消费的 refresh token——同一族的问题——但它只在精确的空壳之上还原、绝不覆盖可用文件，且它自己的笔记把损失限定为「再响一次的失败」。不提改动。
- **dsh**：API key 经环境注入，没有续期流程。不受影响。

## Relation to T33f

T33f 说的是 dsh 两侧共用同一 scope 以及它怎么愈合；它是观察项，本任务不碰。有一句要说明白：本推荐**有意**不去阻止 claude 两侧共用同一个 scope——它做的是让这种共用活得下来。备选 (b) 会顺带把 claude 的两侧共用也断掉；选了 (a) 就意味着 claude 的共用状况与 T33f 为 dsh 描述的完全一致，那边日后定案时，claude 按同样的条款适用。
