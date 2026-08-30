# 产品路线图：分层、domain 与优先级

本文件是**上位文档**：单个 proposal 回答「这个能力怎么做」，本文件回答「它属于哪一层、服务哪个 domain、什么时候做」。新 proposal 立项前先在这里找到落点；找不到落点说明要么该改本文件，要么该重新想那个能力。

- **最后更新**：2026-08-28
- **联动**：本文件把 [package-management](../proposals/active/2026-08-21-package-management.md) 的三层分类（`base` / `domain` / `ops`）扩为四层，插入 `capability`。该提案的分类落点小节需同步。

## 一、产品定位

一个可自定义的 agent 工作台，把**派谁干、干什么、在哪干、干得怎么样**四件事统一在一个界面里，本地与远程同构。

```
能力闭环（四动词）          访问维度（通道，不是能力）
  派谁干   local-agent 家族      多端   mobile-access
  干什么   mission + room        多人   每人一实例 + 共享数据面
  在哪干   workspace + lab + 远程执行
  干得怎样 datasets + lab
```

**能力闭环没闭合前，访问维度不是重点**——这是分主次的第一原则。

## 二、分层模型（四层）

| 层 | 判据 | 存在理由 | 理想终局 |
|---|---|---|---|
| `base` | **每个 domain 都有** | 官方 GUI 还不够好，我们补缺 | **官方补上即退役** |
| `feature` | **某些 domain 特有** | 特定 workflow 的领域能力 | 官方不会做，长期存在 |
| `domain` | 把 base + 若干 feature 组装成一个 workflow，**几乎无新代码** | 让一套 workflow 一条命令装齐 | 随 workflow 存续 |
| `ops` | 自托管、守卫 | 自托管部署的运维需要 | 随部署形态存续 |

判据就是「每个 domain 都装吗」这一句，可直接判。一个可选的交叉验证：feature 通常**引入新的工作对象**（mission 的「工作项」、lab 的「实验单元」、worktrees 的「worktree / 分支 / diff」），用户和 agent 都得学；base 改善的是 dsh 本来就有的东西（消息、文件、任务、上下文），不引入新词汇。

**层归属看的是「这个包要不要装」，不看「它显示什么」。** `capability-catalog` 每个 domain 都装，但它显示的工具与 skill 随 preset 变——内容会变不改变它属于 base。它是面镜子：镜子每个房间都挂，照出来的东西不同。`taskpilot`、`file-preview` 同理。反过来 `worktrees` 显示的 git 状态也随仓库变，它归 feature 的原因不是内容会变，而是**写小说的人根本不需要装它**。

**两层的生命周期预期不同，直接影响投入。** base 是替官方补课，因此**不该过度投资**——够用即可，官方补上就按 [AGENTS.md 的 Compatibility labeling](../AGENTS.md) 退役该路径，提案按「官方吸收」转 `closed`。feature 是自己的领域资产，官方不会替你做 mission / lab / room，值得深耕。

`feature` 层独立的理由：local-agent 家族、mission、lab 这批包不是每个 domain 都要（写小说不需要委派编码 CLI，也不需要实验单元），塞进 base 会让基础整合包变重；但它们也不专属某个 domain（mission 归 eval 还是 dev？两边都要）。强行按「主标签唯一」归类会产生归属冲突。

名字取 `feature` 而非 `capability`，是因为后者在 dsh 语境里已被占用三处：官方的 capability seams、本仓的 `capability-catalog` 包、以及泛指插件能力的日常用法。

四层的收益：**domain 包退化成纯组合**，出一个新 domain 不写新代码，只是「base 全体 + 挑几个 feature + 可能一两个专属 UI 包」。

`package.json` 的 `dsh.category` 增加 `feature` 取值；`domain` 包继续用 `dsh.domain` 备注（`dev` / `eval` / `novel`）。

## 三、domain 清单

domain 是 **workflow 的组装单位**，运行时就是**一个 profile**；切换工作模式即切 profile（见下）。UI 形态见 [mode-switcher](../proposals/active/2026-08-26-mode-switcher.md)。内部术语统一用 `domain`，不再与「mode」混用。

