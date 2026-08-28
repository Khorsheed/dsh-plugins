# Agent Note: Product roadmap inserts a feature layer between base and domain

Status: implemented

[English](2026-08-28-roadmap-feature-layer.md) | 中文

## Problem

21 个在册提案、23 个包，却没有一份上位文档说明某个能力属于哪一层、什么时候做。每个提案各自划定范围，于是「这个包服务 eval 还是 dev」只能逐提案回答，答案彼此不一致。

[package-management](../../../../proposals/active/2026-08-21-package-management.md) 的分类是三层——`base` / `domain` / `ops`，主标签唯一、边界包取基础层。这条规则把一批包放错了位置：local-agent 家族、`mission`、`lab`、`datasets`、`worktrees`、`room`。它们需要外部依赖（PATH 上的 CLI、docker daemon、文件系统约定），所以不是「装上界面就更好用」的体验包；而每一个都被不止一个 workflow 消费，所以没有单一 domain 拥有它们。把 `mission` 归 `base`，等于把一台任务状态机塞进承诺「更好的聊天界面」的整合包；归 `domain`，则被迫在 eval 与 dev 之间做一个假选择。

## Decision

`docs/roadmap.md` 是上位文档：提案说明一个能力怎么建，路线图说明它落在哪一层、被哪个 domain 消费、什么时候做。它包含包账本（每个包的版本、发布状态、一句话能力、相关提案）、一份约束未来提案的决策清单，以及优先级表。

包分类变为四层。`feature` 位于 `base` 与 `domain` 之间。判据只有一句——**每个 domain 都装吗？** base 是，feature 否。一个交叉验证：feature 包通常引入一个新的工作对象（mission 的「工作项」、lab 的「实验单元」、worktrees 的「worktree / 分支 / diff」），用户与 agent 都得学；base 改善的是 dsh 本来就有的东西（消息、文件、任务、上下文），不引入新词汇。`domain` 退化为纯组合：`base` 加若干 feature，至多再加一两个 UI 包，因此新增一个 domain 不产生新代码。`ops` 不变。

层归属看的是**这个包要不要装**，不看**它显示什么**。`capability-catalog` 每个 domain 都装，而它列出的工具与 skill 随 preset 变化——镜子每个房间都挂，照出来的东西各不相同。`worktrees` 显示的内容同样随仓库变，它却属于 `feature`，因为写小说的人根本没有理由装它。

两层的生命周期预期不同，并由此决定投入多少。`base` 是替尚不够好的官方 GUI 补课，因此刻意做薄：官方补上后，AGENTS.md 的 Compatibility labeling 本就要求退役该降级路径，提案按「官方吸收」关闭。`feature` 是上游不会做的领域能力——没有别人会去写 mission、lab 或 room——值得深耕。

domain 落在两个平面而非一个。profile 平面承载插件集合；capability 包按需挂载、探测不到对端即静默降级，因此全装无代价。agent preset 平面承载该 domain 的视图——工具子集、prompt sections、skills 与 persona——由官方 `agent-presets` 包按会话从一个装有单份 `agent.cordis.yml` 的目录组合而成。因此 domain 包交付两个半边：一个 `bundles` 层，以及一个由其 `cordis.yml` 用 `roots` 指向的 `presets/` 目录。同一个实例由此可以并存开发会话与评测会话，无需重启。

工作方式的表述按性质分流到这两个平面加第三个：通用实践属于 preset 的 prompt section，某个仓库自身的纪律留在该项目的 `AGENTS.md`，跨项目的个人偏好留在 `$DSH_HOME/AGENTS.md`。三者叠加，互不替代。「不感知某项能力」不需要任何屏蔽机制——未挂载 `worktrees` 的 preset 就没有 worktree 的 prompt section，模型从不见到它。

命名三个 domain：`dev`（日常在用的软件工作台）、`eval`（harness 对比）、`novel`。`dsh-dev` 首发。两个已具备条件的 domain 相交于 local-agent 家族与 `mission`，因此发布阻塞点是这个交集，而不是其中任一 domain。

