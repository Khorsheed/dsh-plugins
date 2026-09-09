# Agent Note：claude keychain 同步镜像 token 非空的条目，绝不再取首个命中的空壳

状态：已实现

[English](2026-09-09-claude-keychain-empty-shell-first-match.md) | 中文

## 问题

`syncClaudeCredentialFile` 用 `security find-generic-password -s <service> -w` 读 macOS keychain——不带 `-a`。macOS 允许同一 service 下存在多条记录，`-w` 返回第一条。一台评测机上 `Claude Code-credentials-<hash>` 下有两条：`acct=unknown`（accessToken/refreshToken 均为空串、`expiresAt: 0`，早期 claude 的历史残留）和 `acct=<用户名>`（刚完成的 `claude login` 写入的真凭证）。同步把空壳写进了 `<home>/.credentials.json`——而那正是 CLI 运行时真正读的文件。

故障形状代价很高：login 成功、status 报已认证（形状检查通过），而每一次委派都报 `OAuth session expired and could not be refreshed`——与授权真的过期逐字相同。排除了白名单代理、容器网络、`.claude.json` 缺失、refresh token 轮换四条假设之后，把三个来源的 token 各做一次 sha256 才发现它们都等于空串的哈希。删掉空壳条目后，同一份代码立刻工作。与 pilot A 的 G4 是同一个教训——**形状对不等于能用**——只是这一次发生在流水线更早的一步。

## 决策

- **枚举，绝不信任首个命中。** `keychainItems` 解析 `security dump-keychain` 的元数据（该输出不含密钥），取该 service 下全部账号，按 `mdat` 新到旧排序；`readKeychainCredential` 取第一条 token 记录非空的。可用性压过新旧：本次事故里的空壳恰恰是**较新**的那条写入。
- **token 非空是镜像的门槛。** `credentialUsable` 要求 `claudeAiOauth` 下 `accessToken` 或 `refreshToken` 非空。遗留的无 `-a` 读取保留为枚举本身不可用时的兜底（非 macOS、dump 失败），同样过这道门槛。
- **全为空 → 返回 false 并自愈。** 不写任何内容；且若 credentials 文件里已经躺着空 token 空壳——正是本 bug 的残骸——则**删除**它，让运行时说 "Not logged in" 而不是误导性的 "OAuth session expired"。带真 token 的文件保留（keychain 可能只是暂时不可读）。
- **`readCredentialExpiry` 读同一条可用凭证**，status 探测与同步不会再对"哪条记录存在"各执一词。

## 验证

`packages/local-agent-claude-code/tests/records.spec.ts`——keychain 套件现在 stub `dump-keychain` + 按账号读取：

- 空壳（较新写入）+ 真条目 + 一条无关 service 的记录 → 镜像真 blob，返回 true；
- 两条都可用 → 较新的写入胜出；
- 全为空 → false、不写文件、已镜像的空壳被删除、探测读作未认证；
- keychain 无可用但文件带真 token → false、文件保留；
- 既有 fixture 补上了 token，因为无 token 的 blob 按定义不再可镜像。

`pnpm --filter @khorsheed/dsh-local-agent-claude-code build` + `test`：13 个文件、131 个测试，全绿。

## 备选方案

**按 `mdat` 排序、不问内容直接取最新。** 否决：事故里的空壳恰恰是较新的写入——只看新旧照样镜像它。新旧只在多条可用记录之间决胜。

**直接删除 keychain 里的空壳条目。** 否决：keychain 是 CLI 自己的存储、与其共享；我们只读，不替它清理。空壳只要永不被镜像就无害，而从别的进程拥有的存储里删条目可能破坏我们看不到的流程。

**照旧镜像首个命中，但加一条警告日志。** 否决：文件是运行时真正读的东西。被警告过的空壳照样让每次委派失败，且报错与真的过期无法区分——日志解不了投毒。

## 后果

- 已被空壳投毒的作用域 home 在下一次同步（login watch 或委派 spawn）时自愈——不再需要手工 keychain 手术。
- 只有一条真条目的机器行为与之前完全一致（枚举只找到一个账号；dump 多出的那次子进程只在探测/spawn 时运行）。
- 无 `-a` 的首个命中读取仅作为非 macOS 兜底存在，且即使在那里空壳也会被拒绝而不是被镜像。
