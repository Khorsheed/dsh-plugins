# 工作模式（mode）：单实例多模式 —— preset + 自隐 + 模式管理器

- **分类**：plugin
- **状态**：方向已定（试点活体验证通过），落地拆分待排期
- **最后更新**：2026-09-10（六更·收敛：单实例多模式——场景包装进同一实例、按会话选模式；守卫重启退出产品线；eval 拿出本设计，待装置改造后重新评估）
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——「模式 / 切换 / mode / profile / preset」命中：[plugin-manager](../closed/2026-08-22-plugin-manager.md)（已废除的 loader 级行开关）、worktree-governance 的「三档切换」、local-agent 的「驱动模式 live/exec」、官方 `agent-presets` 的 preset 选择器。关联：[docs/roadmap.md](../../docs/roadmap.md)、[package-management](2026-08-21-package-management.md)（形态 A/B）、[capability-catalog](2026-08-26-capability-catalog.md)。
- **官方依赖**：主路径零 harness 改动（preset 官方原生；自隐是 client 惯用法；建会话 chip 现成）。可选上游增强：槽位可见性谓词（见「放弃的东西」）。

需求来源：产品路线图评审（2026-08-28～29）+ 2026-09-10 产品方向拍板。工作台按场景（日常/开发/写作…）组织，用户在**一个实例**里开不同会话、按会话选模式；不同模式呈现不同的可见插件与 agent 能力。

> **演化说明。** 初稿（08-26）：patch 层热切（无安全网，废弃）。二稿（08-28）：preset 承载 domain（当时因「preset 管不到 UI」废弃）。三稿（08-29）：profile 粒度 + ankh-guard 守卫重启，M0 已落地。四稿（09-10）：worktrees 自隐试点双线活体通过，preset++ 升主路径。本稿（09-10 晚，产品拍板）：**单实例多模式**——不搞多实例拓扑、不搞重启切换；场景包（web-basic/dev/novel…）全部装进同一实例，模式 = 会话级 preset + 可见插件子集；eval 例外（理由见下）。守卫重启（ankh-guard M0）退出产品线，保留为运维工具。

## 终局架构

```
一个实例（一个主 profile，插件并集常驻，永不因切模式重启）
├─ 场景包：以「可装进已有 profile 的集合包」形态安装（形态 A add 清单）
│    每个 pack 自带：插件清单 + 模式 preset + 模式元数据（preset id + 插件子集）
├─ 模式 = preset（会话级，官方原生）
│    建会话时 chip 选模式；会话级锁定；工具/提示词/skill 随 preset 授予
├─ 可见性 = 自隐约定（会话级，本仓模板）
│    UI 组件读当前会话的 preset，对照模式注册表决定显隐
└─ 模式管理器（轻量插件）
     设置页：模式列表 + 各模式的 preset/插件子集 + 单插件彻底开关（patch 热禁用）

eval：本次不纳入（维持独立 profile/实例），装置改造完成后重新评估
```

## 方案

### A. 场景包：从「独立 profile 模板」扩展为「可装入主实例的集合包」

现有 `profiles/web-*` 是形态 B（独立 profile）。单实例多模式要求同时具备**形态 A**（add 清单，成员装进运行中的 profile——package-management 提案已规划）。pack 新增**模式元数据**：声明该模式的 preset id + 插件子集（供注册表集中下发显隐映射）。合并前提：pack 的 patch 层为空（basic/dev 本就为空，零冲突）。

### B. 模式 preset 与「会话插件化」（官方原生，零 harness 改动）

- pack 自带 preset，`install` 时卸进 `$DSH_HOME/.agent-presets/` 名册（web-eval 已是此形态）；建会话时官方 chip 选择，会话级锁定。各模式 preset 一律以官方 `standard` 为底 copy 改造，差异只在模式特有部分。
- preset 自带工具行（`disabled` 休眠行语义 = 该 preset 授不授予此工具）；**工具行只进 preset、不进 profile 根**——会话间的能力差异由此产生，`tools: none` 类 pin 在新形态下不再需要。
- **会话插件化判据**（一个包能否只被 preset 引用、不全局挂载）：不 `ctx.provide` 任何服务（或包 isolate realm）、只注册工具/prompt、依赖的都是 host 注册表。装法：包进 profile 的 `node_modules`（可解析）但**不声明 `dsh.bundle`**（不自动挂载，类比 headless bundle 的 plain-dependency 形态），由各 preset 的 `agent.cordis.yml` 按 `name` 引用；0.1.5 插件列表里它呈现在该 preset 的「会话插件」组（2026-09-11 实测）。
- **全仓盘点（2026-09-11）**：可直接会话插件化的只有 `local-agent-tool-subagent`（已验证）；融合需拆的：**worktrees**（`tool.ts` + `worktrees` 服务）、**room**（3 个工具 + RoomService）——本次 basic/dev/novel 范围内仅此两个；mission/datasets/eval 同属融合但只在 web-eval，随 eval 缓拆；capability-catalog 等通用型保持全局 + fail-open 自隐，不拆。
- 拆法：把工具注册拆成**不 provide 的独立可挂载模块**，工具行 inject 全局常驻的宿主服务（consumer 行可裸放 preset，官方 tool-bash 同构）。打包形态默认**伴生包**（`@khorsheed/dsh-<x>-tool-*`，local-agent core/companion 先例，`check-plugin-independence` 认这个对）；包内第二 export 的形态待验证 loader 支持后再考虑。

