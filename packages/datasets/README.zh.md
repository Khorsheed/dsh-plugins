# dsh-datasets

[English](README.md) | 中文

git 仓库之上的通用版本化数据集存储：分层 item、从 git 对象直读的 commit 钉版读取、整层消费的托管 sparse-checkout worktree 视图、以及在所有读取路径上强制层白名单的会话绑定。

本插件存在的理由是文件浏览器没有的三样东西：**语义契约**（descriptor 形状校验、层可见性类别、item 元数据 schema 声明）、**版本固化**（snapshot、git 对象直读、按 commit 去重的托管 worktree）、**访问治理**（会话绑定 + 机制化而非约定化的层白名单）。插件从不解释数据集的语义，也从不把内容复制出仓库。

## 数据集仓库布局

数据集存储就是一个普通 git 仓库。目录结构是约定，层名任意、由 descriptor 声明：

```
<repo>/
  datasets/<dataset-id>/
    dataset.json           # id、name、layers 清单（可见性类别）、item 元数据 schema
    <任意其他文件>          # descriptor 透传——插件原样携带，不读
    items/<item-id>/
      item.json            # item 元数据（字段由声明的 schema 约束）
      <layer>/...          # 任意命名层
```

版本 = git commit。插件只校验 `dataset.json` 的**形状**：`id`、可选 `name`、非空的 `layers` 清单（每项声明 `name`，可声明 `modelFacing: false`，缺省 true）、可选的 `itemMetaSchema` 对象。其余字段原样透传。

`modelFacing: false` 是数据声明，语义仅一条：该层离开本机的导出必须过人工确认闸（确认闸由导出方实现，不属本插件）。它与会话绑定的层白名单是两层独立机制——白名单管「会话里 agent 能看什么」，导出闸管「什么能离开本机」。

内容以仓库内普通文件的方式进入数据集，走正常 git 流程提交；或由 agent 经 `datasets_put_item` 起草进工作树、人评审后提交。没有 import 动词，也没有复制式物化：单文件从 git 对象直读，整层经托管 worktree 消费。

## 安装与加载

本包是 dsh 插件，唯一身份 **`@khorsheed/dsh-datasets`**，在 `dsh-plugins` monorepo（`packages/datasets`）开发并发布到 npm：

