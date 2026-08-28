# 工作模式切换（mode-switcher）

- **分类**：plugin
- **状态**：idea
- **最后更新**：2026-08-29
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——「模式 / 切换 / mode / profile / preset」命中：[plugin-manager](../closed/2026-08-22-plugin-manager.md)（已废除的 loader 级行开关）、worktree-governance 的「三档切换」、local-agent 的「驱动模式 live/exec」、官方 `agent-presets` 的 preset 选择器（不同粒度，见「非目标」）。**无「按 domain 切换整套插件组合」同意图提案。** 关联：[docs/roadmap.md](../../docs/roadmap.md) 的四层模型与决策 9、[package-management](2026-08-21-package-management.md)（domain 整合包形态）、[capability-catalog](2026-08-26-capability-catalog.md)（切换后核对组合的手段）。
- **官方依赖**：纯插件。切换动作复用本仓 `@khorsheed/dsh-ankh-guard` 的 `restart`（凭证 → preflight → watchdog → canary，已在 `dsh-web-basic` 的 `restart-into-web-basic.sh` 上线验证）；profile 枚举读 `$DSH_HOME/profiles/`；UI 走 `settings.section` 槽位；快捷键复用 `@khorsheed/dsh-ui-shortcuts`。**零 harness 改动。**

需求来源：产品路线图评审（2026-08-28～29）。工作台要服务开发、评测、写作等不同 workflow，它们的插件组合、界面与工具都不同。本提案是「换一套组合」这个动作在用户侧的入口。

> **两次重写说明。** 初稿（2026-08-26）把模式建模为**插件行的活跃性**，用「写 profile 用户 patch 层 + config HMR」热切。二稿（2026-08-28）改用官方 `agent-presets`，把模式做成会话级组合。本稿回到 profile 粒度，但机制是 **ankh-guard 守卫重启**——理由见「放弃的东西」：preset 管不到 client UI，会造成「看得见用不了」；而 patch 层 overlay 没有 preflight 这类安全网。

## 目标

让用户在界面上切换工作模式，一个模式 = 一个 profile = 一套插件组合。切换后界面与工具完全对应该模式——`novel` 模式下就是没有 mission tab、没有 worktrees 徽标。

1. **入口**：设置里列出可用 profile（`$DSH_HOME/profiles/` 下的目录），显示当前所在模式，一键切换。
2. **安全**：切换走 ankh-guard 的完整闸门——preflight 在子进程里把目标组合完整 boot 一遍，**起不来就绝不停当前实例**；watchdog 托管新实例、失败回滚；canary 复检。
3. **可逆**：切过去能切回来，界面无残留，会话数据跨切换存活。
4. **交接体验**：同端口拉起，浏览器刷新原地址即可，不需要记新端口——`restart-into-web-basic.sh` 已验证这条路径。

非目标 / 明确不做：

- **不做免重启切换**。这是刻意取舍：client UI 挂在 profile 的 client 槽上，preset 管不到它，免重启就必然「看得见用不了」。几秒重启换界面与工具完全一致，划算。
- **不与 agent preset 竞争**。preset 是**同一 profile 内的 agent 变体**（`standard` / `review`），本提案换的是整套组合。两者不同粒度，可叠加使用。
- **不自己实现重启**。凭证、preflight、watchdog、canary、回滚全部是 ankh-guard 的既有能力，本插件只提供入口与呈现。
- **不做 profile 编辑**。创建/修改 profile 是 domain 整合包的事（见 package-management），本插件只切换已存在的。
- **不做同实例并行模式**。一个实例一个模式；需要同时开发与评测时用独立实例（评测常驻 :3082 独立 `$DSH_HOME`）。

## 现状（官方契约实测 / 已有实现）

| 事实 | 来源 | 对本提案的含义 |
|---|---|---|
| `ankh-guard restart --port <p> --start "<cmd>" --profile <name>` 已上线 | `dsh-web-basic/scripts/restart-into-web-basic.sh` | 切换动作是现成的，`--start` 里换 `--profile` 即可 |
| 六道闸：绿色凭证 → **preflight 深度干跑** → 记录 → watchdog 停旧启新 → canary PASS → 失败回滚 | `packages/ankh-guard/README.md` | 安全网齐备；preflight 是「切不过去不伤当前实例」的保证 |
| 重启后 canary 在新实例上跑，凭证与检查点存状态文件、跨重启存活 | 同上 | 切换结果可自动复检 |
| 发起方会随宿主一起断开，watchdog 在原端口拉起 | `restart-into-web-basic.sh` 说明 | 前端需要一次强制刷新；重启报告可寻址回发起会话 |
| skill / tool 注册表是 host + per-scope 分层，profile 挂载的落 global 层 | 官方 `dsh-skill` README | **profile 挂载的挑不掉**——这正是隔离必须走 profile 的技术原因 |
| 会话数据存 `$DSH_HOME`，与 profile 组合无关 | 官方会话持久化 | 切换不影响历史会话的数据；但旧会话在缺少对应插件的组合下渲染需实测 |
| 沙箱会话里发起的监督会继承沙箱 | `ankh-guard` README 已知限制 | 切换入口若从受限会话触发需给出明确提示 |

