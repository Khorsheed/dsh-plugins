# Agent Note: web-eval 安装路径——模板保留 npm 范围，源码模式改写安装副本

Status: implemented

[English](2026-09-04-web-eval-install-source-mode.md) | 中文

## Problem

按 web-eval 自己的模板安装 profile（I1 走通；题库 i1-walk 日志的 G5/G6）在两处失败。其一，模板 package.json 以 npm 范围引用全部 22 个成员，其中 12 个未上架——README 只警告了 `datasets` / `mission` / `lab` 与本地 Agent 家族，而 `capability-catalog`、`inline-html-render`、`local-files` 其实也未发布（release-status.md 一直是权威）——`pnpm install` 撞 registry 404。其二，即便 tarball 正确，pack-dist 会把被打包包的 `workspace:*` 家族边改写成 `^version` registry 范围（kimi/codex/claude-code → local-agent + tool-subagent；local-agent-dsh → headless），同样 404。T1 只能全程手工：构建、打 13 个 tarball、改清单、写 pnpm overrides——而 deploy-3080 为 prod 自动化的正是这套流程。dev 模板同病；本笔记与改动只覆盖 web-eval。

## Decision

模板 package.json 保留 npm 范围：它是 I6 交付物的声明，且绝不引用一个不存在的文件。`install.sh` 增加源码模式（`--source <dsh-plugins 检出>`）：在检出内构建全部未上架成员（逐包 `pnpm --filter <name> build`，`GEN_TYPERT_ONLY` 限定到该集合——deploy-3080 的做法，邻居的在制品不会拖死安装），用 `pack-dist --family` 逐个打 tarball 进安装后 profile 的 `tarballs/`，改写**安装副本**的清单（未上架的直接依赖 → `file:tarballs/…`，相对 profile 目录），追加 pnpm `overrides:` 块钉住全部未上架名字——包括 `@khorsheed/dsh-local-agent-dsh-headless`（profile 从不直接依赖它，它是 local-agent-dsh 自带的依赖）——然后走标准 `dsh plugin --profile web-eval install`。npm 模式（无参数）不变：同样的拷贝与安装，最后一个成员上架当天即可用，模板零改动。

`--family` 的每个成员都写成 `name=version`。pack-dist 给家族清单边定范围时用的是**目标包自己的版本**，所以光写名字只做改写，一旦这个名字落在某条依赖边上就是错误而不是一个悄悄解析不出来的范围——安装脚本原来拼的光名字打到 `local-agent-tool-subagent` 就停住（`peerDependencies entry @khorsheed/dsh-local-agent is a family edge but no version was given for it`）。install.sh 先把检出的 `packages/*/package.json` 扫成一张「包名 → 自身版本」表，打包循环里逐个成员查表；检出里查不到版本的保持光名字并打一行 warn——只需要改写的成员本就不必带版本，而它若真带着一条边，pack-dist 仍会当场报错。

未上架集合在 install.sh 里是一份显式目录清单，按拓扑序排列（local-agent → tool-subagent → headless → providers → 独立包；集合内没有任何成员依赖已上架的 @khorsheed 兄弟——已上架成员因此可以继续走 npm），并声明以 release-status.md 为权威：成员上架，它的目录就从清单移除。

headless 的处理让 G3 在这条路径上不会发生：宿主的 reconcilePlugins 只遍历 profile 清单的直接依赖，headless 只以 override 钉住的传递依赖进入（prod 模式——3080 profile 的 package.json 同样没有 headless 行），因此永远不会被追加进 `dsh.profile.bundles`。T6 修 reconcile 本身。

## Alternatives considered

- **模板 package.json 里放 `file:` tarball 占位**（任务书的另一选项）——否决：克隆里被引用的 tarball 不存在，npm 模式会以费解的 ENOENT（而非诚实的 404）失败；占位文件名必须与源码模式打包的版本严格同步（或者反正要被改写——占位就失去了唯一作用）；而且 I6 仍要改模板。npm 范围模板 + 安装时改写到达同样的安装终态，零悬挂引用、零 I6 改动。
- **安装时探测 registry 推导未上架集合**——否决：逐成员网络探测让安装器又慢又怕代理抖动，还会静默打包一个漂移的子集；固定清单确定、自说明，并在 I6 被有意清空。
- **让 pack-dist 产出 `file:` 家族边**（G6 的替代设想「pack-dist 支持 family 重写为 file:」）——否决：scripts/ 是 mainline 的共享层；安装器侧 override 是 deploy-3080 已验证的模式，而把安装器路径烘进发布产物会让 tarball 泄漏机器布局到 npm 消费者手里。
- **tarball 放 `$DSH_HOME/tarballs/`（prod 布局）**——否决：prod 维护一个统一 prune 的 tarball 池，因为 deploy-3080 反复部署同一个共享 profile；评测 home 是一次性的，profile 内的 `tarballs/` 让「卸载 = 一条 `rm -rf`」保持成立，同时留在任何 pnpm workspace 之外（ops.md 的规则——dsh-plugins 检出内的 tarball 会被 pnpm 按名+版本匹配转成 link:）。

## Consequences

- 全新评测实例重新变成一条命令：`install.sh --source <检出>` 一路到底（T5 验收——mktemp 的 `$DSH_HOME`，`--dump-config` 去重后 22 个 `@khorsheed` 成员），T1 手工做同样的事花了约 20 分钟。
- 安装后的 profile 自洽：引用的每个 spec 都在盘上，tarball 随 profile 目录一起消亡。
- `update.sh` 会冲掉源码模式安装（把清单覆盖回 npm 范围）——README 已警告，I6 前用重跑源码模式代替。
- 未上架清单是成员发布状态的第二个存放处（release-status.md 之外）；脚本内注释点名了权威与退役条件，但两次 release:status 之间可能漂移——接受，与它镜像的 deploy-3080 流程同 stance。
- npm 模式的收尾行现在在总行数旁打印 `@khorsheed` 成员数（README 的不变量）；安装语义本身未动。

## Related

- [web-eval 迭代文档](../../../../profiles/web-eval/docs/iterations.md)——T5 任务书与验收线。
- 题库仓库 i1-walk 分支的走通日志，缺口 G5/G6——本笔记关闭的现场观察。