### C. 自隐约定 + 模式注册表

- 机制（worktrees 试点双线验证）：槽位组件读 `useSessions` 的会话 preset 投影，不属于当前模式则 `return null`；缺省永远显示；无投影 fail-open。
- **映射集中下发**：模式注册表（模式管理器的 host 服务）从各 pack 元数据收集「preset ↔ 插件子集」，经 Remote 下发；插件读注册表判断显隐，不再逐包手配名单（worktrees 的 `visiblePresets` 是无注册表时的单机版先例）。
- 两条已知成本（推广时每包执行）：① preset 读取 key 跨宿主线不同（0.1.2 投影 / 0.1.1 顶层字段），双读兜底；② web 线 client 拿不到自己的 config，配置走 host → Remote。模板见 `.agents/notes/implemented/feature/2026-09-10-worktrees-badge-preset-gate.md`。
- 自隐是约定不是强制：list 槽位无可见性谓词，不接约定的插件会漏 UI——生态内可推，强制需上游。（已排查替代：`disabled: !!js` 的「条件启用」是平台门，表达式作用域读不到会话/preset 身份，不能承担声明式显隐。）

### D. 模式管理器（轻量，与重启/ankh-guard 无关）

`@khorsheed/dsh-mode-switcher`（沿名）：注册表服务 + Remote + 单插件彻底开关（patch 层 `disabled` 热生效 + 写成功后自刷新页面，服务「完全关掉某插件」场景）。**不设独立设置页**——「模式的插件子集」视图由 0.1.5 官方插件列表的会话插件组覆盖（按 preset 分组、状态徽标齐全、按需 compose 查看免费，2026-09-11 在 3092 实测社区工具行呈现正确）；模式管理器至多注册一个 `settings.plugins.tab` 薄页做注册表状态展示，非必需。无守卫重启、无凭证/preflight——单插件「关」方向爆炸半径极小。

### eval：本次不纳入（2026-09-10 拍板）

**范围决定：eval 拿出本设计，先只做 basic / dev / novel；待装置改造（named-provider、装置即条件）完成后重新评估。** eval 维持现状：独立 profile/实例、patch 层归 pack。

背景（重新评估时的依据）：

- **今天仍是实例级 pin**：`live` / `sandbox` / 端点等是 provider 行的实例级 config，并进主实例则互斥（pin 了 dev 残废，不 pin eval 失去「两格只差一个因子」）。
- **后门存在**：官方支持同产品多命名 provider 实例（host-plane 多行 + 唯一 `providerName`，preset 工具行按名指）。我们家族今天不支持（provider 名写死，`local-agent-codex/src/index.ts:138-140` 注册 `'codex'`，两行撞名）——改为从 config 读名是包级小改，列入候选；I4 把 provider 配置收进条件哈希（home.sha）后，eval 的实例隔离从「必须」软化为「偏好」。
- **即便如此仍建议独立**：测量纯净性（评测起 CLI/容器，与日常会话争资源污染测量）、爆炸半径（`danger-full-access` 委派不常与日常并存）、eval 是编排器驱动的批量装置而非聊天模式。

## 现状（关键实测事实）

