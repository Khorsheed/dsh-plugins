# 提案管理（Proposals）

English | 中文

> 本目录是 dsh-plugins 的**能力提案总账**：一个提案 = 一个**能力意图**的完整生命周期（从想法到关闭），可以跨多个包、多个 PR、多个 Agent Note。提案**实现后及时关闭**——关闭的提案移入 `closed/`，绝不长期挂着。

## 与 Agent Note 的分工（先读）

| | Agent Note（`.agents/notes/`） | Proposal（本目录） |
|---|---|---|
| 粒度 | 一次决策 / 一次改动 | 一个能力意图（可跨多个包 / PR / note） |
| 回答的问题 | 为什么这么改、放弃了什么 | 这个能力做不做、做到哪了、谁在推进 |
| 生命周期 | proposed → implemented → rejected（+ archived） | idea → planned → in-progress → verified → done / closed |
| 强制程度 | AGENTS.md 强制，pre-commit 有格式 gate | 本目录约定，无机器 gate（轻量文档层） |

**衔接规则**：

- 一个提案实施中的**每次非平凡改动仍然写 Agent Note**（AGENTS.md 要求不变）；提案正文的「实现记录」小节登记相关 note / PR / 包名，方便审计。
- Agent Note 的 `proposed/` 是"尚未实施的单次决策"；若它服务于某个提案，可在 note 中链接回提案（反之亦然）。

## 目标宣言（所有提案的共同判据）

本仓库所有能力最终以**可插拔插件**交付：`dsh plugin add / remove` 一条命令装、一条命令卸，**零官方代码改动**——不修改、不替换、不 hack 官方包。由此派生出三条硬规则：

1. 每个提案头部必须如实标注**官方依赖**：`纯插件` / `需契约扩展（upstream 候选）` / `当前依赖补丁`。
2. **done 的判定绑定可插拔交付**：能力以独立插件包交付（含 `dsh.bundle` 自挂载、可热卸载）才算 `done`。依赖补丁的实现最多标 `verified`（补丁流环境验收），不算 done，且必须写明**去补丁化路径**。
3. 能力被官方吸收（官方自带，无需插件）→ `closed` 并注明「官方吸收」。

## 目录与生命周期

```
proposals/
  README.md / README.en.md   本文件
  active/                    进行中的提案：idea / planned / in-progress / blocked
  closed/                    已关闭：done / closed（放弃 / 被取代 / 官方吸收）
  prototypes/                提案的 HTML 原型与故事板（见下「原型与故事板」）
```

文件命名：`YYYY-MM-DD-<slug>.md`（slug 用英文小写连字符；与 Agent Note 命名同款）。**路径编码状态**是刻意为之——状态变更必须伴随文件移动，防止"改了状态忘了归档"。

**原型与故事板（HTML 附件）**不放在 `scratch-*/`：那类目录是 gitignored 的本机临时区，提案引用它就等于给别的机器留一个断链。约定两条：

- `proposals/` 侧提案的附件 → `proposals/prototypes/<slug>.html`，由提案正文以相对链接指过去。
- `docs/upstream-proposals/` 的上游提案原型 → 与提案文档同目录、互指（先例：`reader-prototype.html` ↔ `2026-09-17-reader-prototype-notes.md`）。

两种情况都只作**可视化附件**：验收结论、决策与事实一律写在提案正文里，原型不是第二事实源。

## 状态机

```
idea → planned → in-progress → verified → done（移入 closed/）
          ↘ blocked（写原因；解除后回 in-progress）
任意状态 → closed（放弃 / 被取代 / 官方吸收，注明理由，移入 closed/）
```

| 状态 | 含义 | 所在目录 |
|---|---|---|
| `idea` | 想法，未立项 | active/ |
| `planned` | 已立项，待开工 | active/ |
| `in-progress` | 实施中 | active/ |
| `blocked` | 卡住，**必须写原因**（缺前置 / 等 seam / 等上游） | active/ |
| `verified` | 验收通过（探针 / 实测全绿；补丁流环境可用） | active/ |
| `done` | **以可插拔插件交付并验收**（零官方改动） | closed/ |
| `closed` | 放弃 / 被取代 / 官方吸收（**理由分类必填**，见下） | closed/ |

