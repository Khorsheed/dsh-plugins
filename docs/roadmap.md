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

| 层 | 判据 | 面向 |
|---|---|---|
| `base` | 装了就更好用，无外部依赖，任何 domain 都要 | 所有用户 |
| `capability` | 可被多个 domain 复用的能力原语，**有外部依赖**（CLI / docker / 文件系统约定） | domain 组装者 |
| `domain` | 把 base + 若干 capability 组装成一个 workflow 的完整体验，**几乎无新代码** | 特定场景用户 |
| `ops` | 自托管、守卫、插件管理 | 自托管运维者 |

`capability` 层独立的理由：local-agent 家族、mission、lab 这批包既不是「体验」（要装 CLI、要登录、要 docker，塞进 base 会让基础整合包变重），也不专属某个 domain（mission 归 eval 还是 dev？两边都要）。强行按「主标签唯一」归类会产生归属冲突。

四层的收益：**domain 包退化成纯组合**，出一个新 domain 不写新代码，只是「base 全体 + 挑几个 capability + 可能一两个专属 UI 包」。

`package.json` 的 `dsh.category` 增加 `capability` 取值；`domain` 包继续用 `dsh.domain` 备注（`dev` / `eval` / `novel`）。

## 三、domain 清单

domain 是 **workflow 的组装单位**。一个 domain 在运行时表现为一个或多个 agent preset，用户新建会话时选择的就是它（UI 形态见 `mode-switcher` ※）。内部术语统一用 `domain`，不再与「mode」混用。

| domain | 组成 | 状态 |
|---|---|---|
| **`daily`** 日常 | base 全体（UI）+ `daily` preset | preset = 官方 `standard` + `inline-html-card` skill + `list_capabilities`；是 `agent-presets` 的 `default` |
| **`dev`** 开发工作台 | base + local-agent + worktrees + mission + room | **首发目标**。日常管理 catmem 这类项目的形态 |
| `eval` 评测对比 | base + local-agent + mission + datasets + lab | 组成初稿见 package-management |
| `novel` 小说创作 | base + ? | 未展开 |

两个 domain 的交集是 **local-agent + mission**——它们是共同前置。**capability 层不收口，任何 domain 包都发不出去。**

### domain 在两层落地

一个 domain 不只是「装哪些插件」，它同时是「这个会话看到什么」：

| 层 | 承载 | 切换成本 |
|---|---|---|
| profile `bundles` | 插件全集。`capability` 层的包按需挂载、探测不到即静默降级，因此全装无害 | 重启（很少发生） |
| **agent preset** | 该 domain 的视图：工具子集、prompt sections、skills、persona | 新建会话时选 |

同一个实例因此能并存「开发会话」与「评测会话」，不必重启切换。整合包的目录形状：

```
dsh-dev/
├─ package.json              成员插件为直接依赖
├─ cordis.yml                dsh.profile.bundles 层
│                            + agent-presets 的 roots 指向 ./presets
└─ presets/dev/agent.cordis.yml   工具子集 + prompt sections + skills + persona
```

`roots` 接受任意路径（官方配置示例即 `~/company-presets`），所以整合包自带 preset 无需上游 seam。

两条官方硬约束：**会话只能在零产出时切 preset**（`agent-presets` README：*a session can switch to a different preset only while it has produced nothing*），因此 mode 只能在新建会话时选，不能中途切；**子 agent 继承父的组合**，所以委派出去的子会话与父会话同 preset。

「不感知某能力」不需要屏蔽机制：novel preset 不挂 `worktrees`，它的 prompt section 就不存在，模型看不到——比写一条「别用 worktree」的指令更干净，也不占 token。

### 什么进 preset，什么不进

preset 只组合三样：**tools、prompt sections、skills**。浏览器 UI 插件（`dsh.client` 声明的 client 半）挂在 profile 的 client slot 上，**所有 domain 共享，不参与 preset**——这正是 base 层之所以叫 base 的原因。

base 层 11 个包里只有两个带 agent 侧成分：`inline-html-render`（注册 `inline-html-card` skill）与 `capability-catalog`（`list_capabilities` 工具）。其余九个是纯 UI 或 host 服务，全局生效。

