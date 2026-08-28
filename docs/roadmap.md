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

domain 是 **workflow 的组装单位**，也是 UI 上「mode」的对应物——切 mode 即切当前 workflow 的界面重心（见 `mode-switcher` ※）。

| domain | 组成 | 状态 |
|---|---|---|
| **`dev`** 开发工作台 | base + local-agent + worktrees + mission + room | **首发目标**。日常管理 catmem 这类项目的形态 |
| `eval` 评测对比 | base + local-agent + mission + datasets + lab | 组成初稿见 package-management |
| `novel` 小说创作 | base + ? | 未展开 |

两个 domain 的交集是 **local-agent + mission**——它们是共同前置。**capability 层不收口，任何 domain 包都发不出去。**

## 四、包账本

状态标记：✅ 已上架 npm ｜ 🔶 rc，功能通未发布 ｜ 🌿 分支未合流 ｜ ⬜ 未开工

### base — 通用体验

| 包 | 版本 | 状态 | 功能 | 相关 proposal |
|---|---|---|---|---|
| `message-tools` | 0.1.0 | ✅ | 消息编辑 / 真撤回 / 恢复重放（唯一改变模型所见的 base 包） | [withdraw-file-rollback](../proposals/active/2026-08-21-withdraw-file-rollback.md) `planned` |
| `message-timeline` | 0.1.0 | ✅ | 会话左缘悬浮历史消息时间轴，点击跳转 | — |
| `session-title-edit` | 0.1.0 | ✅ | 标题内联编辑重命名，用户来源标题被钉住 | — |
| `file-preview` | 0.1.1 | ✅ | 宿主侧只读文件预览 Remote 服务（列表 + 内容 + diff） | — |
| `ui-file-preview` | 0.1.0 | ✅ | 「产物」tab、回合变更卡片、预览抽屉 | [file-view-html-rendering](../proposals/active/2026-08-21-file-view-html-rendering.md) `planned`<br>[local-files-browser](../proposals/active/2026-08-26-local-files-browser.md) `planned` |
| `taskpilot` | 0.1.0 | ✅ | 后台任务 / 子 Agent 胶囊，停止中断 + 详情抽屉 | — |
| `whalesong` | 0.1.0 | ✅ | 任务氛围：鲸鱼喷水、favicon 动画、完成提示音 | — |
| `ui-shortcuts` | 0.1.0 | ✅ | 可自定义键位的快捷键 | — |
| `context-guard` | 0.1.0 | ✅ | 上下文占用越阈值时出现压缩按钮 | [context-clearing](../proposals/active/2026-08-19-context-clearing.md) `idea` |
| `inline-html-render` | 0.1.11 | 🔶 | `dsh-card` fenced block → 沙箱 iframe，对话内可交互卡片 | — |
| `capability-catalog` | 0.1.24 | 🔶 | 技能与工具目录、来源归属、装技能、`list_capabilities` 工具 | `capability-catalog` `in-progress` ※ |

### capability — 能力原语

| 包 | 版本 | 状态 | 功能 | 相关 proposal |
|---|---|---|---|---|
| `local-agent` | 0.1.0-rc.6 | 🔶 | 家族核心：harness registry、作用域 home、登录/会话命令族、委派门面 `ctx.localAgent` | [delegation-api](../proposals/active/2026-08-18-local-agent-delegation-api.md) `planned`<br>[member-channel](../proposals/active/2026-08-19-local-agent-member-channel.md) `planned` ← **卡发布**<br>[member-state](../proposals/active/2026-08-22-local-agent-member-state.md) `planned`<br>[live-settings-card](../proposals/active/2026-08-26-local-agent-live-settings-card.md) `in-progress` |
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

## 六、优先级

| 阶段 | 动作 | 解锁 |
|---|---|---|
| **P0** | capability 层收口：local-agent 第二波上架（member-channel 收尾）、mission / worktrees 转正式版 | 一切 domain 包 |
| **P0** | room 合 main | `dsh-dev` 的最后一块 |
| **P1** | 首发 `dsh-dev`（形态 B：profile 目录模板） | 验证「base + capability 组装成 workflow」形态成立 |
| **P1** | `eval` pilot：1 维度 × 4 原生组合 × 3 重复 | 验证 bundle 能否支撑可发布结论 |
| **P2** | 出 `dsh-eval`；mobile-access 重写并落地 | 访问维度 |
| **P3** | 多人协作（每人一实例 + 共享数据面） | — |

### 下一步三件事

1. **member-channel 收尾 → local-agent 第二波上架**。它同时堵着 `dsh-dev` 和 `dsh-eval`。
2. **room 合 main**。现在是孤儿分支，越晚合冲突越大。
3. **eval pilot 前补一条**：把各 harness CLI 的 `--version` 与模型端点标识写进 mission `refs`——lab 的环境指纹只覆盖容器镜像 digest，而 local-agent 在宿主 spawn CLI，**被测对象的版本目前不在任何指纹里**，CLI 自动更新会静默毁掉可复现性。

## 七、待决

- **`dsh-web-basic` 含 `ankh-guard`（ops 层）**是历史组成。四层模型下 base 整合包是否应包含 ops 包，需在 package-management 里定；改动会影响已发布整合包的成员清单。
- **eval 的重复实验建模**：N 次重复是 N 个 attempt 还是 N 个 mission（`retry` 不幂等）。pilot 时定死，影响后续能否算方差。
- **attest key 的人机边界**：若要求某些转移必须人来，需在模板层约定该 key 只由 CLI/slash 登记，或排除出模型工具可写范围。

## 八、维护规则

- 新 proposal 立项时，在「包账本」对应层补一行相关 proposal；找不到落点先改本文件。
- 包发布或状态变化时更新状态标记；版本以 `package.json` 为准，发布事实以 [release-status.md](release-status.md) 为准。
- 「已定决策」只增不改：结论被推翻时保留原条目并注明失效原因与日期（如决策 8 的形态）。