| domain | 组成 | 状态 |
|---|---|---|
| **`daily`** 日常 | base 全体 | 即现有 `dsh-web-basic` profile。preset 用官方 `standard` 即可——base 的 skill 与 tool 落在 global 层，本就全局可见 |
| **`dev`** 开发工作台 | base + local-agent + worktrees + mission + room | **首发目标**。日常管理 catmem 这类项目的形态 |
| `eval` 评测对比 | base + local-agent + mission + datasets + lab | 组成初稿见 package-management |
| `novel` 小说创作 | base + ? | 未展开 |

两个 domain 的交集是 **local-agent + mission**——它们是共同前置。**feature 层不收口，任何 domain 包都发不出去。**

### 切换工作模式 = 切 profile + 守卫重启

一个 domain 就是**一个 profile**。切换工作模式的动作是：`ankh-guard restart` 换到另一个 profile，同端口交接，浏览器刷新原地址。

```sh
# 形态即 dsh-web-basic 的 restart-into-web-basic.sh 那一行
ankh-guard restart --port 3080 \
  --start "DSH_HOME=… dsh --profile dsh-dev --port 3080 --no-open" \
  --profile dsh-dev --state-dir "$DSH_HOME/state"
```

**这个动作有安全网**，六道闸里 preflight 那道是关键：切换前在子进程里把新组合完整 boot 一遍再 dispose，**组合起不来就绝不停当前实例**——切不过去就还留在原模式。watchdog 托管新实例、起不来自动回滚到最后已知可用版本、canary 复检。

为什么不用 agent preset 承载 domain：

| | profile 切换 | preset 切换 |
|---|---|---|
| UI 与工具是否一致 | **完全一致**——novel 模式下就没有 mission tab | 不一致——client UI 挂在 profile 层全局可见，工具按 preset 隔离，「看得见用不了」 |
| feature 包由谁挂载 | profile 说了算，不用拆行 | 要把包拆成 host/client 两行才能隔离 |
| 会话零产出约束 | 无 | 有——聊过就不能换 |
| 代价 | 重启几秒 + 刷新 | 无重启 |

用几秒重启换掉那一堆不对称和约束，划算。

**唯一代价是整个实例只能在一个模式**——不能一边开发一边跑评测。解法是评测用独立实例：

```
主实例   :3080  在 daily / dev / novel 之间切 profile
评测实例 :3082  常驻 eval profile，独立 $DSH_HOME
```

这对评测反而更好：环境隔离本就是评测的基本要求，与开发共享实例会引入干扰变量。`~/.dsh-acceptance`(3082) 的形态已经在用。

### preset 的定位：同一 profile 内的 agent 变体

官方自带的四个 preset——`standard`（完整编码 agent）、`minimal`（双工具）、`ptc`（PTC 模式 SDK）、`cordis`（含 preset 创作指导）——**全是同一套插件下的 agent 变体，不是不同 workflow**。preset 该用在这个粒度上。

| 层次 | 换什么 | 机制 | 频率 |
|---|---|---|---|
| **工作模式**（domain） | 插件组合，UI + 工具全换 | profile 切换 + 守卫重启 | 低频，换活儿时 |
| **agent 变体** | 同一组合下的工具子集 / prompt section / persona | preset 选择（新建会话时） | 高频，开会话时 |

例：`dsh-dev` profile 下可有 `standard`（写代码）与 `review`（只读审查、不挂写工具）两个 preset。

两条官方硬约束仍然适用于 preset 这一层：**会话只能在零产出时切 preset**；**子 agent 继承父的组合**，委派出去的子会话与父同 preset。

### 注册的层次：global 层与 preset 层

skill 与 tool 的注册表是 **host + per-scope 分层**的（官方 `dsh-skill` README）：profile 的 bundles 层挂载的插件，其注册落在 **global 层，所有 preset 可见**；由某个 preset 的 standing composition 挂载的插件，落在**该 preset 的层**。读取时合并 global 层与当前 scope 链。

推论：**profile 挂载的东西挑不掉**。这正是 domain 隔离必须走 profile 而非 preset 的技术原因——把 mission 挂在 profile 上，同 profile 的所有 preset 都能用它；要让某个 workflow 没有它，只能不把它放进那个 profile。