| 事实 | 来源 | 含义 |
|---|---|---|
| preset 是自包含组合，工具行自带、`disabled` 是休眠模板行；「Host availability alone grants no tool」 | harness `presets/standard/agent.cordis.yml:199-219`、官方 skill《editing-cordis-compositions》 | 会话级工具授予官方原生 |
| 官方支持同产品多命名 provider 实例（host-plane 行 + preset 工具行按名指） | 同上 skill「Native product subagents」 | eval 的 provider pin 有 per-session 化的后门（包级改动） |
| 发布服务的行不能进 preset（跨会话消费者/撞名）；沙箱、审批、模型路由禁止 | 同上 skill plane rule | 服务与注册表永远实例级 |
| **活体验证**：自隐在 0.1.2-rc.1 与 0.1.1 双线通过（对照显示、名单内显示、名单外隐藏、切换三次稳定翻转、console 零错误） | worktrees 试点，截图 `scratch-screenshots/pilot-badge-*.png` | 「preset 即模式 + 自隐」实锤可行 |
| 会话 preset 读取 key 跨线不同（0.1.2 投影 / 0.1.1 顶层） | 试点探针实锤 | 自隐跨线兼容是每包成本（双读） |
| web 线 client 拿不到自身 config（boot 无注入） | 试点实测（harness `web/src/boot.ts:127`） | 配置一律 host → Remote |
| preset 切换限空白会话（首回合后锁定） | harness `agent-presets` | 模式对会话是创建时选择，锁定期一致 |
| 一个实例只能跑一个 profile | harness `profile-boot` | 「多模式」必须装在同一个 profile 里（并集），多 profile ≠ 多模式 |
| 0.1.5 官方插件列表分「会话插件 / 全局插件」两组；社区工具行在会话插件组呈现正确（短名标题、状态徽标、计数同步），按需 compose 查看、preset 热发现 | 2026-09-11 3092 实测（`scratch-screenshots/pilot-015-session-plugins*.png`） | 「模式的插件子集」视图官方已覆盖，模式管理器不设独立设置页 |
| 只有不发布服务的工具行能直接进 preset；`ctx.provide` 的包（worktrees/mission）整包进 preset 被 isolate-realm 规则拒绝 | 同上实测 | M4' 融合包拆工具行是硬前提，拆法 = 工具模块不 provide |
| 「条件启用」= `disabled: !!js` 用 Loader 表达式作用域求值，作用域只有 `process` 等全局，**读不到会话/preset 身份**（求值失败才落 conditional 标签） | harness `agent-presets/composition-inventory.ts`、`plugin-inventory` | 平台/环境门，不能做声明式按会话显隐——自隐约定不变 |

## 里程碑

- **M0 ankh-guard 前置**（0.2.0）✅ 已落地（`0f776cc`）——最终定位：运维工具，不进产品线。
- **M1' 自隐试点** ✅ 已落地（worktrees `visiblePresets` 门 + 双读，待提交；0.1.5 复验并入迁移验收）。
- **M2' 模式基础设施**：① 模式管理器包 `@khorsheed/dsh-mode-switcher`（注册表 + Remote + 单插件彻底开关，无独立设置页）；② pack 模式元数据（preset id + 插件子集 + 专属/通用语义）；③ 各模式自带 preset（以 standard 为底；dev preset 带委派工具行；novel 新建写作 preset）；④ pack 的形态 A 安装形态（可装进已有 profile）。
- **M3' 自隐推广**：dev 专属 UI 接注册表显隐（worktrees 徽标从手配名单改读注册表；room 面板、local-agent 家族 UI 评估归属）；helper 包（`useSessionPreset`）取舍在此决定。
- **M4' 工具行解耦**（范围内仅两包）：① worktrees 工具行拆为伴生包（工具 inject 全局 worktrees 服务）；② room 工具行同理。mission/datasets/eval 随 eval 场景缓拆。local-agent named-provider 支持为 eval 预备候选，不排期。
- 落地待讨论：模式清单与边界（novel 的第一个 preset 内容）、自隐推广顺序、helper 包取舍、形态 A 的安装命令形态。

## 验收标准

- 同一实例：dev 模式会话有 worktrees 徽标/mission 入口，写作模式会话没有；切会话界面干净翻转。
- 设置页列出全部已装模式及其 preset + 插件子集；单插件彻底开关热生效。
- 历史会话在任何模式下打开不报错、渲染不缺失。
- 不接自隐约定的插件缺席不影响他包；卸载任一自隐包回到「永远显示」。
- hygiene / note / 翻译配对 / `check-plugin-independence` 门禁绿。

## 风险 / 放弃的东西

- **放弃：patch 层热切做模式切换（初稿）**——无安全网。
- **放弃：多实例拓扑与守卫重启做日常切换（三稿）**——「切场景」没有重启动作；ankh-guard M0 退为运维工具。
- **放弃：eval 并入主实例**——装置 pin 实例级；named-provider 后门保留为候选。
- **放弃：per-session UI 强制隔离**——槽位无可见性谓词；自隐是约定，强制需上游 `visibleWhen`。
- **自隐是约定**：新插件不接就漏 UI。缓解：注册表集中下发 + helper 包 + AGENTS.md 约定。
- **跨版本线兼容成本**：宿主 client store 形状是内部 API（0.1.1/0.1.2 key 差异实证），每包双读 + compat 标注。
- **超集资源代价**：主实例所有插件服务常驻；近亲场景可接受，重装置（eval）不并入。
- **模式对会话是创建时选择**：已存在会话保持原模式（官方锁定语义，渲染器恒在无一致性问题）。
