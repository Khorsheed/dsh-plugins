# Agent Note: pack-dist 删掉 devDependencies；workspace:* 与 workspace:^ 同样改写

Status: implemented

## Problem

web-eval profile 的源码模式安装（`profiles/web-eval/scripts/install.sh --source`）在 `main` 上失败。e9110d52 把 `"@khorsheed/dsh-client-ui-content-preview": "workspace:*"` 加进了 local-files、ui-file-preview、worktrees 的 devDependencies。两处缺口在这里碰上：install.sh 只从 dependencies 与 peerDependencies 算每个包的 `--family`，这个兄弟包不在族里；`rescopePackageJson` 只改写 `workspace:^`，于是非同族的 `workspace:*` devDependency 原样到了 `pnpm pack`，报 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`。两位实施者（T73 分支 1、T72）各自撞上、各自本地绕过，都没提交。

## Decision

- `rescopePackageJson` 从 dist manifest 里删掉 `devDependencies`。发布的 tarball 只被安装、从不被构建，这一段没有消费者；删掉它消除的是整类失败，而不是其中一种写法。
- 非同族的 `workspace:*` 与 `workspace:^` 一样改写成源码版本的 caret，适用于 peerDependencies，以及 dependencies 里经 `dsh.runtimeDependencies` 保留的条目。同族边本来就按目标版本定 range，不变。
- `verifyTarball` 多收一个 `devDeclared` 参数：源 manifest 的 devDependencies 名（映射到 dist 名）。构建时内联的源码平面兄弟包仍然只以 devDependency 声明，产出的 `.d.ts` 仍会提到它；少了这个参数，字段离开 dist manifest 后校验器会拒掉这类包。
- install.sh 的 `members` 也算上 devDependencies 里的 `@khorsheed/` 名，让 pack-dist 拿到它们的改名与版本。

## Testing

`scripts/pack-dist.spec.ts`：一个 rescope 用例（带 `workspace:*` 的 devDependencies 被删；同族依赖、runtime 保留的依赖、非同族 peer 里的 `workspace:*` 都被改写；不剩任何 `workspace:`）和一个真实打包用例（devDependencies 带 `workspace:*` 的包能 pack；tarball manifest 没有 devDependencies；同族依赖按目标版本定 range）。

install.sh 没有测试，2026-09-23 实测记录：在修复 commit 上开 detached worktree，`CI=true pnpm install --frozen-lockfile --prefer-offline`，再把 rc.1 工具链的 `dsh` 放进 PATH，跑 `DSH_HOME=<realpath mktemp -d> sh profiles/web-eval/scripts/install.sh --source <该 worktree> --fresh`。退出码 0（24 个 `@khorsheed` 成员，177 条 patch 行）；日志有 `packing @khorsheed/dsh-local-files@0.1.0-rc.1 (family @khorsheed/dsh-client-ui-content-preview=0.1.0)`，`tarballs/khorsheed-dsh-local-files-0.1.0-rc.1.tgz` 存在，其 manifest 没有 devDependencies、没有 `workspace:` range。没有起实例；临时 home 与 worktree 已删除。

## Alternatives considered

**只修 install.sh。** 把 dev 兄弟包作为族成员传进去，今天这三个包能 pack，但下一个不在族里的 `workspace:*`——不论在哪一段——照样失败；pack-dist 的其他调用方（deploy-3080 的 `--family auto` 恰好算了 devDependencies，手写的 `--family` 不会）也还留着这个坑。

**继续改写 devDependencies 而不删。** 保留一个没人读的字段，还要为一段只会导致 pack 失败的内容维护改写规则。

**删掉 devDependencies 且校验器也不再算它。** 源码平面库包会过不了自己的校验，因为产出的声明文件提到了内联的兄弟包。

## Consequences

dist manifest 更小，不再宣告只在构建时用到的兄弟包。校验器的“已声明”现在来自两处（staging 的 manifest 与调用方传入的源 devDependencies），直接调用 `verifyTarball` 的一方要自己提供后者。本次改动时 `docs/packages.md` 在 `main` 上已因 canvas 0.4.7 过期，不在本改动范围内。
