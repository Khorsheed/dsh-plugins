# Agent Note: claude 的凭据同步不再把凭证链往回拨

Status: implemented

[English](2026-09-17-claude-credential-sync-newer-wins.md) | 中文

## Problem

一轮容器化的 claude 委派把整台实例登出了。T33e 实测到——宿主轮 12.0 秒 ready，容器轮 NOT READY，`.credentials.json` 在探针那一刻被清空（两个 token 都是空串、`expiresAt` 为 0）——与题库 pilot 日志里记作 G9 的那条是同一件事。恢复要人到终端前重登。

三件事必须同时成立，而它们都成立：

1. **两个存储，单向同步。** macOS 上 OAuth 凭证同时在 keychain（按 config 目录路径哈希的条目）与 `<homeDir>/.credentials.json` 里。claude 2.1.236 起写 keychain、读文件，于是 `syncClaudeCredentialFile` 做的是 keychain → 文件这一个方向。它从四处被调用：exec spawn 点、live driver 常驻 spawn 点、`claudeAuthenticated`（于是每次状态读与每次就绪探针）、以及登录 watch。
2. **单元是同一个文件的第二个写者。** T20c 起容器轮 bind 挂的就是实例自己那个作用域目录（读写），`acquireSpecFor` 声明的正是这一条挂载。单元里没有 keychain，里面的 CLI 只能读写挂进来的文件：access token 过期 → 续期 → 轮换后的凭证经挂载落回宿主。
3. **即使是容器轮，同步跑的也是宿主目录。** provider 构造的是 `env: delegationEnv({ CLAUDE_CONFIG_DIR: homeDir })`，里面是宿主路径；`containerExecSpawn` 只在 `docker exec -e` 转发那一层把它换成容器内路径。于是 spawn 前的 `syncClaudeCredentialFile(configDir)` 作用在宿主作用域目录上——而单元马上要经挂载读的就是这个文件。

之后的链条是必然的：单元轮换 refresh token、写下第 N+1 代；keychain 里仍是第 N 代；下一次同步用 N 盖掉 N+1；再下一次使用递上已被消费的 refresh token；端点拒绝；CLI 清空文件。实例随之登出，因为那个文件就是实例的凭据。

缺陷从来不在于有两个写者，而在于同步是无条件的——它是唯一一个能把凭证链**往回拨**的参与者，而且恰好在另一个写者动手之前拨。

**两个悬而未决的问题都由实测定死，全程不涉及任何真实凭据。** 造一个只装明显伪造的 token、access 过期时间设在过去的临时目录，挂到条件声明的容器内路径上，在 `eval-env:pinned` 里经评测网络跑一轮。回来两件事：

- 该轮报 `Failed to authenticate: OAuth session expired and could not be refreshed`，而**挂载的文件被留成两个 token 空串、`expiresAt` 为 0**——与 T33e 观察到的形状逐字一致。所以清空的写者是**单元里的 CLI**，不是宿主上的任何东西；claude 2.1.272 在 Linux 上对凭据文件是认 `CLAUDE_CONFIG_DIR` 的。provider 里沿用下来的那条上游 #47661 注释（Linux 读默认 home）并不描述这个版本；README「已知限制」那条保持原样，因为这次只测了容器这一侧。
- 同一轮在挂载目录里创建了 `projects/`、`sessions/`、`backups/` 与 `telemetry/`。本轮的会话记录落在那里，而评测的模型回读正是从同一条挂载的宿主侧解析它们。

## Decision

`syncClaudeCredentialFile` 改为**新者胜**。只动 `records.ts` 里这一个函数；四个调用点照旧调用。

它现在两边都读，比较 `claudeAiOauth.expiresAt`——即 **access token** 的过期时间，经新增的 `credentialAccessExpiry` 读出。有意不用 `credentialFileExpiry`：那一个回答的是「这份凭证还能不能用」，取 access 与 refresh 两者中较晚的，于是同一次授权的两个世代共享 refresh 过期时间、比较起来相等。而续期必然铸出更晚的 access 过期时间，那正是区分世代的东西。

只有 keychain 那份不比文件旧时才写：