**状态变更 = 改文件头部 + 移动文件 + 更新 README 总表，同一 commit。**

**`closed` 的理由必须是这三种之一**，写在状态行括号里——`closed/` 目录同时装着 `done`（做完了）与 `closed`（不做了），理由分类是把后者扫出来的唯一手段：

```
closed（放弃：<原因>）
closed（被取代：<接替它的提案>）
closed（官方吸收：<官方能力>）
```

于是「哪些是决定不做的」可机械查询：

```sh
grep -l '状态.*closed（' proposals/closed/*.md          # 全部不做的
grep -l '状态.*closed（放弃' proposals/closed/*.md      # 只看放弃的
```

理由分类同样写进总表状态列（`closed（放弃）` 这样的短形），完整原因留在提案文件里。这与 Agent Note 的 `Status: rejected — <why>` 同源：裁决本身就是读者要来看的事实。

**实现后及时关闭**：`verified` 后应在 7 天内转 `done` 并移入 `closed/`；拖着不关会被标 ⚠️ stale。`done` 是"关闭"不是"开始新工作"——能力交付即归档，后续增量走新提案或 note。

## 防停滞

- `idea` / `planned` 超 14 天未动，或 `verified` 超 7 天未转 `done` → 总表标 ⚠️ `stale`。
- stale 三选一：升优先级拆任务 / `closed` 注明理由 / 保留注明理由。
- 每次工作会话开始先扫总表，stale 项优先处理。

## 提案文件格式

头部（固定键，机器可读；状态/分类/官方依赖/最后更新变更时同步）：

```markdown
# <能力名>（<slug>）
- **分类**：plugin | seam | patch
- **状态**：<状态机中的值>（blocked / closed 时括号内写原因）
- **最后更新**：YYYY-MM-DD
- **查重结果**：<搜过 active/ + closed/ + .agents/notes/（含 archived）的结论>
- **官方依赖**：纯插件 / 需契约扩展（upstream 候选）/ 当前依赖补丁（去补丁化路径：…）
```

正文骨架（bespoke 技术小节可自由加在中间）：

```markdown
## 目标
## 现状（官方契约实测 / 已有实现）
## 方案
## 里程碑（可选）
## 实现记录（可选：相关 Agent Note / PR / 包名，随实施追加）
## 验收标准（done 判定，绑定可插拔交付）
## 风险 / 放弃的东西
```

## 查重铁律

新建提案前必须搜过：`active/` + `closed/` + `.agents/notes/`（含 archived）。命中已有 → 追加原文件不新建（同意图增量更新同一份，不改意图才新建）；拿不准开新还是更新 → 问一句，一行成本。

## 与其他机制的关系

- **提案 ≠ issue**：实施中的问题（bug / 验收反馈）写各包 `issues/` 或直接在实施 PR 里解决，不占提案。
- **提案 ≠ Agent Note**：见开头分工表。
- **提案 ≠ 发布计划**：发布批次 / 版本线看各包 version + `dsh plugin` 流程，提案只关心能力做没做、以什么形态交付。

## 总表

> 起步为空（本体系 2026-08-18 建立）。历史提案档案留在原快照（dsh-salvage-2026-08-16，本仓库外），不迁入；新提案按上文流程在此加行。

