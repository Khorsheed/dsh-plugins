# Agent Note: 镜像同步只推 git 跟踪的文件

Status: implemented

## Problem

独立镜像仓是**公开**的，monorepo 不是。`scripts/sync-mirror.mts` 靠遍历产物目录的磁盘内容来决定拷什么（`readdirSync` + 递归 `cpSync`），只减掉一个三条目的 skip 集。于是任何恰好躺在该目录里的 gitignore 文件都会进入公开仓库：构建 tarball（`*.tgz`）、`*.tsbuildinfo`、`*.log`，以及调试截图。

仓库的 hygiene 门禁覆盖不到这条路径。`check-repo-hygiene` 扫的是 git 的视角——暂存集，或全部被跟踪的文件——所以一个被 gitignore 的文件既对门禁不可见，又具备被发布的资格。两套机制对「什么算在仓库里」的理解不一致。

不是假设：`packages/ankh-guard/khorsheed-dsh-ankh-guard-0.1.2.tgz`（未跟踪，被 `*.tgz` 忽略）就躺在 `Khorsheed/dsh-ankh-guard` 的待同步集里，`packages/file-preview/` 下还有第二个。

## Decision

`mirrorFiles(kind, name)` 用 `git ls-files` 列出 `<kind>s/<name>` 下的文件，去掉产物前缀，再丢弃顶层条目落在该 kind skip 集里的路径。同步严格按这份清单拷贝，沿途创建父目录。未跟踪的文件不再需要 skip 条目——选择器根本看不见它们。

随之加了两道保险：

- **空清单即中止。** 否则「往清空后的镜像里拷了零个文件」会被当成一次成功同步。
- **push 模式拒绝脏的产物目录。** 内容读自工作区，而同步提交记的是 `sync from dsh-plugins @ <sha>`；工作区脏了，这句话就是假的。`--check` 与 `--dry-run` 仍照常跑——检视未提交的改动正是它们的用途。

脚本导出 `main(argv)`，只有当自己是入口模块时才自调用。两个按 kind 的薄包装（`sync-profile-mirror.mts`、`sync-ankh-guard-mirror.mts`）改为用组装好的 argv 调 `main()`，不再改写 `process.argv` 再重新 import；这也正是 `scripts/sync-mirror.spec.ts` 能 import `mirrorFiles` 而不触发 clone 的原因。

## Alternatives considered

**把 gitignore 的模式教给 skip 集。** 保留磁盘遍历，逐条列举不许外泄的东西。因其失败模式被否决：新增一条忽略模式后会一直泄漏，直到有人注意到某次公开提交。「只推被跟踪的」把方向反过来——失败模式变成镜像里*少*一个文件，响亮且在 `--check` 的 diff 里当场可见。整合包模板当初选「显式拷贝白名单」而非「全拷减排除」，用的是同一条理由。

**改从 `git archive HEAD` 拷。** 内容天然等于所记的 sha，也就不需要脏检查了。否决理由是它会静默丢弃工作区的改动：编辑后未提交就同步，会报「already up to date」，同时推的是上一版内容。显式拒绝把问题说出来，而不是藏起来。

**保留磁盘遍历，把 hygiene 扩到未跟踪文件。** 否决：hygiene 的契约就是 git 的视角，扫全树会在每次提交时对每个开发者的本地临时状态报警——一个总在狼来了的门禁会被绕过。

## Consequences

- 一个文件要进公开镜像，必须先被 git 跟踪，也就必然已经过了 hygiene 门禁。两套机制现在共用同一个「在仓库里」的定义。
- 同步前必须先提交。这与既有的发布纪律一致（`docs/publishing.md`：发布源只认仓库）。
- skip 集里的 `node_modules` / `lib` 现在是冗余的——那些路径本就未跟踪。保留它们作为意图声明；真正起作用的只有 `tests`（skill 的 e2e 装置）。
- 强制添加的截图（`git add -f` 越过图片 gitignore）照常跨过去：它们是被跟踪的，而这正是镜像需要的那条分界。

## Testing

`scripts/sync-mirror.spec.ts` 与其他门禁 spec 一样对真实文件树运行，直接锁住这条边界——每个产出路径都必须被跟踪（`git ls-files --error-unmatch`），`lib/`、`node_modules/`、`*.tgz` 永不出现，skill 的 `tests/` 留在家里，`profiles/basic` 强制添加的截图仍然发得出去。一旦退回磁盘遍历，第一条断言立刻失败，因为 `lib/` 未被跟踪。