skill 是**拉取式**的：preset 组合 skill 等于声明哪些 skill 在册，而不是把内容塞进系统提示词。因此不同 preset 下的 skill 集合会实际改变 agent 能力——**评测必须固定 preset**，否则条件不可比。

preset 的 authoring 是 **copy-only**（复制一个已有 preset 的整个目录再改），所以自建 preset 从复制官方 `standard` 起步，而不是从零写组合文件。官方自带四个：`standard`（功能完整的编码 Agent）、`minimal`（bash + 编辑器双工具）、`ptc`（standard + PTC 模式 SDK）、`cordis`（standard + 运行时检查与 preset 创作指导）。

## 四、包账本

状态标记：✅ 已上架 npm ｜ 🔶 rc，功能通未发布 ｜ 🌿 分支未合流 ｜ ⬜ 未开工

### base — 通用体验

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
| `inline-html-render` | 0.1.11 | 🔶 | `dsh-card` fenced block → 沙箱 iframe，对话内可交互卡片。**注册 `inline-html-card` skill（拉取式）——base 层仅有的两个 agent 侧成分之一，进 preset** | — |
| `local-files` | 0.1.0 | 🔶 | 独立工作区 tab：懒加载文件树 + 结构化 HTML/Markdown/JSON/CSV/图片预览，git 无关，按会话记忆根目录（从 worktrees 拆出，提交 `3df3044`） | [local-files-browser](../proposals/closed/2026-08-26-local-files-browser.md) `done` |
| `capability-catalog` | 0.1.24 | 🔶 | 技能与工具目录、来源归属、装技能、`list_capabilities` 工具（**base 层仅有的两个 agent 侧成分之一，进 preset**）。按 **agent preset 的 standing scope** 读注册表，因而是 domain/preset 模型的展示面——不同 mode 下有哪些工具与 skill，在这里可见 | `capability-catalog` `in-progress` ※ |

### capability — 能力原语

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
| `plugin-manager` | — | ⬜ | 设置里的插件开关分区，写 `disabled: true` 热生效 | [plugin-manager](../proposals/active/2026-08-22-plugin-manager.md) `proposed` |

### 跨层 / 分发基建

| proposal | 状态 | 作用 |
|---|---|---|
| [package-management](../proposals/active/2026-08-21-package-management.md) | `planned` | 分类 → 整合包组合 → 发布流程的可执行链路。**本文件的四层需同步进去** |
| [upstream-meta-pack-reconcile](../proposals/active/2026-08-21-upstream-meta-pack-reconcile.md) | `planned` | 薄元包一键装全家（形态 C），需上游 seam |
| `mode-switcher` ※ | `idea` | domain 的 UI 表达：切 mode = 切 workflow 界面重心 |
| [mobile-access](../proposals/active/2026-08-19-mobile-access.md) | `planned` | 访问维度。**前提已失效需重写**（见决策 8） |

> ※ 标记的两个提案（`capability-catalog`、`mode-switcher`）目前在主工作树尚未提交（`git status` 显示为未跟踪），因此本文件不对其建立链接。它们进入 main 后应补上链接。

## 五、已定决策（proposal 的边界条件）

1. **dsh 是唯一工作台外壳。** AgentOS（dpsk-game）冻结为设计资产，有价值的能力以插件形态择优重做，不搬 Go 代码。
2. **本地与远程不是两套工作台**，而是 local-agent 家族的一个执行目标维度（本地进程 / 远端 dsh / lab 容器 / e2b）。
3. **多人协作的上限是「每人一实例 + 共享数据面」。** dsh 的信任模型是「能连上 = 等同本机用户」（`session.create` 故意不在特权方法内），单实例多租户做不到，除非改官方代码。
4. **编排半自动**：agent 拿 mission 工具派工，人在 `tools/pre-execute` 审批层卡点，**不新建编排组件**。注意 `mission_attest` 本身是模型工具，真正的把关在工具审批层而非状态机层。
5. **判定不进插件**：lab / mission / datasets 守住「只记录不判断」，分析在 export bundle 之外做（notebook / 脚本）。
6. **对比先测原生组合**（自家 harness × 自家模型），析因设计留后。结论绑定组合、不可迁移，写进 `methodology.md`。
7. **live 通道留在家族自有 wire**，官方 SDK 只承接 one-shot / resume——v0.1.2-alpha.1 仍无 mid-turn cancel（`sdk/client/README.md` 明列为已知限制）。
8. **上游 0.1.2 新增浏览器 token 认证**（`client/connection/src/browser-auth.ts`）：launch token → 签名 cookie，取代了原先的 `PRIVILEGED_METHODS` loopback 分层。mobile-access 提案里「进程内认证无 seam」的前提已失效。但 cookie 不带 `Secure`、`--host 0.0.0.0` 仍不支持，**TLS 前置仍是硬要求**。

