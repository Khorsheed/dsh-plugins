# 家族 bundle 与集合：细拆映射草案(评审稿)

- 日期:2026-09-24 · 状态:idea(v3 仓主已拍板;v4 标记:波 1 已落地,见「实现记录」)· 官方依赖:纯插件
- 衔接:形态 C 出自 [2026-09-15-host-016-adaptation](2026-09-15-host-016-adaptation.md);首个实例是 `@khorsheed/dsh-presets`(preset-declarations 类元包,已在 3093 验证七模式名册)。

## 背景与判据

rc.1 的插件清单按 bundle 聚合展示(一卡多行、行级开关),官方形态即「bundle 携带多行」。我们的包现有 32 个自挂载 + 5 个库/组合件,裸装进清单是一屏散卡。本提案把包组织成**功能 bundle(细粒度、可交叉标签)**,再按**集合(场景)**对外推广,分层为:

```
package(能力单元)
  → bundle(功能单元,安装/开关单元,携带标签)
  → collection(推广集合 = 镜像仓粒度:全量 / basic / eval / dev)
  → profile(部署形态:web 生产 / headless,profiles/ 只留 web)
  → preset(会话模式,声明跟着能力主人走)
```

判据:社区用户「装一类能力」一条命令;「装一个集合、关掉其中几个 bundle」原生成立(官方 bundle 详情页行级开关);单包永远保持自挂载、可独立安装(仓规不破);行 id 全仓唯一且稳定,挪窝不换 id(会话引用/settings 无损)。

## bundle 细拆映射(草案核心,v2)

家族 bundle 一律薄元包:patch(插成员行)+ npm deps(成员包)+ locale 元数据,无自身逻辑。命名 `@khorsheed/dsh-bundle-<name>`(不用官方 `-profile` 后缀——与部署 profile 撞词)。单能力包不套壳,保持独立卡。

两张表各带「归属集合」列——它只回答「这个卡出现在哪个推广集合/镜像仓」,与「是否套 bundle 壳」无关:**独立卡 = 单包单卡不套壳,照样归属集合**。

### 家族 bundle(9 个 + 已有的 presets)

| bundle | 中文卡名 | 成员包 | 标签(可交叉) | 归属集合 | preset 行 |
|---|---|---|---|---|---|
| bundle-file-preview | 本地文件及预览 | file-preview + ui-file-preview + local-files | 文件·预览 | basic, dev | — |
| bundle-worktrees | 工作树 | worktrees + worktrees-tool | 开发·git | dev | — |
| bundle-room | 多Agent协同 | room + room-tool | 协作·多Agent | dev | — |
| bundle-local-agent | 本地多Agent(v4 定稿卡名) | local-agent + kimi/codex/claude-code/dsh(tool-subagent、headless 隐形随附) | 委派·多Agent | dev | — |
| bundle-eval | 评测 | eval + eval-tool + lab | 评测 | eval | **preset-dsh-eval 挪入**(行 id 不变,会话无感) |
| bundle-datasets | 数据集 | datasets + datasets-tool | 数据·评测 | eval | — |
| bundle-mission | 任务规划 | mission + mission-tool | 任务·评测 | eval | — |
| bundle-typesafe | 快速决策 | typesafe + typesafe-tool | 裁决·评测·开发 | eval, dev | — |
| bundle-conversation-toolbox | 会话工具箱 | message-tools + message-timeline + session-title-edit + quote + inline-html-render + context-guard + taskpilot | 会话体验 | basic | — |

波 1 落地状态(v4):`bundle-local-agent`、`bundle-conversation-toolbox` 与闸门 sanction(`dsh.bundle.kind: 'family'`)**已落地**(commit 为引入本行标记的提交自身,hash 以 git 历史为准);其余 7 个 bundle 保持待办(波 2)。
| dsh-presets(已存在) | 预设模式 | presets | 模式 | basic, eval, dev | preset-dev / preset-dsh-writing |

### 独立卡(9 张,不套壳)

| 卡 | 中文名 | 标签 | 归属集合 |
|---|---|---|---|
| ankh-guard | 重启守卫 | 运维 | dev, 全量 |
| capability-catalog | 能力目录 | 观测 | basic, eval, dev |
| canvas | 灵感画布 | 内容 | basic |
| capture | 渲染抓取 | 开发·网页 | dev |
| dsh-reader | 灵感空间 | 内容 | basic |
| mobile | 移动端 | 移动 | 全量 |
| sidechat | 侧边对话 | 会话体验·协作 | basic |
| ui-shortcuts | 快捷键 | 会话体验 | basic |
| whalesong | 进度提醒 | 品牌 | 全量 |

库(无卡,作依赖随包走):local-agent-dsh-headless、local-agent-tool-subagent、ui-content-preview。**无卡是合法且与官方同构的形态**(rc.1 实测:官方区只策展 6 卡,几十个官方包隐形;我们 deps-only 的工具包与传递依赖库在清单页均不出现;禁用/卸载粒度是 bundle 卡,库随使用方存亡)。家族 bundle 化后,成员包成传递依赖、独立卡消失,收进 bundle 卡详情页的组件行(行级开关,官方智能体团队同款形态)。