```sh
npm install @deepseek-ai/dsh                            # 宿主（dsh web / dsh CLI）
dsh plugin --profile web add @khorsheed/dsh-datasets    # 本插件
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（裸 `datasets` 挂载）调和进 profile 的 bundles 层——不需要手改 cordis.yml。一个 composition 只能挂载 `datasets` 行 id 一次；`dsh --profile web --dump-config | grep datasets` 无输出即说明可以安全 add。

配置（均可选）：`repo`（调用既无显式 `repo` 会话也无绑定时的默认数据集仓库；缺省无）与 `worktreeRoot`（托管 worktree 根覆盖；缺省 `$DSH_HOME/state/datasets/worktrees`，否则 `<cwd>/.dsh-datasets/worktrees`）。

插件提供 `ctx.datasets` 服务供其他插件可选消费，注册七个 `datasets_*` 模型工具和 `/datasets` slash 命令，并（在 composition 挂载 `@khorsheed/dsh-datasets/invariant` 时）于加载期检查托管 worktree 根的结构完整性。

## 会话绑定

每个会话可绑定自己的数据集仓库，存为 log-only session 事件（`datasets/binding`，沿用 `goal/change` 先例）——随会话持久化、可在日志中审计：

```ts
{ repoPath: string, datasets?: string[], layers?: string[] }
```

`datasets` 限定可见的数据集 id；`layers` 是层白名单。缺省字段即「全部」。白名单在**所有**工具读取路径上强制——`list`/`show` 按它过滤，`read` 越界即拒，`worktree_path` 与它求交（交集为空即报错；sparse-checkout 让被拒层目录在 worktree 里物理不存在）。

绑定**写入**是人的操作：会话存活时用 `/datasets bind`，离线时用 `dsh-datasets bind`。agent 工具只解析绑定——agent 能用哪些数据由人决定。带显式 `repo` 参数的工具调用不依赖绑定（绑定存在时白名单仍然生效）；既无显式 repo 又无绑定又无配置默认时，工具明确报错并提示如何绑定。

白名单是会话级约束，不是安全边界：同机的人可改绑定，有 shell 的 agent 可读原仓库。它防的是误取和流程串味，不防恶意。

## 模型工具

| 工具 | 写? | 作用 |
|---|---|---|
| `datasets_list` | | 列绑定范围内的数据集，或某数据集的 item 及元数据 |
| `datasets_show` | | 数据集/item 详情：摘要、descriptor 透传、层文件清单 |
| `datasets_describe` | | 原样透传 `dataset.json` descriptor |
| `datasets_read` | | 读 item 某层某文件，从 pin commit 的 git 对象直读——无拷贝 |
| `datasets_snapshot` | | 固化 `{repoPath, commit, datasetId}`，仓库演进中读稳定版本 |
| `datasets_worktree_path` | 建托管 worktree | 整层只读视图路径（sparse-checkout 限层、按键去重） |
| `datasets_put_item` | 写工作树 | 创建/更新 item 元数据与层文件；`git commit` 留给人 |

`worktree_path` 返回托管根下的普通目录，以 (repo, commit, 排序后 layers) 为键、全机按键共享：`git worktree add --detach <commit>` + 限定层目录的 sparse-checkout + `git worktree lock`。消费方只读挂载或直接读取，绝不修改或删除——它是跨消费方缓存。同键并发创建由托管根下的锁目录串行化，后到者复用建好的 worktree。清理走 CLI 的 `worktree prune`。

## CLI

`dsh-datasets` bin 镜像工具的读取动词（同语义同名参数），另有维护动词。仓库解析：`--repo`，否则 `$DSH_DATASETS_REPO`。退出码：0 成功，1 操作失败，2 用法错误。

```sh
dsh-datasets list [--repo R] [--dataset D] [--commit C]
dsh-datasets show --dataset D [--item I]
dsh-datasets describe --dataset D
dsh-datasets read --dataset D --item I --layer L --path P [--commit C]
dsh-datasets snapshot --dataset D
dsh-datasets worktree path --dataset D [--layers a,b] [--worktree-root DIR]
dsh-datasets worktree prune --repo R [--worktree-root DIR]
dsh-datasets bind --session ID --repo R [--datasets a,b] [--layers x,y] [--sessions-root DIR]
dsh-datasets unbind --session ID [--sessions-root DIR]
dsh-datasets binding --session ID [--sessions-root DIR]
```

`bind`/`unbind` 把绑定事件直接追加到会话的 JSONL 日志（plain 与 zstd 帧两种布局都支持；日志根缺省 `$DSH_HOME/sessions`）。**安全**：向正在运行的实例已打开的会话追加会与后端的内存序号竞争——只绑定未存活的会话；存活路径是 `/datasets bind`。

## Slash 命令

```
/datasets list [dataset]
/datasets show <dataset> [item]
/datasets bind <repoPath> [--datasets a,b] [--layers x,y]
/datasets unbind
```

## Compatibility

- npm release 线（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅——全部能力可用；所依赖的契约面（`ctx.tools`、`ctx.commands`、log-only session 事件）在该线上稳定。
- source 线（deepseek-harness master）：✅。
- ⚠️ 降级（两条线相同）：slash 依赖交互式 UI adapter（web/TUI profile）；headless profile 下 `/datasets` 不可用，模型工具与 CLI 不受影响。

本节与 package.json 的 `dsh.compat` 字段互为镜像，同步更新。

## Known Limitations and Deferred Work

- **descriptor 是 JSON 不是 YAML**——布局约定称之为 `dataset.yml`/`item.yml`，但本包依赖链上没有可用的 YAML 解析器、也刻意不为此加依赖，v1 读 `dataset.json`/`item.json`。未来若引入 YAML 能力可两者兼容。
- **item 元数据不按 `itemMetaSchema` 校验**——schema 仅声明、形状校验为对象并透传；对 item 元数据做完整 JSON-Schema 校验需要引入本包不接受的校验器依赖。
- **会话 tab 属 M2**——基于 `conversation.view` 的浏览 UI（预览复用官方文件阅读器）已完成设计但不在本线；TUI 本来也没有 tab 机制。
- **CLI `bind` 刻意仅离线**——它直接追加会话日志（安全注记见上）；绑定存活会话走 slash 命令。
- **被消费方写脏的 worktree 由 `worktree prune` 重建**——只读契约由消费方的挂载（`:ro`）强制，插件不强制。
- **`worktree prune` 需要 `--repo`**——注册表是 `git worktree list`，按仓库管理；已删除仓库残留的托管根手工清理。