路线图同时记录八条约束未来提案的既定决策，其中包括：dsh 是唯一工作台外壳、AgentOS 冻结为设计资产；本地与远程是 local-agent 家族的一个执行目标维度，而非两套工作台；多人协作的上限是每人一实例加共享数据面，因为 harness 的信任模型把任何连上的调用方视同本机用户；判定不进插件，`lab` / `mission` / `datasets` 只记录事实、不给分。

## Alternatives considered

**层名叫 `capability`。** 使用后否决：该词在本生态已有三重占用——上游的 capability seams、本仓的 `capability-catalog` 包，以及「插件提供的能力」这一日常用法。层名与三者相撞，会让每一句用到它的话都产生歧义。

**维持三层，把共享包归入 `base`。** 否决：`dsh-web-basic` 就是基础整合包，把 local-agent 家族加进去意味着入门整合包要求安装外部 CLI 并逐个登录。基础层的承诺和能力层的承诺，对用户是两种不同的承诺。

**维持三层，只在文档里把 `base` 内部分组。** 否决：分类的用途正是让 domain 包据以组装。只活在 README 里的分组，仍然要求组装者逐包挑选，而那正是分类本该消除的工作。

**不设上位文档，让每个提案各自划定范围。** 否决：这正是产生冲突的现状。21 个提案已经在「`mission` 服务 eval 还是 dev」上彼此不一致，且无人仲裁。

**domain 只做成 profile。** 否决：切换 domain 将意味着重启实例，而同一台机器日常同时承担开发与评测两类工作。

**domain 只做成 preset**，把全部插件装进单一 profile。以「不充分」而非「错误」否决：preset 组合的是会话所见，但 profile 中不存在的插件根本无从组合，因此仍需 profile 平面决定「存在什么」。

**先出 `dsh-eval`**，即 package-management 原定计划。搁置而非否决：eval 的价值要等一轮对比跑完才兑现，而 dev 是已经在日常使用的形态、反馈立即回流。这个选择不改变关键路径——共享的 capability 层同时阻塞两者——所以它是排序偏好，不是结构判断。

## Consequences

domain 包不产生新代码，因此第四个 domain 只是一次组装练习。[mode-switcher](../../../../proposals/active/2026-08-26-mode-switcher.md) 由此获得确切含义：mode 就是 domain 的 UI 表达。

package-management 的分类落点小节现已过时，需要为 `dsh.category` 增加 `capability` 取值；路线图头部登记了这个联动，提案本身尚未修改。`dsh-web-basic` 当前包含 `ankh-guard` 这个 `ops` 包，四层模型让这一矛盾显形；路线图把它挂为待决而非就地解决，因为改动已发布整合包的成员清单有真实代价。

路线图需要维护：新提案在包账本补一行，发布状态变化时更新标记。preset 的分发是新工作：profile 模板形态在 `dsh-web-basic` 已有先例，分发 preset 则没有，因此 `dsh-dev` 从一个最小 preset（工具子集加一段 prompt section）起步以跑通链路。两条官方约束限定其上的任何交互：会话只能在零产出时切换 preset，因此 mode 是新建会话时的选择而非会话内开关；子 agent 加入父级的组合，因此被委派的子会话与父会话同 preset。`capability-catalog` 按 agent preset 的 standing scope 读取注册表，因而正是「某个 domain 有哪些工具与 skill」的可见面。

preset 平面只承载 tools、prompt sections 与 skills；声明 `dsh.client` 的浏览器 UI 包挂在 profile 的 client 槽位上、为所有 domain 共享——这正是基础层之所以「基础」的原因。base 的十一个包里只有两个带 agent 侧成分：`inline-html-render` 注册拉取式的 `inline-html-card` skill，`capability-catalog` 注册 `list_capabilities`，因此 `daily` preset 即官方 `standard` 加这两样。由于 preset 的 skill 集合会改变 agent 的能力，评测必须钉住 preset，条件才可比。

优先级的日常变动记在路线图里，不回写本文件；本文件只拥有分类决策本身。两个提案（`capability-catalog`、`mode-switcher`）在主工作树尚未提交，因此路线图引用它们时不建链接，待其进入 main 后补上。
