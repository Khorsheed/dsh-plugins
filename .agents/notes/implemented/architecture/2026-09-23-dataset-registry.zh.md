# Agent Note: 题库登记与只读物化

Status: implemented

## Problem

T73 之前，题库仓库经会话绑定到达 agent（`bindings/<session>.json`，由 `/datasets bind`、tab 绑定条或 CLI 写入）。这个形状出了三件事：

- **agent 分不清「找得到」和「可以用」。** 会话没绑定时工具如实回答「让人来绑」；agent 没有停下，而是 glob 磁盘、找到多 agent 共用的题库检出，在别人的分支上写下三份文件。工具每多收一个路径参数，就多一个这样做的理由。
- **「最新」指的是检出的 HEAD。** 共享检出的 HEAD 属于此刻在里面干活的人，于是一次实验读到什么，取决于另一个 agent 切到了哪条分支。
- **物化会写共享状态。** `worktree_path` 在仓库共享的 `.git` 里跑 `git worktree add` + `git worktree lock`：每个整层视图都往别人正在用的检出的 worktree 列表里加一条带锁的记录。dataseek-eval 检出的列表涨到 38 行，其中 25 条是加锁的托管视图。

登记还是部署级的事实，不是会话级的：同一个仓库在每个新会话里重绑一遍，3171 上一个仓库有三条绑定，另有一条指向已不存在的目录。

## Decision

**登记表。** 状态根下一个 JSON 文件 `$DSH_HOME/state/datasets/registry.json`（`packages/datasets/src/registry.ts`），每个仓库一条：`{id, commonDir, trackedRef, registeredAt, registeredCommit, sets: {<set>: {layers}}, authoringCheckout}`。

- 身份是 git common dir 的 realpath，所以一个检出、它的 `.git`、它的 linked worktree 是同一条登记；同一仓库再登记、或 `id` 已被占用，都拒绝（`ALREADY_REGISTERED`）。
- 「最新」是 `git rev-parse <trackedRef>`，从不看 HEAD。分支不存在即拒（`REF_NOT_FOUND`）；tab 保留这条登记并显示那句原因，`datasets_list` 跳过它。`registeredCommit` 只作审计。
- `sets` 只存人选过的；没写的题集什么也不存，读时拿 `modelFacing` 底线，所以登记之后才加到分支上的题集不必重新登记也被覆盖。写一个没声明的层即拒（`LAYER_UNDECLARED`）。
- `authoringCheckout` 是 `datasets_put_item` 唯一会写的树；没有就拒（`NO_AUTHORING_CHECKOUT`）。读取来自跟踪分支的对象，写入进写入检出；提交与合并仍是人的。
- 只有人写登记：tab 的登记表单（路径 + 系统选择器 + 实时预览；每个题集一行层 chip，缺省模型可见层；跟踪分支下拉，缺省 `main`）、一键「从旧绑定登记」、CLI（`register` / `update` / `unregister` / `import-bindings`）。Remote 动词是 `registry`、`previewRepo`、`register`、`updateRegistration`、`unregister`、`importBindings`；每个读取请求用 `repo` 带登记 `id`。

**agent 只认引用。** 每个工具的 `dataset` 参数都是 `<id>/<set>`。三种错法各拒以一句能照着做的话：路径（`PATH_NOT_REF`，路径已登记时点名该用的引用）、有歧义的名字（`AMBIGUOUS_DATASET`，列出候选并要求用 `ask_user_question`）、未登记的仓库或名字（`NOT_REGISTERED`：「is not registered in this deployment … Do not read that directory yourself」）。`datasets_list(query?)` 返回 `{datasets: [{ref, title, trackedRef, latest: {commit, date}, layers}]}`，其中没有任何以 `/` 或 `~/` 开头的字符串。agent 每次读取的层白名单来自登记；operator 视图（tab、CLI）照旧不过滤。

**物化**（`src/materialize.ts`）替换托管 worktree：`git archive <sha> -- <层路径>` 解包进私有暂存目录、去写权限、原子 rename 到 `$DSH_HOME/state/datasets/materialized/<repoKey>/<sha>/<set>/<layers-key>/`。`repoKey` 是 common dir 的哈希，sha 必须是仓库认识的完整 id，每条 pathspec 必须在 `datasets/<set>/` 之内。键完全决定内容，所以目录已在就是缓存命中。返回形状 `{path, commit, layers, reused}` 不变，eval 的 `run.ts` 消费的就是它。