| 分类 | 提案 | 状态 | 官方依赖 | 前置 / 依赖 | 备注 | 最后更新 |
|---|---|---|---|---|---|---|
| plugin | [Room 可切换协调者、真流式与目标驱动协作](active/2026-09-15-room-coordinator-runtime.md) | in-progress | 纯插件（M0 验证公开接口） | local-agent / room 既有能力 | 待确认；交付 A 统一模型/控制/流式/默认协调者，交付 B 任务验收与目标闭环 | 2026-09-15 |
| plugin | [通用版本化数据集存储（datasets）](active/2026-08-19-datasets-store.md) | in-progress | 纯插件 | — | M1 已交付；独立可用，与 mission 可选兼容 | 2026-08-19 |
| plugin | [通用任务管理（mission）](active/2026-08-19-mission-tasks.md) | in-progress | 纯插件 | bench 仓库模板（评测用法） | M1 已交付；独立可用，与 datasets 可选兼容 | 2026-08-19 |
| plugin | [数据集作者协议与 skill](active/2026-08-23-dataset-authoring-protocol-skill.md) | planned | 纯插件 | — | 协议 + skill + 绑定确认流；skill 公开发行供其他 agent 复用 | 2026-08-24 |
| plugin | [受控实验单元（lab）](active/2026-08-19-lab-experiment-units.md) | in-progress | 纯插件 | datasets（`worktree_path`）· mission（`is-releasable`） | 填补 mission/datasets 有意留白的资源生命周期；provider 第一版仅 docker | 2026-08-19 |
| plugin | [local-agent 公开委派 API（start / resume / cancel + 进度事件）](closed/2026-08-18-local-agent-delegation-api.md) | done | 纯插件 | 无（原 codex 持久化 note 第 1 条已吸收进 M4） | M1–M4 全部已交付（门面 / run-progress / 四 provider 实时镜像 / delegations.jsonl 持久化）；各有 implemented note | 2026-09-21 |
| plugin | [local-agent 成员双向通道（可写 composer + promptMember + 成员互通知）](closed/2026-08-19-local-agent-member-channel.md) | done | 纯插件 | local-agent-delegation-api（底座 M1–M4） | M1 通道 / M2 composer / M3 成员互通知全部落地，kimi·claude-code·codex·dsh 四 provider 全通（后两者 2026-08-20 过真实 CLI 端到端探针）；唯一未完成的验收项「room 复验」移交 room-session-promotion | 2026-09-21 |
| plugin | [local-agent provider 长驻驱动模式（live driver）](closed/2026-08-20-local-agent-live-driver.md) | done | 纯插件 | delegation-api M1–M4（对 facade 透明） | 四家全落地+验收齐全+真机矩阵+3080 canary PASS；exec 保留为 fallback | 2026-08-23 |
| plugin | [local-agent 成员会话结构化状态（member dock + 任务清单翻译）](active/2026-08-22-local-agent-member-state.md) | in-progress | 纯插件 | member-channel（宿主）；与 live-driver 并行（顺序约定见其 §3） | M1 member dock / M2 dsh 透传与任务行 / M3 claude 适配器已落地；M3 真实 CLI 探针因 scoped home OAuth 过期未完成，拿到真实捕获后需重钉金样 | 2026-08-28 |
| plugin | [移动端接入：独立插件与 iOS 薄壳](active/2026-08-19-mobile-access.md) | in-progress | 纯插件（本地基础闭环通过） | 官方 rc1；跨网需私网 HTTPS | worktree 已实现基础包与 iOS 壳；本地流式/重连/重装通过；卸载需重启刷新；真机跨网与社区组合待验 | 2026-09-11 |
| plugin | [撤回可选回滚文件状态（withdraw-file-rollback）](active/2026-08-21-withdraw-file-rollback.md) | planned | 需契约扩展（upstream 候选） | 官方 rc 能力评估（当前 rc.8 无） | 社区 v1 纯插件子集（fs 日志后端 + git 基线 + 覆盖判定护栏）可先行；bash 捕获需上游原语 | 2026-08-21 |
| plugin | [文件视图 HTML 渲染能力增强（file-view-html-rendering）](active/2026-08-21-file-view-html-rendering.md) | in-progress | 纯插件 | 无（调研报告见 scratch 2026-08-21） | M0 四个测试页过 playwright；3d-artifact skill 最初随 dsh-file-preview 交付（提交 0bff9d2），现由 inline-html-render 分发注册；生成侧只做 skill，常驻规则与预检脚本后置 | 2026-09-12 |
| plugin | [包管理：分类、整合包形态与发布流程（package-management）](active/2026-08-21-package-management.md) | planned | 形态 A/B 纯插件 + 形态 C 需契约扩展（upstream 候选） | 包盘点（进行中） | 仅 ankh-guard 已发布（0.1.0-rc.8.9）；dsh-eval 首发整合包（形态 B 先行）；dsh-novel 等小说领域插件；薄元包需上游 seam | 2026-08-21 |
| plugin | [worktree 状态可视化与治理（worktree-governance）](active/2026-08-23-worktree-governance.md) | in-progress | 纯插件 | 无（datasets 的 git.ts 作复用模式参考） | v1 只做 git 状态实况：会话 badge（右上 utilities 空槽，绿/黄）+ 默认折叠抽屉（文件树 + DiffBlock + IDE 风提交记录）；治理层（全局板/违规/review/门禁）整体推迟；M1/M2 已实现待验 | 2026-08-24 |
| seam | [薄元包一键装全家（upstream-meta-pack-reconcile）](active/2026-08-21-upstream-meta-pack-reconcile.md) | planned | 需契约扩展（upstream 候选） | package-management（形态 C 依赖） | reconcilePlugins 只扫直接依赖（实测）；设计 1 展开式 / 设计 2 闭包+排除表；被拒则登记 seam registry | 2026-08-21 |
| plugin | [能力目录：skill+tool 全量注册渠道（capability-catalog）](active/2026-08-26-capability-catalog.md) | in-progress | 纯插件 | 无 | skill 渠道官方自带（snapshot/get + standingKeyFor 无 agent seam）；UI 独立 settings.section「工具与技能」：三列预览 + 详情弹窗（统一源码浏览器：文件树/内容 + 虚拟单节点 + 凭据配置）+ 顶部新增；新增 skill = 上传 zip(零依赖)/粘贴 SKILL.md/命令 git-clone/本机目录多选（含 env 解析）；工具归因 = mcp__ 前缀 + 白名单 + 时序差分；npm 分发走方案 C 独立提案 | 2026-08-28 |
| plugin | [local-agent 设置卡片（认证 + 常驻模式进设置页插件卡片）](active/2026-08-26-local-agent-live-settings-card.md) | in-progress | 纯插件 | live-driver（已 done，配置面后续） | 每 provider 一张 settings.plugin.item 卡（认证区块 + live 热切）；core 出共享认证组件；M3 retire 独立 section；M1 kimi 样板 | 2026-08-27 |
| plugin | [多 agent 房间以「会话内邀请 agent」为入口，而非独立新建（room-session-promotion）](active/2026-08-27-room-session-promotion.md) | planned | 纯插件 | local-agent（家族引擎，探针）· room note（设计设想） | room 能力账本立项：任意会话邀请 agent 即提升为 room；守 local-agent 引擎 + room 表面两层，**不熔合**；会话对话/成员 tab/互召唤/多成员胶囊保留 | 2026-08-27 |
| plugin | [常态工具结果清理（context-clearing）](active/2026-08-19-context-clearing.md) | idea | 纯插件 | 无（配套分析器 scripts/analyze-clearing-fit.ts 已落地） | 上下文远低于压缩线时把 keep 窗口外的旧工具结果替换为占位符；与官方 compaction / tool-result-pruner 不同生态位，不替代；2026-09-15 用户裁定：缓 | 2026-09-17 |
| plugin | [插件开关管理器（plugin-manager）](closed/2026-08-22-plugin-manager.md) | closed（放弃） | 纯插件 | 无（loader 对 profile 用户 patch 层的 HMR） | 唯一消费方 mode-switcher 已转向 agent preset；官方 0.1.2 的 Plugin list（只读清单）与 Plugin configuration（配置编辑）已覆盖查看需求，剩余的 loader 级开关不足以单独立项。方案与 watchUserPatches 热生效实测留档，需要时可重开 | 2026-08-29 |
| plugin | [本地文件浏览器（local-files-browser）](closed/2026-08-26-local-files-browser.md) | done | 纯插件 | 无（从 worktrees 拆出） | 已作为 `@khorsheed/dsh-local-files` 独立交付（提交 3df3044）：工作区 tab、懒加载文件树、结构化预览、git 无关、按会话记忆根目录 | 2026-08-28 |
| plugin | [dsh 接续通道迁官方 SDK client（local-agent-dsh-sdk-resume）](active/2026-08-27-local-agent-dsh-sdk-resume.md) | planned | 纯插件（resume）· live 全退役需契约扩展（upstream 候选，S8） | local-agent-delegation-api（家族门面/锁/持久化，不变） | 只迁 one-shot/resume，live 保留家族自有 wire——0.1.2-alpha.1 实测 SDK 协议零新增、仍无 mid-turn cancel；同时是远程执行（SSH stdio）的前置 | 2026-08-28 |
| plugin | [工作模式切换（mode-switcher）](active/2026-08-26-mode-switcher.md) | idea | 纯插件 | ankh-guard（restart 通道）· capability-catalog（切换后核对）· ui-shortcuts（可选快捷键） | 一个模式 = 一个 profile，切换走 ankh-guard 守卫重启（preflight 起不来就不切 → watchdog → canary）。**二次重写**：放弃 preset 承载 domain（preset 管不到 client UI，会「看得见用不了」）与初稿的 patch 层行开关（无 preflight 安全网） | 2026-08-29 |
| plugin | [ankh-guard：等待用户输入的回合不应被重启自动续跑（parked-turn-resume）](closed/2026-08-23-parked-turn-resume.md) | done | 纯插件（绕行）· 根因需契约扩展（上游候选 S14） | 无 | 泊在提问/审批卡片上的会话不再被重启唤醒；根因是 `AgentStatus` 二元、等输入时仍报 `running`，过滤移到 resume/deliver 路径绕行。3080 实证：升级日三次退出每次都重放报告、重复提问。已随 `@khorsheed/dsh-ankh-guard` 0.3.0 出包并进 3080 | 2026-09-21 |
| plugin | [local-agent 成员派发可靠性（排队态 + 真实流式 + 运行/排队态可见）（local-agent-member-dispatch-reliability）](active/2026-09-05-local-agent-member-dispatch-reliability.md) | planned | 纯插件 | local-agent-delegation-api（门面，M1–M4）· local-agent-live-driver（长驻模式） | 收口机制交付后的缺陷：`token` 流式实测不生效（子会话 ~0 chunk、答案不落会话）、在途 resume 冲突 20ms 硬失败而非排队、缺成员维度排队态、room 无持久运行态指示 | 2026-09-05 |
| plugin | [room 输入框与官方输入机全面对齐（room-composer-parity）](active/2026-09-05-room-composer-parity.md) | planned | 纯插件 | local-agent-member-dispatch-reliability（兄弟提案，非依赖） | RoomComposer 只持本地 `useState` 草稿、不读宿主输入机，导致官方+插件叠在输入机/输入坑位上的能力（撤回回填入框、undo/redo、斜杠、引用、图片、已待、IME、busy-Enter 排队/steer、权限/模型座位、ContextMeter 等）在 room 全丢；对齐需让 RoomComposer 落回输入机；2026-09-15 用户拍板推进，rc 波次后开工；member composer 维持自绘；2026-09-18 补工厂路线（alpha.2 `conversation.content` embedded factory），开工 spike 裁定主线 | 2026-09-18 |
| plugin | [宿主 0.1.5 适配与 UI 归位（host-015-adaptation）](active/2026-09-10-host-015-adaptation.md) | in-progress | 纯插件 | 无（rc.1 源码审计已完成） | 第一~三批已完成（S1 退役、入口归位，corner 槽实测偏离留 utilities）；第四批：subagent/catalog ✅、typert 维持绕行、readByteRange/guard 租约转 host-016、context-clearing/流式评估波后讨论 | 2026-09-15 |
| plugin | [宿主 0.1.6 适配（host-016-adaptation）](active/2026-09-15-host-016-adaptation.md) | in-progress | 纯插件 | host-015（承接第四批两项）·message-tools-projection-restore（子项） | breaking 五项（agent/created serial 化、ptc-runtime 改名、mobile anchor、profiles 收编）+ S12 + readByteRange/guard 租约；probe+degrade 双兼容、minHost 不动；**2026-09-18 重钉 alpha.2**（rc 跳票，用户拍板直接适配 alpha.2）：新增 breaking 八项 + 清单外六项已修（note 2026-09-18-host-016-alpha2-breaking-adaptation），ui-file-preview 共存裁定；全量 build/test 绿、实例冒烟过；**3080 合线与 npm 波均等官方 rc**（用户体验后判定 alpha.2 问题仍多），遗留四项见提案「遗留与放行条件」 | 2026-09-18 |
| plugin | [撤回恢复保持 assistant role：projection 通道（message-tools-projection-restore）](active/2026-09-15-message-tools-projection-restore.md) | planned | 纯插件（0.1.6 registerMessageProjection；0.1.5 degrade 回前缀） | host-016-adaptation（波次载体） | S12 退役路径：自有 restore 事件 + message projection 替代 user-role 前缀绕行；M0 持久化探针先行（S2 毒化教训） | 2026-09-15 |
| plugin | [member-channel 回调认证加固（member-channel-auth-hardening）](active/2026-09-10-member-channel-auth-hardening.md) | in-progress | 纯插件 | local-agent-member-channel（通道本体） | 0.1.5 移除 SubprocessHandle.pid 后第二因子丢失：M1 token-only 恢复 + 威胁模型明文；M2 内核 peer 凭证或上游 spawn-token seam 留档 | 2026-09-10 |
| plugin | [灵感画布（inspiration-canvas）](active/2026-09-13-inspiration-canvas.md) | planned | 纯插件 | mode-switcher（写作 preset / novel pack，M2 起接入自隐） | v1：工作区级灵感正本（右栏 tab + md 正本，M1 已交付）。M2–M4 路线已被 v2 重设计取代，见 canvas-space | 2026-09-16 |
| plugin | [灵感画布 v2：主题画布空间（canvas-space）](active/2026-09-16-canvas-space.md) | planned | 纯插件（上游候选：ui-workspace 分区 seam，不阻塞） | inspiration-canvas（v1，同包演进）· side-chat（M2 聊天供给） | 与工作区平级的主题画布空间：部署级画布（挂载/引用/索引工作区）+ 卡片板（碎片/问题/依据/资料/文档，提议卡幽灵态）+ 聊天经 side-chat 承接（单向探测）+ 问题卡引导深入 + md/html 渲染器。M1 已上 3080 | 2026-09-16 |
| plugin | [侧边对话：通用上下文聊天（side-chat）](active/2026-09-16-side-chat.md) | planned | 纯插件 | room（实现先例）· canvas-space（消费方，单向探测） | 全 preset 常驻右栏的随身 Agent：contextKey→agent 会话、通用引用协议（不透明文本块，不相互嵌套）、宿主服务 openWith（systemPrompt+tools 注入）、消息动作引用。M1–M3 已上 3080 | 2026-09-16 |
| plugin | [引用任意内容（quote-anything）](active/2026-09-16-quote-anything.md) | planned | 纯插件（上游候选：选区动作 seam，v1 DOM anchor+兜底绕行） | side-chat（投递目标之一，单向探测） | 选中即可引用：卡片详情/文件预览/聊天区选区 → 浮层 → 引用到当前会话（composer）或侧边对话（refs）；灵感画布三件套的引用层 | 2026-09-16 |
| plugin | [右栏内嵌浏览器（browser-pane）](closed/2026-09-13-browser-pane.md) | closed（放弃） | 纯插件 | 无 | 2026-09-18 用户拍板：用官方 0.1.6-alpha.2 的 Sidebar Browser（iframe 沙箱，随 web-app 默认挂载，`openTab('browser')` 公共缝），自研 CDP 帧串流不做；独占差异点「人机同视图+模型同 context 操作」官方自述不做，需求复燃可重开（M0 阈值表留档；`browser` kind 名已被官方占用，重开第一决策点） | 2026-09-18 |
| plugin | [TypeSafe 快速判断原语：模型工具 + 系统门控（typesafe-decision-primitive）](active/2026-09-20-typesafe-decision-primitive.md) | in-progress | 纯插件 | 无（M4 门控等 room/team 入站定案） | M1 core + M2 tool/skill 已交付（42 单测）；core 服务（`ctx.provide` + 凭据引用 + 具名问题注册表 + 超时/退避/熔断/缓存/决策日志）+ preset-composed `-tool` 行（`typesafe_judge` + `typesafe-decide` skill + prompt section）；结构探测零 `@khorsheed` 依赖边；配置只有 `apiKeyRef`，无 CLI、无 MCP；官方 `typesafe-ai` skill 已从实例移除 | 2026-09-20 |
| plugin | [灵感空间内容摄入：渲染抓取与链接解析（reader-ingest-capture-documents）](active/2026-09-20-reader-ingest-capture-documents.md) | planned | 纯插件 | reader 现状管线（复用提取/缓存/翻译）；capture 复用 browser-pane 关闭提案的评审沉淀 | 统一支点：一切来源归一化为 entry HTML，引用/翻译/位置记忆零适配覆盖；M0 arxiv-HTML + 链接解析器（DOI/Crossref，openreview 尽力）+ 抓取报错分类与状态统一，M1 capture 独立包（D1 定案）；文档解析整体推迟（D2，§4 备查） | 2026-09-20 |
| plugin | [工具 tab 展示：内置 / 插件 / MCP 分组 + 参数级详情（tool-catalog-display）](active/2026-08-29-tool-catalog-display.md) | planned | 纯插件 | capability-catalog（同属「能力目录」演进） | Phase 1 只做展示，不含导入 / 配置 / secret（那部分另立 add-mcp-manage） | 2026-08-29 |
| plugin | [add MCP：工具与技能里统一管理 MCP server（add-mcp-manage）](active/2026-08-29-add-mcp-manage.md) | planned | 需契约扩展（upstream 候选：复用 `@deepseek-ai/dsh-mcp-client`，不可独立安装则内建轻量 client） | tool-catalog-display（Phase 1 展示层） | Phase 2：粘贴解析 stdio/streamable-http + 凭据 secretRef（填一次不再明文）+ server/tool 级启停；UI 每次只加一个 server，配置本地一份（settings namespace） | 2026-08-30 |
| plugin | [masked credential proxy：假 key 换真 key（masked-credential-proxy）](active/2026-08-29-masked-credential-proxy.md) | idea | 未定（两种候选形态均在插件侧） | capability-catalog 的 skill env 注入（default-hide） | 防「模型被诱导出明文」的后续加固：窄代理换真 key 或短期句柄映射；本迭代不实现 | 2026-08-29 |
| plugin | [preset 可见性收口：worktrees/canvas 右栏入口、slash 搬家与 local-agent 定性（preset-visibility-rollout）](active/2026-09-17-preset-visibility-rollout.md) | in-progress | 纯插件（零上游改动） | 规范 [docs/plugin-visibility.md](../docs/plugin-visibility.md)；交付 note `2026-09-17-preset-visibility-rollout` | A1/A2/A3 已部署 3080（merge `197a5af4`，canary PASS）验收观察中、A5 已落地；A4 定性与 `/<harness>` slash 搬家本轮不做 | 2026-09-18 |
| plugin | [文件/工作树共享预览内核（preview-kernel）](active/2026-09-23-preview-kernel.md) | planned | 纯插件（零官方改动；仓库内新增共享包 + 显式跨包边） | `active/2026-08-21-file-view-html-rendering.md`（承接其 Tier0/Tier1 产物）· `closed/2026-08-26-local-files-browser.md:99`（其预告的「共享预览层抽提」）· `active/2026-08-23-worktree-governance.md`（worktrees git 面不动） | 新包 `@khorsheed/dsh-client-ui-content-preview` 收编 local-files/worktrees 的分叉预览（srcdoc 4→2、桥 3→2、DetailPane 3→2）；能力清单 A–H 逐条为验收口径；M0 提案已定稿，M1 内核待开工；官方若导出可复用渲染面则转 `closed（官方吸收）` | 2026-09-23 |