domain 整合包的目录形状：

```
dsh-dev/
├─ package.json              成员插件为直接依赖
├─ cordis.yml                dsh.profile.bundles 层（base + 该 domain 的 feature）
│                            + agent-presets 的 roots 指向 ./presets
└─ presets/
   ├─ standard/agent.cordis.yml   该 domain 的默认 agent
   └─ review/agent.cordis.yml     （可选）同 domain 的其他变体
```

`roots` 接受任意路径（官方配置示例即 `~/company-presets`），所以整合包自带 preset 无需上游 seam。

## 四、包账本

状态标记：✅ 已上架 npm ｜ 🔶 rc，功能通未发布 ｜ 🌿 分支未合流 ｜ ⬜ 未开工

### base — 每个 domain 都有

| 包 | 版本 | 状态 | 功能 | 相关 proposal |
|---|---|---|---|---|
| `message-tools` | 0.1.0 | ✅ | 消息编辑 / 真撤回 / 恢复重放（唯一改变模型所见的 base 包） | [withdraw-file-rollback](../proposals/active/2026-08-21-withdraw-file-rollback.md) `planned` |
| `message-timeline` | 0.1.0 | ✅ | 会话左缘悬浮历史消息时间轴，点击跳转 | — |
| `session-title-edit` | 0.1.0 | ✅ | 标题内联编辑重命名，用户来源标题被钉住 | — |
| `file-preview` | 0.1.1 | ✅ | 宿主侧只读文件预览 Remote 服务（列表 + 内容 + diff） | — |
| `ui-file-preview` | 0.1.0 | ✅ | 「产物」tab、回合变更卡片、预览抽屉 | [file-view-html-rendering](../proposals/active/2026-08-21-file-view-html-rendering.md) `planned`<br>[local-files-browser](../proposals/closed/2026-08-26-local-files-browser.md) `planned` |
| `taskpilot` | 0.1.0 | ✅ | 后台任务 / 子 Agent 胶囊，停止中断 + 详情抽屉 | — |
| `whalesong` | 0.1.0 | ✅ | 任务氛围：鲸鱼喷水、favicon 动画、完成提示音 | — |
| `ui-shortcuts` | 0.1.0 | ✅ | 可自定义键位的快捷键 | — |
| `context-guard` | 0.1.0 | ✅ | 上下文占用越阈值时出现压缩按钮 | [context-clearing](../proposals/active/2026-08-19-context-clearing.md) `idea` |
| `inline-html-render` | 0.1.11 | 🔶 | `dsh-card` fenced block → 沙箱 iframe，对话内可交互卡片。**注册 `inline-html-card` skill（拉取式）**；随 profile 挂载即落 global 层，所有 preset 可见 | — |
| `local-files` | 0.1.0 | 🔶 | 独立工作区 tab：懒加载文件树 + 结构化 HTML/Markdown/JSON/CSV/图片预览，git 无关，按会话记忆根目录（从 worktrees 拆出，提交 `3df3044`） | [local-files-browser](../proposals/closed/2026-08-26-local-files-browser.md) `done` |
| `capability-catalog` | 0.1.30 | 🔶 | 技能与工具目录、来源归属、装技能、`list_capabilities` 工具。按 **agent preset 的 standing scope** 读注册表，因而是 domain/preset 模型的展示面——不同 mode 下有哪些工具与 skill，在这里可见 | [capability-catalog](../proposals/active/2026-08-26-capability-catalog.md) `in-progress` |

### feature — 某些 domain 特有

