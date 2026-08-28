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

执行层面的依赖、闸门与里程碑见[当前迭代](#七当前迭代)——那里是唯一维护的一份，本节只排长期次序。

## 七、当前迭代

阶段不绑时间，绑**依赖与里程碑**：前一阶段的里程碑达成，后一阶段才有意义。近期重点是阶段一。

### 发布前置依赖（local-agent 第二波）

一次 npm 发布要过的全部闸，按依赖顺序。`来源`列指向规则的事实源，避免凭记忆施工。

| # | 前置 | 判据 | 来源 |
|---|---|---|---|
| 1 | 家族契约冻结 | 「member-channel 不阻塞第二波」的决策入册；家族按现有能力发布 | 本文件决策清单 |
| 2 | 版本线确认 | `npm view <包名> version`，新版本必须更高（403/409 就是撞这个） | publishing.md ② |
| 3 | build + test 全绿 | `pnpm --filter <包名> run build && test`，逐包 | publishing.md ③ |
| 4 | Compatibility 双写同步 | 两个 README 的 `Compatibility` 段 + package.json 的 `dsh.compat`（`minHost`，降级项写 `notes`） | AGENTS.md 包约定 |
| 5 | pack-dist 出包 | `scripts/pack-dist.ts` 做 scope 重写与 `files` 校验；禁止对源目录直接 `npm publish` | publishing.md ④ |
| 6 | tarball 内容完整 | `tar -tzf` 确认 `lib/`、`cordis.patch.yml`、`scripts/` 一个不少 | publishing.md ⑤ |
| 7 | 进 3080 六道闸 | `pnpm deploy:3080` 逐包跑：build+test → pack-dist → 刷新清单 → 录绿色凭证 → **preflight（FAIL 即停，永不绕过）** → 重启 + canary PASS | ops.md 门禁清单 |
| 8 | 迁移验收三步 | ① 会话里列出 skill 并**真调用一次**（只看目录会漏「列出即正常、调用即炸」）② `check-env --port 3080` 读数无异常 ③ 走一遍门禁重启，canary PASS | ops.md 验收清单 |
| 9 | README 截图回填 | 验收时逐包拍可见界面，`git add -f` 替换占位注释；缺图不阻塞发布，占位注释必须在 | ops.md |
| 10 | **3080 连续 3 天无事故** | 崩溃、功能回退、相关 preflight 失败均无 | ops.md 放行标准 |
| 11 | npm 账号与 scope | `npm whoami` 是 `@khorsheed` 的所有者；`@deepseek-ai` 是官方 org，不要尝试 | publishing.md ①、失败对照表 |
| 12 | 家族同发、按依赖序 | 七包一次发齐，core 先于 provider（唯一的齐步走例外，其余插件各走独立线） | ops.md 发布节奏 |
| 13 | 消费者验证 | 一次性目录 `npm install` + `import` 冒烟，30 秒 | publishing.md 发布后验证 |

**第 10 项是时间门，不是工作量**——它把 npm 发布从「能不能做完」变成「什么时候到期」，因此阶段四只能排在最后，且不阻塞其余阶段。

**2026-08-29 实况**：前置 1–7 对 local-agent 家族**已经完成**——六个包在 3080 生产 profile 上运行（`~/.dsh-official/profiles/web/package.json` 为准，tarball 形态，版本后缀 `+2608271440`）。观察期（前置 10）在跑，08-30 14:40 满。因此阶段一已不是关键路径，它在等时间；**阶段二可立即开工**。

### 阶段

| 阶段 | 目标 | 前置 | 里程碑（可验收） |
|---|---|---|---|
| **一** | 家族进 3080 | 无 | **大部分已完成**：家族六包（core + 四 provider + tool-subagent）于 2026-08-27 14:40 部署至 3080，**观察期至 08-30 14:40 满**（前提是期间无家族相关事故）。剩余：确认迁移验收三步、README 截图回填 |
| 二 | 首个 domain 包 + 切换验证 | 阶段一 | `dsh-dev` profile 可一条命令装起，`ankh-guard restart` 在 web-basic 与 dsh-dev 之间切得回来，下方判据全过 |
| 三 | room 归队 | 阶段一（契约冻结后适配才不是移动靶） | `packages/room` 在今天的 main 上 build+test 绿，合入 main |
| 四 | npm 第二波 | 阶段一 + 前置 10 到期 + 前置 9、11、13 | 七包上架，一次性目录装得上并 import 通过 |
| 五 | eval pilot | CLI 版本指纹 + 阶段一 | 产出第一个 export bundle，判据与管道得到验证 |

阶段二至五**只依赖阶段一**，彼此不互相阻塞——阶段一是唯一的关键路径。

### 阶段一的内容

| 事项 | 类型 | 说明 | 降级 |
|---|---|---|---|
| room 复验验收项移交 room | 决策 | member-channel 的 M1–M3 已全部落地、四 provider 真实 CLI 端到端探针通过（提案「实现记录」段为准，其 `状态` 字段与 README 表述均已滞后并于本轮修正）。剩余卡点是它验收标准里的一条「room 复验」——room 未合 main 时该路径不可达，且第二波用户手上不会有 room。应把该项移交 room 的 done 判定 | 若坚持在第二波验收该项，阶段一至五全部等 room 归队 |
| ~~前置 2–8 逐包过闸~~ | **已完成** | 家族六包已在 3080 运行（2026-08-27 14:40 部署） | — |
| 确认迁移验收三步 | 核对 | skill 真调用一次 / `check-env --port 3080` 读数 / 门禁重启 canary PASS——是否已执行需你确认 | 未做则补做，不重启也能核对前两项 |
| README 截图回填 | 文档 | 验收时逐包拍图替换占位注释，`git add -f` | 缺图不阻塞发布，占位注释必须在 |
| CLI 版本指纹 | 施工（并行） | acquire 时把四个 harness CLI 的 `--version` 与模型端点标识写进 mission `refs` | 独立项，随时可停；它真正服务的是阶段五 |
| capability-catalog 的 Agent Note 首节 | 修复 | 首节须为 `## Problem`，当前为 `## Decision`，`verify-agent-note-format` 会红 | 属他人在制品时不代改，只通报 |

### 阶段二的构成

`dsh-dev` 是第一个按决策 9 组装的 domain 包：**一个 profile 目录**，加上它自带的 preset。

| 半边 | 内容 | 验收 |
|---|---|---|
| profile | `package.json` 列成员依赖；`cordis.yml` 的 `bundles` 层挂 base 全体 + dev 的 feature（local-agent 家族、worktrees、mission）；`agent-presets` 的 `roots` 指向 `./presets` | 空 `$DSH_HOME` 一条命令装起来并启动 |
| preset | `presets/standard/agent.cordis.yml`——该 domain 的默认 agent，从官方 `standard` 复制起步 | 新建会话选得到；`capability-catalog` 列出该 profile 的工具与 skill |
| 切换脚本 | 照 `restart-into-web-basic.sh` 的形态，`ankh-guard restart --profile dsh-dev` | 见下方判据 |

preset 半边是本阶段的**新工作**——profile 模板已有 `dsh-web-basic` 先例，分发 preset 没有。先做一个最小可用的（从 `standard` 复制 + 一段开发 workflow 的 prompt section），persona 与工具子集随后迭代。

#### 里程碑判据：模式切换成立且可逆

| # | 判据 | 验证什么 |
|---|---|---|
| 1 | 从 web-basic 切到 dsh-dev：同端口交接，浏览器刷新后是 dev 的界面（多出 worktrees 徽标、mission tab 等） | 切换动作成立，UI 随 profile 走 |
| 2 | **再切回 web-basic**，界面回到 daily 形态，无残留 | 可逆——这是敢用它的前提 |
| 3 | 故意坏掉 dsh-dev 的组合（如改坏一行 patch YAML）再切，**preflight 拒绝且当前实例不停** | 安全网真的在 |
| 4 | 会话数据跨切换存活：切过去再切回来，之前的会话还在、能打开 | 切的是插件组合，不是数据 |
| 5 | dev profile 下 `capability-catalog` 列出的工具含 mission / 委派工具；web-basic 下不含 | 隔离靠 profile 成立 |

第 2、3 条是这组判据的核心：**可逆 + 切不过去不伤当前实例**，这两条成立才敢把它当日常操作。

**room 不在阶段一。** 它是 `dsh-dev` 的增强而非前提——不含 room 的 `dsh-dev`（base + local-agent + worktrees + mission）已是完整可用的开发工作台。room 的适配面对的是 175 个提交的契约漂移（main 侧已有 `retire the standalone settings section`、`expose activeDelegations` 等实质变动），工作量不可控，给它独立阶段以免拖垮关键路径。

## 八、待决

- **`dsh-web-basic` 含 `ankh-guard`（ops 层）**是历史组成。四层模型下 base 整合包是否应包含 ops 包，需在 package-management 里定；改动会影响已发布整合包的成员清单。
- **eval 的重复实验建模**：N 次重复是 N 个 attempt 还是 N 个 mission（`retry` 不幂等）。pilot 时定死，影响后续能否算方差。
- **attest key 的人机边界**：若要求某些转移必须人来，需在模板层约定该 key 只由 CLI/slash 登记，或排除出模型工具可写范围。


- **feature 包的 client 半在 profile 缺席时是否优雅降级**：决策 9 下 domain 隔离靠 profile，未挂载的包连 client 半一起消失，这是期望行为；但需实测确认没有残留的空槽位或报错。阶段二判据 1、5 覆盖此项。

- **0.1.2 基线迁移未在本文件占位，但已在进行**：`ankh-guard` 的 preset 探测双宿主面（`22e3a4a`）与 local-agent 的 dual-line CallId（`3a405aa`，从 0.1.2 wave cherry-pick）都已落地。发布前置里的「build + test 全绿」需明确针对哪条宿主线，否则阶段一的验收基准是浮动的。相关评估见 `.agents/notes/proposed/architecture/2026-08-28-host-0.1.2-alpha1-assessment.md`。

## 九、维护规则

- 新 proposal 立项时，在「包账本」对应层补一行相关 proposal；找不到落点先改本文件。
- **判断提案进度读「实现记录」段，不读 `状态` 字段**：后者会滞后（2026-08-28 审计发现四个提案的状态字段落后其实现记录一到四个里程碑）。
- 「当前迭代」随阶段推进重写：里程碑达成即划掉该阶段，下一阶段成为重点。发布前置依赖表只在规则本身（ops.md / publishing.md）变化时改。
- 包发布或状态变化时更新状态标记；版本以 `package.json` 为准，发布事实以 [release-status.md](release-status.md) 为准。
- 「已定决策」只增不改：结论被推翻时保留原条目并注明失效原因与日期（如决策 8 的形态）。
