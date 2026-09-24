# 家族 bundle 与集合：细拆映射草案(评审稿)

- 日期:2026-09-24 · 状态:idea(待评审)· 官方依赖:纯插件
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

## bundle 细拆映射(草案核心)

家族 bundle 一律薄元包:patch(插成员行)+ npm deps(成员包)+ locale 元数据,无自身逻辑。命名 `@khorsheed/dsh-bundle-<name>`(不用官方 `-profile` 后缀——与部署 profile 撞词)。单能力包不套壳,保持独立卡。

| bundle / 独立卡 | 中文卡名 | 成员包 | 标签(可交叉) | 归属集合 | preset 行 |
|---|---|---|---|---|---|
| bundle-file-preview | 文件预览 | file-preview + ui-file-preview | 预览·文件 | basic, dev | — |
| bundle-worktrees | 工作树 | worktrees + worktrees-tool | 开发·git | dev | — |
| bundle-room | Room | room + room-tool | 协作·多Agent | dev | — |
| bundle-local-agent | 本地代理 | local-agent + kimi/codex/claude-code/dsh(tool-subagent、headless 隐形随附) | 委派·多Agent | dev | — |
| bundle-eval | 评测 | eval + eval-tool | 评测 | eval | **preset-dsh-eval 挪入**(行 id 不变,会话无感) |
| bundle-datasets | 数据集 | datasets + datasets-tool | 数据·评测 | eval | — |
| bundle-mission | 任务规划 | mission + mission-tool | 任务·评测 | eval | — |
| bundle-typesafe | TypeSafe 裁决 | typesafe + typesafe-tool | 裁决·评测·开发 | eval, dev | — |
| bundle-messages | 消息体验 | message-tools + message-timeline + session-title-edit | 会话体验 | basic | — |
| bundle-sidechat | 侧边对话 | sidechat + quote | 会话体验·协作 | basic | — |
| dsh-presets(已存在) | 预设模式 | presets | 模式 | basic, eval, dev | preset-dev / preset-dsh-writing |
| 独立卡 ankh-guard | 重启守卫 | — | 运维 | dev, 全量 | — |
| 独立卡 capability-catalog | 能力目录 | — | 观测 | basic, eval, dev | — |
| 独立卡 canvas | 灵感画布 | — | 内容 | basic | — |
| 独立卡 capture | 渲染抓取 | — | 开发·网页 | dev | — |
| 独立卡 context-guard | 上下文守卫 | — | 会话体验 | basic | — |
| 独立卡 dsh-reader | 灵感空间 | — | 内容 | basic | — |
| 独立卡 inline-html-render | 内联卡片 | — | 预览 | basic | — |
| 独立卡 lab | 实验单元 | — | 评测 | eval | — |
| 独立卡 local-files | 文件列表 | — | 文件 | basic | — |
| 独立卡 mobile | 移动端 | — | 移动 | 全量 | — |
| 独立卡 taskpilot | 后台任务 | — | 观测·任务 | basic, dev | — |
| 独立卡 ui-shortcuts | 快捷键 | — | 会话体验 | basic | — |
| 独立卡 whalesong | Whalesong | — | 品牌 | 全量 | — |

库(无卡,作依赖随包走):local-agent-dsh-headless、local-agent-tool-subagent、ui-content-preview。

集合间允许重叠(同一 bundle 可被多个集合引用;worktrees 在 dev,typesafe 跨 eval/dev)。重合发生在能力增强面(探测降级),不发生在组合行(划分唯一)——已核查 eval 家族对 localAgent 为运行时探测降级、对 room 零引用。

## 标签机制

标签是**目录层**数据,不进安装面:npm `keywords` + catalog source JSON(后跟 DSH Desktop Market 源格式)+ 主仓 README 索引表。标签轴(功能域)与集合轴(场景)**正交不一致**——一致会把两轴绑死,交叉消失。标签词表初稿:预览 / 文件 / 开发 / git / 协作 / 多Agent / 委派 / 评测 / 数据 / 任务 / 裁决 / 会话体验 / 模式 / 运维 / 观测 / 内容 / 移动 / 品牌。

## 集合与镜像仓

- 主仓 dsh-plugins 唯一事实源,全量发布 npm。
- 镜像只到**集合粒度**:`dsh-web-basic`(已有,改造)、`dsh-web-eval`、`dsh-web-dev`(新开)。主仓 push main 后 action 只读同步;镜像仓 = 集合门面(定制 README + 成员目录快照),不追求独立可构建(安装走 npm),issue 指回主仓。
- 单插件仓(如 dsh-ankh-guard)不再维护:archive + README 指向主仓/npm,或直接删除(仓主已授权)。重要插件的单独介绍门面 = npm README + 主仓索引 + 将来的 docs 站。
- 集合一键安装:先走「一行命令装 N 个 bundle」+ catalog 分组(PerryLink dsh-kit 形态);集合元包(patch 由构建期从成员 bundle patch 合并生成)作为波 3 候选,不阻塞前两波。

## 实施波次

1. **波 1(形态验证)**:check-plugin-independence 扩展 sanction 词表 `dsh.bundle.kind: 'family'`(参照 preset-declarations 先例)+ 样例 bundle-local-agent、bundle-messages + 3093 验收(卡面分组、行开关、成员独立安装不破)。
2. **波 2(全量)**:全部 bundle 落地 + preset-dsh-eval 挪入 bundle-eval + npm 发布 + 3080 profile 换引元包(deploy:3080)+ profiles/web-basic|web-dev|web-eval 退役拆解(模式已归 preset,包集已归 bundle)。
3. **波 3(发现层)**:catalog source + 镜像同步 action + 集合安装命令。

## 开放问题(评审点)

1. bundle 命名后缀 `-bundle` 确认(或另选)。
2. 集合归属的边角:whalesong 仅全量、mobile 仅全量、ankh-guard 入 dev、lab 入 eval——可调。
3. 3080 自身 = 全量集合 + 运维卡(ankh-guard),不变。
4. 现有单插件仓的处置列表(archive 或删除)待仓主定夺。

## 实现记录

(待波 1 开工后登记 Agent Note / 提交)
