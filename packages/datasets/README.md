# @khorsheed/dsh-datasets

[English](README.en.md) | 中文

把散在各处的题目整理成带版本、分层可见的题集，评测时 agent 只能拿到你允许它看的那几层。

做评测最怕两件事：题目悄悄变了，前后两轮比的其实不是同一套题；答案或评分标准漏进了选手看得到的地方。这个插件把题集放进普通的 git 仓库：版本就是 commit，一次实验钉住一个 commit；每一层（题面、评分标准、检查脚本……）都声明谁看得到，agent 只能按登记的引用 `<id>/<set>` 读，读不到没被允许的层。接入新数据也不用手写目录结构——告诉 Agent 数据在哪，它整理成协议仓库并提交登记申请，你在题集页上逐题对照后确认。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-panel.png" width="640" alt="全局「题集」面板：按登记仓库分组的题集列表，列出最新版本、题数、agent 可见层与用在哪些实验">

## 特性

- **登记归人，引用归 agent**——题库仓库按部署登记一次，跟踪一条分支；agent 只认 `<id>/<set>` 引用，传路径、名字有歧义或未登记都会得到一句能照着做的拒绝。
- **按层控制可见性**——每层声明是否面向模型，登记时为每个题集勾选 agent 可读的层；白名单同时约束模型工具和只读物化视图。
- **版本钉在 commit 上**——单文件从 git 对象直读，整层经 `git archive` 物化成按内容寻址的只读目录，不碰共享检出的 index、HEAD 或 worktree 列表。
- **让 Agent 整理，你来确认**——「添加题集」新开一个整理会话，Agent 把原始数据整理成协议仓库并提交登记申请；插件逐项核对文件去向与校验结果，只有你按「确认登记」才生效。
- **更新有闸**——跟踪分支前进时，选手看不到的变化自动跟上；选手看得到的变化标「新版本待确认」，确认前 agent 仍读已确认的版本。
- **一眼看清谁看得到什么**——题目详情页并排列出「选手将看到」与「只有判官和探针看得到」两栏，答案漂进可见层会第一时间出现在这里；底部一行说这道题判不判得动。
- **作者卫生与可判性校验**——`validate` 检查 descriptor 形状、rubric 是否可判、客观判据有没有探针、防泄标记是否埋好，警告不阻断。
- **会话 tab 与全局面板**——同一个视图既是评测会话里的「题集」tab，也是左侧栏的全局「题集」面板，不依赖会话。
- **模型工具按 preset 分档授予**——`datasets_*` 工具是包内 `./tool` 组合入口，可选 `read` / `authoring` / `all` / `organize` / `none` 档；另有 `dsh-datasets` CLI 与 `/datasets` 命令。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-item-detail.png" width="640" alt="题目详情页：左边带可见性颜色的文件树，右边并排「选手将看到」与「只有判官和探针看得到」两栏和可判性一行">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-review.png" width="640" alt="「等你确认登记」审阅页：原目录 → 题集的左右对照、各层可见性开关与「确认登记」「退回给 Agent」按钮">

## 安装

推荐随评测模式一起装（题集、容器单元、评测编排器与 local-agent 委派家族，外加评测模式 preset）：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```

也可以单独安装本插件——存储、登记与校验不预设数据集的用途：

```sh
dsh plugin --profile web add @khorsheed/dsh-datasets
```

重启 web 实例后生效。新仓库默认放在 `$DSH_HOME/datasets/<名称>`，登记表在 `$DSH_HOME/state/datasets/registry.json`。要在评测模式以外的 preset 里给模型题集工具，在那个 agent 预设里点名工具行：

```yaml
- id: datasets-tool
  name: '@khorsheed/dsh-datasets/tool'
  config: { tools: authoring }
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-datasets
```

## Compatibility

- npm release 线（`@deepseek-ai/dsh@0.2.0-rc.2`）：✅——全部能力可用；所依赖的契约面（`ctx.tools`、`ctx.commands`、log-only session 事件、Typert Remote 通道、`conversation.view`）在该线上稳定。T82 起只支持宿主 0.2.0 及以后（minHost 0.2.0-rc.2），0.1.x 宿主请停留在旧发布线。
- source 线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1，题集 tab 在 web-eval 临时实例上真机冒烟）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。

降级项与各宿主门的探测细节见[参考文档](docs/reference.md#兼容性细节)。本节与 package.json 的 `dsh.compat` 字段互为镜像，同步更新。

## 已知限制

- **写进工作区的文件提交前看不见**——树、列表与校验都读 HEAD 的 git 对象，所以登记申请要求 Agent 先提交再申请。
- **物化缓存不自动回收**——跟踪分支每前进一次可能多一份只读目录；要回收就删整个 `materialized/` 子树（先 `chmod -R u+w`）。
- **可判性检查只认 `grading` / `verify` 两个层名**——把 rubric 放进别的层名的题库不会被检查。
- **descriptor 读 JSON**——`dataset.json` / `item.json`，不读 YAML；`itemMetaSchema` 只声明、不做完整 JSON-Schema 校验。
- **预览读整个文件**——会话 tab 的预览没有字节上限，超大层文件更适合走物化视图。
- **`/datasets` 需要交互式界面**——headless profile 下不可用，CLI 不受影响。

完整清单见[参考文档](docs/reference.md#已知限制与推迟的工作)。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**存储。** 数据集就是一个普通 git 仓库：`datasets/<id>/dataset.json` 声明层清单（可见性类别）与 item 元数据 schema，层目录可以在题集级或 `items/<item-id>/` 级。插件只校验 descriptor 形状，其余字段原样透传；从不解释数据集的语义，也从不把内容复制出仓库。

**治理。** 登记表是状态根下的一个 JSON 文件，身份是仓库 git common dir 的 realpath；「最新」取跟踪分支，从不看 HEAD。层白名单在列表、读取与物化三条路径上强制；web tab 与 CLI 是人的视图，不受白名单限制，敏感层带「· 敏感」标记。白名单防误取与流程串味，不是安全边界。

**整理与登记。** `datasets_propose_registration` 只写申请；插件对照仓库 git 对象与原目录核对 mapping、跑协议校验，有问题就不能确认。随包分发的 `dataset-authoring` skill 由工具行的 `organize` 档注册。

**接口。** `ctx.datasets` 服务供其他插件可选消费；`datasetsRemote` Typert Remote 是 tab 与面板的数据面；`dsh-datasets` CLI 镜像读取动词并提供登记动词。

深度参考：

- [参考文档](docs/reference.md)——仓库布局与 `validate` 规则表、登记、按实例挂载、模型工具与分档、CLI 与 slash、题集 tab 与面板、兼容性细节、已知限制全文
- [题集作者协议](../../docs/dataset-authoring-protocol.md)

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/datasets`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