**旧绑定仍可读。** eval 仍经 `DatasetsBindingFace.binding()` 读会话绑定，并经绑定读路径解析仓库；`resolveScope` 里三句「no dataset repository」原样不动。把 eval 迁到引用是 T73 分支 2 的事。所以绑定文件从不自动删除，CLI 保留 `binding` / `unbind`，所有**写**绑定的入口退役：`/datasets bind` 与 CLI `bind` 回答去登记的指引，tab 绑定条与 composer 的 `BindingChip` 删除。`importBindings` 把同一仓库的多条绑定合成一条登记，悬空的标出并跳过，绑定文件逐字节不动。

### 本变更不碰的

- eval 与 eval-tool（分支 2）、SKILL 与 preset（分支 3）、协议文件（rev13 随分支 2），以及题库仓库本身。代码对共享检出只跑 `git show` / `archive` / `rev-parse`：不建 worktree，不动 HEAD。
- **25 条旧托管 worktree 不在本变更里移除。** 移除它们要写共享 `.git`，由人执行[旧托管 worktree 的清理](#旧托管-worktree-的清理)里的命令。

### 旧托管 worktree 的清理

托管视图是路径以 `worktrees/<16 位 hex 仓库键>/<键>` 结尾的那些记录，全部带锁。同一列表里人的 worktree 没有这个形状，不会被匹配。把 `REPO` 设为共享题库检出：

```sh
git -C "$REPO" worktree list --porcelain \
  | awk '/^worktree /{print $2}' \
  | grep -E '/worktrees/[0-9a-f]{16}/[^/]+$' > /tmp/managed-worktrees.txt
wc -l /tmp/managed-worktrees.txt          # 先看一遍名单再往下
while read -r p; do
  git -C "$REPO" worktree unlock "$p" || true
  git -C "$REPO" worktree remove --force "$p" || true
done < /tmp/managed-worktrees.txt
git -C "$REPO" worktree prune
```

之后可以删掉原来存放它们的目录（`$DSH_HOME/state/datasets/worktrees/`、`<cwd>/.dsh-datasets/worktrees/`）；现在没有任何东西读它们。

## Alternatives considered

**保留绑定、收紧 `repo` 参数（T58 的形状）。** T58 已经让 `repo` 只能复述绑定。它没拦住那次事故：拒绝语让 agent 去找人，agent 找到的却是一个目录。只要工具还收路径，agent 就有去找路径的理由。登记引用不指向磁盘上的任何东西。

**从写入检出的 HEAD 解析「最新」。** 更简单，也和人在编辑器里看到的一致。但检出是共享的：它的 HEAD 是另一个 agent 最后切到的分支，实验的输入就取决于谁还在干活。跟踪分支是人在登记时做的声明，要改也是有意去改。

**按人敲的路径做登记键。** 同一仓库的两种写法（检出和 linked worktree、`~` 和它的展开）会变成两条登记、两个 id，去重取决于怎么敲路径。git common dir 是同一仓库所有检出唯一都同意的东西。

**保留托管 worktree，把清理做好。** 问题不在残留，在写：每次 `worktree add` / `lock` 都改共享 `.git`，每个人的 `git worktree list` 里都看得到。`git archive` 只读对象。代价是每个 (commit, set, layers) 一份完整拷贝而不是一个检出；题库层很小，第一次之后都走缓存。

**登记时把缺省层写进每个题集。** 那样登记之后才加到分支上的题集没有条目，还是得另有一条规则。只存人选的、读时套底线，两种情况一条规则。

**导入后删除绑定文件。** 分支 2 落地前 eval 还在读它们，而且绑定文件是「哪个会话用过哪个仓库」的唯一记录。导入对绑定只读，所以可以重跑，删掉登记就能撤回。

**在本分支清理那 25 条托管 worktree。** 那要写其他 agent 此刻正在用的检出的共享 `.git`，文案明确排除了。命令记在这里，由人找个空档执行。

## Consequences

- agent 再也拿不到部署没登记的题库，拒绝语告诉它该做什么：去问人，名字有歧义时经 `ask_user_question`。
- 「最新」不受其他 agent 的检出影响；要移动它，就是有意往跟踪分支上合并。
- 整层视图不再往共享 worktree 列表里加记录。物化缓存不回收：跟踪分支每前进一次可能多一个目录，回收空间就是删 `materialized/` 子树（先 `chmod -R u+w`）。
- 分支 2 之前仓库身份有两个来源：eval 的绑定读路径和登记表。`importBindings` 单向连接二者。
- CLI 的读取动词仍按路径收 `--repo`：那是人的面，登记管的是 agent。
- T73 分支 2 还带一个只读的 `experimentArtifact({experimentId, path})` Remote 动词，用来看分析初稿。它计划在分支 2，本分支没做。