**预览内核共享 ≠ bundle 依赖**:local-files / worktrees / ui-file-preview 的预览区渲染的是同一份实现——它们各自在**源码面**内联 ui-content-preview 内核、独立构建、独立可装,运行时不互相依赖。所以 local-files 并进「本地文件及预览」后,工作树 bundle 对该 bundle **没有**任何依赖;感知上的「像一套」来自内核同源,用户侧无感,单侧安装永远成立。

归属说明:quote 的「引用到侧边对话」动作依赖 sidechat 的服务,分卡后按探测降级处理(只装一边时另一边功能收窄不报错);会话工具箱按仓主意见由「消息体验」扩编改名而来(收 quote / 内联卡片 / 上下文守卫 / 后台任务);lab 主要搭配评测使用,入 bundle-eval;卡名以仓主定稿为准(多Agent协同 / 快速决策 / 进度提醒)。集合间允许重叠(同一 bundle 可被多个集合引用;typesafe 跨 eval/dev)。重合发生在能力增强面(探测降级),不发生在组合行(划分唯一)——已核查 eval 家族对 localAgent 为运行时探测降级、对 room 零引用。

## 标签机制

标签是**目录层**数据,不进安装面:npm `keywords` + catalog source JSON(后跟 DSH Desktop Market 源格式)+ 主仓 README 索引表。标签轴(功能域)与集合轴(场景)**正交不一致**——一致会把两轴绑死,交叉消失。标签词表初稿:预览 / 文件 / 开发 / git / 协作 / 多Agent / 委派 / 评测 / 数据 / 任务 / 裁决 / 会话体验 / 模式 / 运维 / 观测 / 内容 / 移动 / 品牌。

## 集合与镜像仓

- 主仓 dsh-plugins 唯一事实源,全量发布 npm。
- 镜像到**集合粒度**:`dsh-basic`(已有,改造)、`dsh-web-eval`、`dsh-web-dev`(新开)。主仓 push main 后 action 只读同步;镜像仓 = 集合门面(定制 README + 成员目录快照),不追求独立可构建(安装走 npm),issue 指回主仓。**例外:dsh-ankh-guard 保留单包镜像**(仓主判断这个插件社区单独有需要)——同步 action 多一条单包规则,其余单插件仓不再维护(archive + 指向主仓/npm,或直接删除,仓主已授权)。
- 集合一键安装:先走「一行命令装 N 个 bundle」+ catalog 分组(PerryLink dsh-kit 形态);集合元包(patch 由构建期从成员 bundle patch 合并生成)作为波 3 候选,不阻塞前两波。

## 实施波次

1. **波 1(形态验证)**:check-plugin-independence 扩展 sanction 词表 `dsh.bundle.kind: 'family'`(参照 preset-declarations 先例)+ 样例 bundle-local-agent、bundle-conversation-toolbox(原「bundle-messages」,按 v3 归属说明的定稿名)+ 3093 验收(卡面分组、行开关、成员独立安装不破)。**已落地(v4)**:sanction 与两个样例元包入库(commit 即引入「实现记录」本条的提交);3093 验收不在本次范围,待另行安排。
2. **波 2(全量)**:全部 bundle 落地 + preset-dsh-eval 挪入 bundle-eval + npm 发布 + 3080 profile 换引元包(deploy:3080)+ profiles/basic|web-dev|web-eval 退役拆解(模式已归 preset,包集已归 bundle)。
3. **波 3(发现层)**:catalog source + 镜像同步 action + 集合安装命令。

## 开放问题(评审点)

1. bundle 命名后缀 `-bundle` 确认(或另选)。
2. 集合归属的边角:whalesong 仅全量、mobile 仅全量、ankh-guard 入 dev、lab 入 eval——可调。
3. 3080 自身 = 全量集合 + 运维卡(ankh-guard),不变。
4. 现有单插件仓的处置列表(archive 或删除)待仓主定夺。

## 实现记录

- **波 1 已落地**(2026-09-24,worktree 分支 `feat/host-016-adaptation`;commit 为引入本条的提交自身,hash 以 `git log` 本文件为准):
  - 闸门 sanction:`scripts/check-plugin-independence.ts` 的 `BUNDLE_KINDS` 收入 `dsh.bundle.kind: 'family'`。校验口径:patch 行只允许落在「成员规范行全集」白名单(id+name 逐字匹配成员自己 patch 的顶层行;bare override 的 id 同理)、members 必须是真实存在的自挂载包且逐员进 `dependencies` + `dsh.references`、每个成员至少贡献一行、bundle 自身零注册(无 `dsh.client`、src 无服务/工具/槽位/命令注册与 apply 入口);row-id 台账与 patch row ownership 两条跨包规则对「成员规范行」放开。spec 补正反用例(真实树重跑 0 findings)。
  - 样例元包:`packages/bundle-local-agent`(@khorsheed/dsh-bundle-local-agent,卡名「本地多Agent」)与 `packages/bundle-conversation-toolbox`(@khorsheed/dsh-bundle-conversation-toolbox,卡名「会话工具箱」),形态照 dsh-presets 薄元包样板。
  - Agent Note:`.agents/notes/implemented/architecture/2026-09-24-family-bundle-meta-packages.md`(含 zh 对照与 sidecar)。
  - 不在本次范围:装进任何 profile、3093 验收、npm 发布。其余 7 个 bundle 保持待办(波 2)。