## 方案

一个独立插件包 `@khorsheed/dsh-mode-switcher`（host 半 + client 半）。

### 1) 模式清单 = profile 清单

枚举 `$DSH_HOME/profiles/` 下的目录，读各自的 `package.json` / `cordis.yml` 取显示名与成员摘要。不引入独立的模式定义文件——**profile 目录本身就是事实源**。

### 2) 入口：设置里的模式区

列出可用 profile，标出当前所在的那个，每项一键切换。切换前展示将要发生什么（停止当前实例 → preflight → 同端口拉起 → 刷新页面），并明确提示「本会话会断开，刷新后回来」。

### 3) 切换执行

host 半调 ankh-guard 的 restart 通道，参数照 `restart-into-web-basic.sh` 的形态。preflight 失败时**不停实例**，把失败原因（哪几行组合起不来）原样呈现给用户。

### 4) 切换后的自我刷新

新实例在原端口起来后，前端检测到连接恢复即强制刷新（client 名录变了必须整页重载）。ankh-guard 的重启报告可寻址回发起会话，切换完成的通知落在那里。

### 5) 快捷键（可选）

经 `ctx.shortcuts.registerAction` 注册「切到某模式」，键位可配；探测不到 `ui-shortcuts` 时静默降级。

## 里程碑

- **M1 切换闭环**：模式清单 + 一键切换 + preflight 失败呈现 + 切换后自我刷新。
- **M2 可逆性与安全性验收**：见下方判据。
- **M3 快捷键**与切换历史（最近用过的模式）。

## 验收标准（done 判定，绑定可插拔交付）

- 从 `web-basic` 切到 `dsh-dev`：同端口交接，刷新后是 dev 界面（worktrees 徽标、mission tab 出现）。
- **切回 `web-basic`**：界面回到 daily 形态，无残留组件、无报错空槽。
- 故意坏掉目标 profile 的组合（改坏一行 patch YAML）：**preflight 拒绝且当前实例不停**，失败原因可读。
- 会话数据跨切换存活：切过去再切回来，之前的会话仍可打开。
- 切换后 `capability-catalog` 列出的工具与该 profile 相符（dev 有 mission / 委派工具，web-basic 没有）。
- 未装本插件的环境行为逐字不变；卸载后入口消失、无残留。
- hygiene / note 格式 / 翻译配对门禁绿；`check-plugin-independence` 绿。

## 风险 / 放弃的东西

- **放弃：agent preset 承载 domain（二稿方案）。** preset 只组合 tools / prompt sections / skills，**client UI 挂在 profile 的 client 槽上、preset 管不到**——novel 模式下 mission tab 仍在，「看得见用不了」。要隔离 UI 就得把每个 feature 包拆成 host/client 两行，改动落在每个包上。另有两条官方约束叠加：会话零产出才能切、子 agent 继承父组合。preset 保留在「同一 profile 内的 agent 变体」这个它本该在的粒度上。
- **放弃：profile 用户 patch 层 + config HMR 行开关（初稿方案）。** 它没有 preflight 这类安全网——写坏了 overlay，下一次组合就炸，而炸的时候实例已经在跑。守卫重启把「验证」放在「停止」之前，这是本质区别。该路线的唯一消费方消失后，`plugin-manager` 也随之废除。
- **一个实例一个模式。** 需要并行时开独立实例，评测本就该如此（环境隔离是评测要求）。
- **重启期间不可用。** 秒级，但确实中断；长任务跑着时不该切——入口需要检测活跃 run 并警告。
- **旧会话在新组合下的渲染未验证。** 会话数据与 profile 无关，但一个在 dev 模式下产生的会话（含 mission 卡片等）在 daily 模式下打开会怎样，需实测；预期是降级为普通消息，但要确认不报错。
- **沙箱会话发起的切换会继承沙箱**（ankh-guard 已知限制），入口需给出明确提示而非静默失败。