9. **domain 在两层落地**：profile 提供插件全集，preset 提供 domain 视图（工具子集 / prompt sections / skills / persona）。工作方式的表述按性质分流——通用实践进 preset 的 prompt section，项目纪律留在项目 `AGENTS.md`，跨项目个人偏好留在 `$DSH_HOME/AGENTS.md`。三者叠加，互不替代。

## 六、优先级

| 阶段 | 动作 | 解锁 |
|---|---|---|
| **P0** | capability 层收口：local-agent 第二波发布、mission / worktrees 转正式版 | 一切 domain 包 |
| **P1** | 首发 `dsh-dev`（形态 B：profile 目录模板） | 验证「base + capability 组装成 workflow」形态成立 |
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

### 阶段

| 阶段 | 目标 | 前置 | 里程碑（可验收） |
|---|---|---|---|
| **一** | 家族进 3080 | 无 | local-agent 七包在 3080 跑起来，迁移验收三步通过，**3 天观察期开始计时** |
| 二 | 首个 domain 包 + 两层模型验证 | 阶段一 | `daily` 与 `dev` 两个 preset 并存，下方五条判据全过 |
| 三 | room 归队 | 阶段一（契约冻结后适配才不是移动靶） | `packages/room` 在今天的 main 上 build+test 绿，合入 main |
| 四 | npm 第二波 | 阶段一 + 前置 10 到期 + 前置 9、11、13 | 七包上架，一次性目录装得上并 import 通过 |
| 五 | eval pilot | CLI 版本指纹 + 阶段一 | 产出第一个 export bundle，判据与管道得到验证 |

阶段二至五**只依赖阶段一**，彼此不互相阻塞——阶段一是唯一的关键路径。

### 阶段一的内容

| 事项 | 类型 | 说明 | 降级 |
|---|---|---|---|
| room 复验验收项移交 room | 决策 | member-channel 的 M1–M3 已全部落地、四 provider 真实 CLI 端到端探针通过（提案「实现记录」段为准，其 `状态` 字段与 README 表述均已滞后并于本轮修正）。剩余卡点是它验收标准里的一条「room 复验」——room 未合 main 时该路径不可达，且第二波用户手上不会有 room。应把该项移交 room 的 done 判定 | 若坚持在第二波验收该项，阶段一至五全部等 room 归队 |
| 前置 2–8 逐包过闸 | 施工 | 七包按依赖序，core 先行 | 任一闸不过即停，不绕过 preflight |
| CLI 版本指纹 | 施工（并行） | acquire 时把四个 harness CLI 的 `--version` 与模型端点标识写进 mission `refs` | 独立项，随时可停；它真正服务的是阶段五 |
| capability-catalog 的 Agent Note 首节 | 修复 | 首节须为 `## Problem`，当前为 `## Decision`，`verify-agent-note-format` 会红 | 属他人在制品时不代改，只通报 |

### 阶段二的构成

`dsh-dev` 是第一个按决策 9 组装的 domain 包。验证两层模型至少需要两个 preset 同时在场，因此本阶段同时产出 `daily`：

| 半边 | 内容 | 来源 |
|---|---|---|
| profile | `bundles` 层列出成员插件；`agent-presets` 配置 `roots` 指向 `./presets`，`default` 设为 `daily` | 形态 B，有 `dsh-web-basic` 先例 |
| `daily` preset | 复制官方 `standard`，加 `inline-html-card` skill 与 `list_capabilities` | 归 `dsh-web-basic` |
| `dev` preset | 复制官方 `standard`，加 local-agent / mission / worktrees 的工具行 + 开发 workflow 的 prompt section（通用实践，非项目纪律） | 归 `dsh-dev` |