| 包 | 版本 | 状态 | 功能 | 相关 proposal |
|---|---|---|---|---|
| `local-agent` | 0.1.0-rc.6 | 🔶 | 家族核心：harness registry、作用域 home、登录/会话命令族、委派门面 `ctx.localAgent` | [delegation-api](../proposals/active/2026-08-18-local-agent-delegation-api.md) `planned`<br>[member-channel](../proposals/active/2026-08-19-local-agent-member-channel.md) `planned` ← **卡发布**<br>[member-state](../proposals/active/2026-08-22-local-agent-member-state.md) `planned` |
| `local-agent-kimi` | 0.1.0-rc.6 | 🔶 | Kimi Code harness：`kimi -p` 委派、续聊、记账 | — |
| `local-agent-codex` | 0.1.0-rc.6 | 🔶 | Codex harness：`codex exec` 委派 | — |
| `local-agent-claude-code` | 0.1.0-rc.5 | 🔶 | Claude Code harness：`claude -p` 委派 | — |
| `local-agent-dsh` | 0.1.0-rc.6 | 🔶 | 委派给 dsh 自己（独立 CLI 进程） | [dsh-sdk-resume](../proposals/active/2026-08-27-local-agent-dsh-sdk-resume.md) `planned` |
| `local-agent-dsh-headless` | 0.1.0-rc.6 | 🔶 | 子 dsh 运行器，随父 provider 自动 provision | 同上 |
| `local-agent-tool-subagent` | 0.1.0-rc.6 | 🔶 | 家族委派工具，带 `resume` 续聊参数 | — |
| `mission` | 0.1.0-rc.1 | 🔶 | 工作项 + 冻结状态机 + 三种 guard + 五桶投影 + attempt/checkpoint + bundle 导出 + web tab | [mission-tasks](../proposals/active/2026-08-19-mission-tasks.md) `in-progress` |
| `datasets` | 0.1.0-rc.1 | 🔶 | git 之上的版本化数据集：commit 钉版直读、sparse-checkout worktree、层白名单会话绑定 | [datasets-store](../proposals/active/2026-08-19-datasets-store.md) `in-progress`<br>[dataset-authoring-protocol-skill](../proposals/active/2026-08-23-dataset-authoring-protocol-skill.md) `planned` |
| `lab` | 0.1.0-rc.1 | 🔶 | 受控实验单元（docker）：环境指纹、物化清单、checkpoint/verify/archive、release gate | [lab-experiment-units](../proposals/active/2026-08-19-lab-experiment-units.md) `in-progress` |
| `worktrees` | 0.1.0-rc.9 | 🔶 | 会话 repo/worktree 徽标 + 改动抽屉（未提交/已提交/仓库全量） | [worktree-governance](../proposals/active/2026-08-23-worktree-governance.md) `in-progress` |
| `room` | — | 🌿 | 多 agent 房间：成员 tab、邀请、@ 分发、多成员胶囊、任务板、通知闸门 | [room-session-promotion](../proposals/active/2026-08-27-room-session-promotion.md) `planned` |

### domain — workflow 组装

| 整合包 | 状态 | 组成 |
|---|---|---|
| `dsh-web-basic` | ✅ 10 成员已发 npm 0.1.0 | base 全体 + `ankh-guard`（见「待决」）|
| `dsh-dev` | ⬜ | **首发目标**：base + local-agent 家族 + worktrees + mission + room |
| `dsh-eval` | ⬜ | base + local-agent 家族 + mission + datasets + lab |
| `dsh-novel` | ⬜ | 未展开 |

### ops — 自托管运维

| 包 | 版本 | 状态 | 功能 | 相关 proposal |
|---|---|---|---|---|
| `ankh-guard` | 0.1.1 | ✅ | 自修改重启的安全门禁：绿色凭证 + preflight + watchdog 回滚 | — |
| ~~`plugin-manager`~~ | — | — | 已废除：模式切换改走守卫重启、不需要行开关，官方 0.1.2 已覆盖查看需求 | [plugin-manager](../proposals/closed/2026-08-22-plugin-manager.md) `closed（放弃）` |

### 跨层 / 分发基建

| proposal | 状态 | 作用 |
|---|---|---|
| [package-management](../proposals/active/2026-08-21-package-management.md) | `planned` | 分类 → 整合包组合 → 发布流程的可执行链路。**本文件的四层需同步进去** |
| [upstream-meta-pack-reconcile](../proposals/active/2026-08-21-upstream-meta-pack-reconcile.md) | `planned` | 薄元包一键装全家（形态 C），需上游 seam |
| [mode-switcher](../proposals/active/2026-08-26-mode-switcher.md) | `idea` | 模式切换入口：`ankh-guard restart` 换 profile。回到 profile 层，但机制是守卫重启而非行 overlay |
| [mobile-access](../proposals/active/2026-08-19-mobile-access.md) | `planned` | 访问维度。**前提已失效需重写**（见决策 8） |