| 文件 | keychain | 动作 |
|---|---|---|
| 缺失 / 不可用 | 可用 | 写入 keychain 那份（不变） |
| 缺失 / 不可用 | 无 | 有空壳则删除，返回 false（不变） |
| 可用 | 无 | 不动文件，返回 **true**（此前返回 false） |
| 可用、字节相同 | 可用 | 不写（不变） |
| 可用、`expiresAt` 更早 | `expiresAt` 更晚 | 写入 keychain 那份（不变） |
| 可用、`expiresAt` 更晚 | `expiresAt` 更早 | **不动文件——新增的那一行** |
| 任一侧无 `expiresAt` | 可用 | 写入 keychain 那份（不变） |

不可用的文件无论过期时间多晚都不会赢，所以被清空的凭据照旧从 keychain 治好，背后没有可用凭证的空壳照旧被删除。

**两件此前静默的决定现在会记日志。** 函数新增一个可选的 warn 通道。一条在它拒绝覆盖时——文件领先于 keychain，这正是容器轮换过凭证的特征。一条在它治好被清空的凭据时，写明：若下一轮仍认证失败，说明这次授权已经被用掉，该 scope 需要重登。两条都只带作用域目录与两个过期时间，绝不带 token 内容；有测试断言两个存储的 token 都不出现在该行里。上一次发生这件事时，复原它花了一个文件 mtime 加一份 pilot 日志——静默本身就是缺陷的一部分。

通道接在有 logger 的地方：两个 spawn 点、登录 watch，以及经 `claudeAuthenticated` 新增的可选第二参数接到认证探针。最后这个最要紧：它是两个 spawn 点覆盖不到的覆盖点，因为 T20c 让就绪检查本身成了一次真委派，而探针在每次状态读时都会跑。

返回值的含义从「文件里装的是当前 keychain 凭证」改为「调用之后文件里有一份可用凭证」。没有调用方读它——两个 spawn 点用 `.catch(() => false)` 吞掉，登录 watch 会重新探，`claudeAuthenticated` 自己读文件。

**评测的挂载保持读写**，`packages/eval` 一个字没动。只读已被实测证明是死路，理由与凭据无关：模型回读要解析的会话记录就写在同一个目录里。

## Consequences

- 容器轮可以轮换凭证，而宿主不会再把一个已消费的 token 递给下一轮。系统性的复活没有了。
- keychain 现在可能落后文件任意远。只要宿主 CLI 读文件就无害，而且两个存储会自己重新收敛：文件赢过一次之后，下一轮宿主委派基于它续期并自行写 keychain。写回 keychain 的方案已评估并推迟（见下）。
- 一件罕见而真实的事件现在在日志里看得见，而不必靠一个文件 mtime 去复原。
- 在没有 keychain 的 Linux 宿主上，一份可用的文件不再被报成不可用的凭据。
- 这次协调**拿哪一条 keychain 条目**来比，是由 service 枚举的「最新写入优先」排序决定的，而那个排序本身有缺陷——它从来没解析对 `security` 打印的印记格式，于是返回的是 dump 里恰好排在最前的那条可用条目。新者胜再好，也只能好到递给它的那条为止；见[keychain 印记排序那份记录](2026-09-17-keychain-stamp-ordering.md)。

## Alternatives considered

**新者胜外加写回 keychain。** 文件领先时顺手推回 keychain（`security add-generic-password -U`），让 keychain 保持为一份可用的恢复副本。推迟：这个包至今只**读**过 keychain，写是一项新能力、带着自己的授权弹窗行为，而正确性并不需要它——两个存储会经下一次宿主续期自行收敛。若将来真要把 keychain 当恢复路径，再拿出来。

**容器专用命名 scope。** T29 给每个条件一个 `scope` 字段，claude 的容器条件可以跑在 `claude-code@<scope>` 上，登录时同步一次、此后不再同步，单元成为唯一写者。它是唯一能彻底消除并发续期竞态的候选，也契合「每个 scope 各自 login」这条既有规矩。这次没走：每个容器 scope 要一次人工登录；那个 scope 的同步仍然必须被抑制，因为认证探针在每次状态读时都会协调，于是新者胜形状的工作照样躲不掉；而且评测侧目前根本没法给条件指定命名 scope——条件文件有这个字段，Remote 面却没有 `conditionsProvision`。记为那条路打通之后的后续项。

**只读挂载、续期只留在内存。** 实测判死：同一轮在被拒绝写凭据的同时也被拒绝写 `projects/`，而评测的 `readClaudeTranscriptModel` 回读正是从挂载的宿主侧解析那些文件。claude 在只读目录下续期究竟如何，根本不必再去证。