preset 半边是本阶段的**新工作**——profile 模板已有先例，preset 分发没有。先做最小可用形态跑通链路，persona 与 skill 子集随后迭代。

#### 里程碑判据：domain 切换不受影响

| # | 判据 | 验证什么 |
|---|---|---|
| 1 | 装齐多个 domain 包后，roster 里所有 preset 健康，无 broken row | preset 命名的插件都能解析；顺带证明两个整合包装进同一 profile 不冲突 |
| 2 | 新建会话选不同 preset，工具集确实不同 | preset 真的在分工具 |
| 3 | `capability-catalog` 在不同 preset 下显示不同的工具与 skill | catalog 作为该模型展示面的价值兑现 |
| 4 | 切换不重启进程（pid 不变），只发 `tools/change` | 热挂载成立（`agent-presets` 是 per-process standing scope，非重启） |
| 5 | **base 层 UI 在所有 preset 下一致可用** | profile 级 UI 与 agent 级工具的分层正确 |

第 5 条是这组判据的核心：若切到某个 preset 后消息编辑之类的能力消失，说明有 UI 插件被错误地放进了 preset 层。

**room 不在阶段一。** 它是 `dsh-dev` 的增强而非前提——不含 room 的 `dsh-dev`（base + local-agent + worktrees + mission）已是完整可用的开发工作台。room 的适配面对的是 175 个提交的契约漂移（main 侧已有 `retire the standalone settings section`、`expose activeDelegations` 等实质变动），工作量不可控，给它独立阶段以免拖垮关键路径。

## 八、待决

- **`dsh-web-basic` 含 `ankh-guard`（ops 层）**是历史组成。四层模型下 base 整合包是否应包含 ops 包，需在 package-management 里定；改动会影响已发布整合包的成员清单。
- **eval 的重复实验建模**：N 次重复是 N 个 attempt 还是 N 个 mission（`retry` 不幂等）。pilot 时定死，影响后续能否算方差。
- **attest key 的人机边界**：若要求某些转移必须人来，需在模板层约定该 key 只由 CLI/slash 登记，或排除出模型工具可写范围。

- **`mode-switcher` 提案需补一条官方约束**：会话只能在零产出时切 preset，因此 mode 是新建会话时的选择，不是会话内的开关。该提案目前在主工作树未提交，待其进入 main 后补。

- **逐包标注「哪部分进 preset」**：像 `capability-catalog` 既有 `list_capabilities`（进 preset）又有设置 tab（profile 级 UI，不进）。这份标注无法靠 grep 得到——`inline-html-render` 的 skill 注册就不匹配常见关键词——须逐包人工过一遍，否则组装 preset 时只能翻 README。

- **0.1.2 基线迁移未在本文件占位，但已在进行**：`ankh-guard` 的 preset 探测双宿主面（`22e3a4a`）与 local-agent 的 dual-line CallId（`3a405aa`，从 0.1.2 wave cherry-pick）都已落地。发布前置里的「build + test 全绿」需明确针对哪条宿主线，否则阶段一的验收基准是浮动的。相关评估见 `.agents/notes/proposed/architecture/2026-08-28-host-0.1.2-alpha1-assessment.md`。

## 九、维护规则

- 新 proposal 立项时，在「包账本」对应层补一行相关 proposal；找不到落点先改本文件。
- **判断提案进度读「实现记录」段，不读 `状态` 字段**：后者会滞后（2026-08-28 审计发现四个提案的状态字段落后其实现记录一到四个里程碑）。
- 「当前迭代」随阶段推进重写：里程碑达成即划掉该阶段，下一阶段成为重点。发布前置依赖表只在规则本身（ops.md / publishing.md）变化时改。
- 包发布或状态变化时更新状态标记；版本以 `package.json` 为准，发布事实以 [release-status.md](release-status.md) 为准。
- 「已定决策」只增不改：结论被推翻时保留原条目并注明失效原因与日期（如决策 8 的形态）。