## 五、已定决策（proposal 的边界条件）

1. **dsh 是唯一工作台外壳。** AgentOS（dpsk-game）冻结为设计资产，有价值的能力以插件形态择优重做，不搬 Go 代码。
2. **本地与远程不是两套工作台**，而是 local-agent 家族的一个执行目标维度（本地进程 / 远端 dsh / lab 容器 / e2b）。
3. **多人协作的上限是「每人一实例 + 共享数据面」。** dsh 的信任模型是「能连上 = 等同本机用户」（`session.create` 故意不在特权方法内），单实例多租户做不到，除非改官方代码。
4. **编排半自动**：agent 拿 mission 工具派工，人在 `tools/pre-execute` 审批层卡点，**不新建编排组件**。注意 `mission_attest` 本身是模型工具，真正的把关在工具审批层而非状态机层。
5. **判定不进插件**：lab / mission / datasets 守住「只记录不判断」，分析在 export bundle 之外做（notebook / 脚本）。
6. **对比先测原生组合**（自家 harness × 自家模型），析因设计留后。结论绑定组合、不可迁移，写进 `methodology.md`。
7. **live 通道留在家族自有 wire**，官方 SDK 只承接 one-shot / resume——v0.1.2-alpha.1 仍无 mid-turn cancel（`sdk/client/README.md` 明列为已知限制）。
8. **上游 0.1.2 新增浏览器 token 认证**（`client/connection/src/browser-auth.ts`）：launch token → 签名 cookie，取代了原先的 `PRIVILEGED_METHODS` loopback 分层。mobile-access 提案里「进程内认证无 seam」的前提已失效。但 cookie 不带 `Secure`、`--host 0.0.0.0` 仍不支持，**TLS 前置仍是硬要求**。

9. **一个 domain = 一个 profile，切换靠 `ankh-guard` 守卫重启**（preflight 起不来就不切 → watchdog 托管 → canary 复检）。不用 agent preset 承载 domain：client UI 挂在 profile 层无法按 preset 隔离，会造成「看得见用不了」。代价是整个实例只能在一个模式，评测因此用独立实例（:3082 常驻 eval profile，独立 `$DSH_HOME`）——环境隔离本就是评测的要求。
10. **preset 用于同一 profile 内的 agent 变体**（`standard` / `review` 之类），不是 workflow 载体——官方自带的四个 preset 就是这个粒度。工作方式的表述按性质分流：通用实践进 preset 的 prompt section，项目纪律留在项目 `AGENTS.md`，跨项目个人偏好留在 `$DSH_HOME/AGENTS.md`。

## 六、优先级

| 阶段 | 动作 | 解锁 |
|---|---|---|
| **P0** | feature 层收口：local-agent 第二波发布、mission / worktrees 转正式版 | 一切 domain 包 |
| **P1** | 首发 `dsh-dev`（形态 B：profile 目录模板） | 验证「base + feature 组装成 workflow」形态成立 |
| **P1** | room 归队 | `dsh-dev` 的协作面（增强，非前提） |
| **P1** | `eval` pilot：1 维度 × 4 原生组合 × 3 重复 | 验证 bundle 能否支撑可发布结论 |
| **P2** | 出 `dsh-eval`；mobile-access 重写并落地 | 访问维度 |
| **P3** | 多人协作（每人一实例 + 共享数据面） | — |