**仿 kimi 的哨兵备份。** kimi 的 `credential-guard.ts` 会快照一份有效凭证、在文件变成精确空壳时还原回去。claude 已经有等价物——keychain 就是那另一份副本，同步也已经在从它还原——而那次还原正是一次清空之后磁盘上留下陈旧世代的原因。再加第三份副本，等于再加一条复活已消费 token 的路。上面那两条 warn 才是真正缺的那一半，即可见性。

**容器 exec 目标时跳过 spawn 前的同步。** 便宜——两个 spawn 点各加一个以 `spec.exec !== undefined` 为键的条件——但它只修 spawn 点。认证探针在每次状态读与每次就绪检查里都会协调，覆盖会在一个读起来像完整修复的改动里存活下来。

**每轮把凭据拷一份到暂存目录。** 与既有凭据规矩正面冲突而拒绝——凭据不复制，只在 0600 文件与 keychain 里，别处没有——而且会打断回读，回读要的是这一轮的产物落在实例自己的作用域目录里。

## Testing

`records.spec.ts` 新增一个 `newer wins` 套件，判定表每一行一个用例，跑在临时 home 上、把 `internals.exec` 打桩成假的 `security`：领先于 keychain 的文件被保留并被报出、领先于文件的 keychain 照常写入、没有 access 过期时间的凭证仍由 keychain 写、不可用的文件无论过期时间多晚都不会赢、字节相同时不碰文件 mtime、以及轮换过的文件在 `claudeAuthenticated` 下与在同步下同样存活。warn 相关的断言检查两个存储的 token 值都不出现在输出行里。一个既有用例随返回值含义的变化改了预期：可用文件加上 keychain 里没有可用凭证，现在返回 true。

测试没覆盖的一处，以及为什么没覆盖：单元里的**真实**轮换需要一份真实授权，而任何测试都不该持有它。上面那次判定跑用伪造 token 证了单元的「读了并清空」行为；宿主那一半由测试套件证；两者之间的接缝——一次真实的容器续期紧接着一次宿主协调——是在用完即弃的命名 scope 上排练，需要一次交互式登录，因而需要人。

## Risks

- **并发续期的竞态仍在。** 新者胜消除的是系统性的复活，但两个进程在同一时刻续同一个一次性 token，仍然会有一条链输掉。宿主轮与容器轮重叠时依然可能如此；容器路径每格是串行的，所以窗口小，但真实存在。只有命名 scope 那个备选能消除它。
- **拿 `expiresAt` 当新旧判据**假设续期必然铸出更晚的 access 过期时间。缺这个字段的凭证退回 keychain 胜；被手工改成未来时间的文件会错误地获胜，而这只有操作者能造成。
- **一份已死的凭据仍读作已认证。** `credentialFileExpiry` 取 access 与 refresh 两个过期时间里较晚的那个，于是一份 access 几天前就过期、refresh 还有几周的凭证，在某一轮真失败之前都报已认证。这里有意不碰：把探针收紧会让一些现在 ready 的 scope 变成 not ready，那是另一个决定。记为观察项。

## Other harnesses

- **codex**：`provisionCodexConfig` 把 `cli_auth_credentials_store = "file"` 钉死，于是只有**一个**存储，宿主与单元经挂载共用它——一条链，没有复活的路，没有分叉。它在 T33e 的失败在宿主轮同样存在，所以不是这个 bug。
- **kimi**：只有文件存储、没有 keychain，同样不分叉。它的 `credential-guard.ts` 会在文件变成空壳时用 `.bak` 还原，因而**可能**重放一个已消费的 refresh token——同一族的问题——但它只在精确的空壳之上还原、绝不覆盖可用文件，且它自己的笔记把损失限定为「再响一次的失败」。记为观察项，不动。
- **dsh**：API key 经环境注入，没有续期流程。不受影响。

## Relation to T33f

T33f 说的是 dsh 两侧共用同一 scope 以及它怎么愈合；它是观察项，本次改动不碰。有一句要说明白：新者胜**有意**不去阻止 claude 两侧共用同一个 scope——它做的是让这种共用活得下来。命名 scope 那个备选会顺带把 claude 的两侧共用也断掉；选了新者胜就意味着 claude 的共用状况与 T33f 为 dsh 描述的完全一致，那边日后定案时，claude 按同样的条款适用。