执行层面的清单见[本期迭代](#七本期迭代两个整合包上-github)——那里是唯一维护的一份，本节只排长期次序。

## 七、本期迭代：两个整合包上 GitHub

**目标**：`dsh-web-basic` 更新、`dsh-web-dev` 新建，两者都上 GitHub，并由我们自己充分测试。**本期不发 npm**——推社区是下一期的事。

**形态**：沿用 `dsh-web-basic` 的形态 B（profile 目录模板 + `install.sh` + 守卫重启脚本）。尚未上 npm 的成员按 dsh-plugins README 现有做法处理：README 标注「从源码安装」，本地用 tarball 装配。

三条线可并行：**A 轻、先跑通流程为 B 探路**；**B 是主体**；**C 是前置修复，不阻塞 A/B 的文件工作**。

### A 线：镜像化 + dsh-web-basic 更新

整合包源迁进 monorepo 的 `profiles/` 目录，用同步脚本推镜像仓——**monorepo 是单一事实源，镜像仓是「clone 即装」的门面**。web-basic 这次正好要加成员，当第一个验证案例。

> **定位**：整合包 = **一个可分发的 profile**（不是「插件集合」）。`dsh-plugins/profiles/web-basic/` 对应用户机器上的 `~/.dsh/profiles/web-basic/`——同名是对应关系而非撞车。由此得到三个原生语义：
>
> - **自由装卸载是官方动词**：`dsh --profile web-basic plugin rm @khorsheed/dsh-taskpilot` 即卸载。不需要自造开关（`plugin-manager` 因此废得更彻底），且是宿主背书的方式。
> - **会话跨 profile 共享**：会话存 `$DSH_HOME/sessions/`，home 级、不属任何 profile。在纯净 `web` 与 `web-basic` 之间切换，历史会话都在。
> - **与官方方向一致**：0.1.2 把 Python SDK / ACP 等启动模式都收敛到 `dsh --profile`，profile 是官方押注的分发单元。

| # | 事项 | 依赖 | 验收 |
|---|---|---|---|
| A1 | **`capability-catalog` 功能冻结**：停止高频迭代、定下版本线 | — | 版本号一个工作日内不变 |
| A2 | 建 `profiles/web-basic/`：**拉平结构**——仓库根即 profile（`package.json` / `cordis.patch.yml` / `pnpm-*.yaml`）+ `scripts/` + 双语 README + CHANGELOG + `docs/screenshots/` | — | monorepo 的 `packages/*` 够不着它，workspace 不吸收 |
| A3 | **逐字节搬**现有 README 双指南与 restart 脚本 | A2 | 与镜像仓 diff 为空——**不许动行为**：watchdog 交接、`$DSH_SESSION_ID` 寻址、不硬编码 `--initiator` 都是事故换来的。（`install.sh` 的 `SRC` 一行属路径适配，已批准） |
| A3b | **拷贝语义改显式白名单**：`cp package.json cordis.patch.yml pnpm-workspace.yaml pnpm-lock.yaml presets/ …`，新增模板文件必须显式加入 | A3 | **不是「全拷减排除」**——结构拉平后配套与 profile 文件同居，全拷的失败模式是新文件无声泄进用户 `$DSH_HOME`；白名单的失败模式是不生效、当场被 `--dump-config` 行数抓到。选响亮的 |
| A3c | `.gitignore` 截图例外注释扩成「`docs/screenshots/` 与 `profiles/*/docs/screenshots/`」 | A2 | 整合包截图同样 `git add -f` |
| A4 | 补 `README.i18n.yaml` sidecar | A3 | 配对门禁认得它 |
| A5 | 扩翻译配对 glob 到 `{packages,profiles,.agents}` | A4 | 门禁扫得到 profiles/ |
| A6 | 写 `scripts/sync-profile-mirror.mts`（照 `sync-ankh-guard-mirror.mts` 改） | A2 | 镜像仓根即 profile——clone 后 `pnpm install` 直接可跑。只拷整合包自身文件 + 它自己的 `docs/screenshots/`，不拖 monorepo 的 `docs/` |
| A7 | **同步脚本加 `--check` 模式并进 CI** | A6 | 镜像落后于 monorepo 即红——防「单一事实源」漂成两个真相 |
| A8 | 加两个成员（capability-catalog、inline-html-render），版本 bump 走 **minor** | A1·A2 | `--dump-config` 行数 +2 |
| A9 | **模板保持最小**：只含 `package.json` + bundles 清单 + lockfile；用户个性化引导到 `cordis.patch.yml` 的 user 层（官方分层天然支持） | A2 | 模板里没有用户会改的东西 |
| A10 | **ship `pnpm-lock.yaml`** | A9 | profile 是应用不是库——可复现安装优先于依赖新鲜度 |
| A11 | **`install.sh` 升级路径**：已装过旧版的实例能升级（三路合并或明确的覆盖策略，二选一并写明） | A8·A9 | 现在是「目录已存在就报错退出」，无升级路径 |
| A12 | A11 的验收步骤（测试或手写清单） | A11 | 全新安装、旧实例升级两条路径都过 |
| A13 | 全新 `$DSH_HOME` 装一遍 | A8·A11 | 一次通过 |
| A14 | **agent 照指南装**：把 README 那句话原样发给一个 agent，看它能否独立装成 | A13 | **README 的终极验证**——指南是写给 agent 读的，读完做不对就是指南的 bug。隔离环境跑，不碰 3080 |
| A15 | **自由装卸载实测**：每个成员 `dsh --profile web-basic plugin rm <pkg>` → 重启 → 功能消失且其余不受影响 → `plugin add` 回来恢复 | A13 | 兑现「卸载即精确还原」的承诺；这是 README 的卖点，写进去就得验 |
| A16 | 同步推镜像仓 | A6·A14·A15 | 镜像仓 clone 能照 README 装上 |

### B 线：dsh-web-dev 新建

成员清单以**「已合 main 且 3080 验收过」**为准，在途包不写进整合包。截至 2026-08-30，3080 上 21 个成员均已就位（`room` 08-29 18:55 上线，观察期刚起算）。

| # | 事项 | 依赖 | 验收 |
|---|---|---|---|
| B1 | 确认成员清单与各包版本线 | A 线机制就位 | 每包一个确定版本，无在途包 |
| B2 | 建 `profiles/web-dev/`：`package.json` + `cordis.patch.yml` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` | B1·A2 | 自带 hoisted linker |
| B3 | `dsh.profile.bundles` 挂 base + dev 的 feature | B2 | `--dump-config` 组合完整 |
| B4 | **写 `presets/standard/agent.cordis.yml`** | B3 | 本仓首次分发 preset，无先例 |
| B5 | 写 `scripts/install.sh`（复用 A11 的升级策略） | B2·A11 | 全新与升级两条路径 |
| B6 | 写 `scripts/restart-into-web-dev.sh` | B5 | 同端口交接成功 |
| B7 | 写双语 README + sidecar + CHANGELOG | B4·B6 | 门禁绿 |
| B8 | 全新 `$DSH_HOME` 装一遍 | B5 | 一次通过 |
| B9 | **五条切换判据实测** | B6·B8 | 见下 |
| B10 | 借 **3091 alpha 实例**做 0.1.2 线的首版验证 | B8 | 与 3080 线结果对照 |
| B11 | agent 照指南装（同 A14） | B8 | 隔离环境 |
| B12 | 自由装卸载实测（同 A15，22 个成员） | B8 | 抽样人工验界面，其余自动跑启动检查 |
| B13 | 建镜像仓并首次同步 | B7·B9·B11·B12·A6 | clone 能照 README 装上 |

#### A14 / A15 的做法

- **隔离环境**：独立 `$DSH_HOME` + 独立端口，绝不碰 3080。3082（acceptance）或 3091（alpha）都可以。
- **A14 用谁来测**：把 README 那句话发给 claude-code 或 codex——正好用工作台自己的委派能力测自己的安装指南。判据是**不需要人补充信息**：agent 中途来问「装哪个目录 / 端口是多少」，就说明指南缺了那一条。
- **A15 的分层**：12 个成员全部跑 `plugin rm` + 启动检查（可脚本化，快）；界面消失与恢复抽样人工验（慢，选 message-tools / ui-file-preview / taskpilot 这类有明显界面的）。

### C 线：前置修复（可并行，不阻塞 A/B 的文件工作）

| # | 事项 | 为什么要做 | 阻塞谁 |
|---|---|---|---|
| ~~C1~~ | ~~`room` 推上 3080~~ | **已完成**：2026-08-29 18:55 部署，分支已合并删除 | — |
| C2 | 确认迁移验收三步：会话里列出 skill 并**真调用一次** / `check-env --port 3080` 读数 / 门禁重启 canary PASS | ops.md 要求，从未确认执行过 | 下一期 npm 发布 |
| C3 | 重新生成 `release-status.md`（`pnpm release:status`） | 现版本 08-23 生成，缺 5 个包 | 下一期 |
| C4 | 各包 `Compatibility` 段 + `dsh.compat` 对齐 0.1.2 宿主线 | AGENTS.md 要求；0.1.2 适配分支待命中 | B10 |
| C5 | README 截图回填（各包占位注释） | ops.md「验收即截图」 | 下一期 |

### 观察期实况（2026-08-30）

3080 上 21 个成员。**重新部署会重置计时**，因此各包观察期不同步：

| 包 | 最近部署 | 三天期满 |
|---|---|---|
| `local-agent` / `-kimi` | 08-29 18:47 | 09-01 18:47 |
| `room` | 08-29 18:55 | 09-01 18:55 |
| `ankh-guard` | 08-29 15:14 | 09-01 15:14 |
| `capability-catalog` | 08-29 14:46 | 09-01 14:46（且需先冻结，见 A1） |
| `worktrees` / `file-preview` / `inline-html-render` | 08-28 | 08-31 |

本期不发 npm，所以观察期不阻塞 A/B——它是下一期的入场券。

### 本期不做

- **npm 发布**（13 个包 × 3 天观察期，下一期）
- **`mode-switcher` 插件**（本期切换用脚本，UI 入口是后续提案）
- **`dsh-eval` 整合包**（datasets / lab 不进 dev domain）
- **room-session-promotion 的 M2 及以后**（M1 已随 room 进 main）

### 已完成（本期开始前）

- local-agent 家族六包在 3080 运行（2026-08-27 14:40 部署），观察期已跑满三天
- member-channel M1–M3 四 provider 全通；room 已合并进 main 并落地 session-promotion M1
- 提案总账对齐实现记录；`closed` 理由格式固化

## 八、待决

- **`dsh-web-basic` 含 `ankh-guard`（ops 层）**是历史组成。四层模型下 base 整合包是否应包含 ops 包，需在 package-management 里定；改动会影响已发布整合包的成员清单。
- **eval 的重复实验建模**：N 次重复是 N 个 attempt 还是 N 个 mission（`retry` 不幂等）。pilot 时定死，影响后续能否算方差。
- **attest key 的人机边界**：若要求某些转移必须人来，需在模板层约定该 key 只由 CLI/slash 登记，或排除出模型工具可写范围。


- **feature 包的 client 半在 profile 缺席时是否优雅降级**：决策 9 下 domain 隔离靠 profile，未挂载的包连 client 半一起消失，这是期望行为；但需实测确认没有残留的空槽位或报错。阶段二判据 1、5 覆盖此项。

- **0.1.2 基线迁移未在本文件占位，但已在进行**：`ankh-guard` 的 preset 探测双宿主面（`22e3a4a`）与 local-agent 的 dual-line CallId（`3a405aa`，从 0.1.2 wave cherry-pick）都已落地。发布前置里的「build + test 全绿」需明确针对哪条宿主线，否则阶段一的验收基准是浮动的。相关评估见 `.agents/notes/proposed/architecture/2026-08-28-host-0.1.2-alpha1-assessment.md`。

## 九、维护规则

- 新 proposal 立项时，在「包账本」对应层补一行相关 proposal；找不到落点先改本文件。
- **判断提案进度读「实现记录」段，不读 `状态` 字段**：后者会滞后（2026-08-28 审计发现四个提案的状态字段落后其实现记录一到四个里程碑）。
- 「本期迭代」随迭代滚动重写：本期收口后，把完成项挪进「已完成」并写下一期目标。发布相关的规则事实（ops.md / publishing.md 的闸门）不在这里复述，需要时链过去。
- 包发布或状态变化时更新状态标记；版本以 `package.json` 为准，发布事实以 [release-status.md](release-status.md) 为准。
- 「已定决策」只增不改：结论被推翻时保留原条目并注明失效原因与日期（如决策 8 的形态）。
