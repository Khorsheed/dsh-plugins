# 包管理：分类、整合包形态与发布流程（package-management）
- **分类**：plugin（交付物为可安装单元：薄元包 / profile 模板；发布流程落 docs/）
- **状态**：planned（包盘点进行中）
- **最后更新**：2026-08-21
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——无同意图提案。承接 [plugin-ops-model note](../../.agents/notes/implemented/process/2026-08-20-plugin-ops-model.md) 的 open items（整合包命名与版本策略）；`docs/ops.md` 第 37 行的薄元包规划是本提案的起点，但实施前实测发现「当前 CLI 不支持薄元包」这一缺口，形态 C 依赖 seam 提案 [upstream-meta-pack-reconcile](2026-08-21-upstream-meta-pack-reconcile.md)。
- **官方依赖**：形态 A/B 纯插件（今天可交付）；形态 C 需契约扩展（upstream 候选，见 seam 提案）。

## 目标

把「插件分类 → 整合包组合 → 发布流程」做成一条可执行的链路：20 个包各有清晰的层级归属；面向人群的整合包（dsh-eval 首发）能以一条命令装全家、任一 bundle 单独装卸载；发布从「没跑过 npm」到「每包独立线 + 整合包随成员变更 bump」全程有章可循。最终交付物形态可选：形态 A（add 清单脚本）、形态 B（profile 目录模板）、形态 C（npm 薄元包，需上游 seam）。

## 现状（包盘点 + 官方契约实测，2026-08-21）

### 包盘点初稿（进行中，落点为各包 package.json 元数据 + README 总表）

| 层级 | 包 | 形态 | 说明 |
|---|---|---|---|
| 基础层 | context-guard | client | 上下文占用提醒 |
| 基础层 | message-timeline | client | 消息时间线 |
| 基础层 | client-message-tools | client | 撤回 / 重发 |
| 基础层 | client-session-title-edit | client | 会话标题编辑 |
| 基础层 | taskpilot | client | 后台任务 dock |
| 基础层 | ui-shortcuts | client | 快捷键 |
| 基础层 | whalesong | client | 状态氛围 |
| 基础层 | file-preview + client-ui-file-preview | host + client | 会话文件抽屉（评测亦需要，主标签 base） |
| 基础层 | local-agent 家族（core + 5 harness + tool-subagent） | host + client | 本地编码代理委派 |
| 领域层 | datasets | host + client | 版本化数据集存储（评测 / 通用） |
| 领域层 | lab | host | 受控实验单元（评测 / 研究） |
| 领域层 | mission | host + client | 任务管理（评测用法） |
| 平台运维 | ankh-guard | host 工具 | 重启闸 / 看门人（不进终端用户整合包） |

发布状态实测（2026-08-21，registry JSON 直查；`npm view` 在本环境超时不可用，以 registry 为准）：**ankh-guard 已发布（npm latest = `0.1.0-rc.8.9`），其余 19 包未发布**；prod（3080）17 包在跑、全部为 `file:` tarball **直接依赖**（见下）；datasets / lab / mission 三包仍在开发、未进 prod。首发除 local-agent 家族按依赖序同发外无顺序问题；ankh-guard 已过首发线，后续发布需超过 `0.1.0-rc.8.9`。

#### 宿主兼容与发布状态矩阵（M1 盘点基准表）

| 包 | minHost | latestHost | npm 已发布 | 进度 |
|---|---|---|---|---|
| context-guard | rc.8 | rc.8 | 未发布 | prod |
| message-timeline | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| client-message-tools | rc.8 | rc.8 | 未发布 | prod |
| client-session-title-edit | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| taskpilot | rc.8 | rc.8 | 未发布 | prod |
| ui-shortcuts | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| whalesong | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| file-preview | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| client-ui-file-preview | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| local-agent | rc.8 | rc.8 | 未发布 | prod |
| local-agent-kimi | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| local-agent-codex | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| local-agent-claude-code | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| local-agent-dsh | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| local-agent-dsh-headless | rc.6 | rc.8（prod 实测） | 未发布 | prod |
| local-agent-tool-subagent | 无 | 无 | 未发布 | prod |
| datasets | rc.6 | rc.8（tab 冒烟声明） | 未发布 | dev-only |
| lab | rc.6 | rc.6（缺省 = minHost） | 未发布 | dev-only |
| mission | rc.6 | rc.8（tab 冒烟声明） | 未发布 | dev-only |
| ankh-guard | rc.6 | rc.8（prod 实测） | **0.1.0-rc.8.9** | prod |

- **`latestHost` 语义**（新增列）：`minHost` = 硬下限（低于此不可用，gate）；`latestHost` = 已验证 / 声明兼容的最高宿主线（信息性上限，**不 gate**；缺省 = minHost）。建议落为 package.json 可选字段 `dsh.compat.latestHost`（M1 实施），与各包 README 的 Compatibility 段落保持同步。表中 prod 包 latestHost = rc.8 为「prod 线实测」推断（prod 宿主当前 rc.8，2026-08-21 核）；datasets / mission 的 rc.8 来自 compat notes 的 tab 冒烟声明；lab 未进一步实测取缺省。注意 local-agent 家族 harness 的 minHost 虽为 rc.6，但 core（rc.8）是它们的依赖——**家族实际地板是 rc.8**。
- **npm 发布版本**：以 registry 为准（与 package.json `version` = 下一发布线区分开）；目前仅 ankh-guard 有值。
- **GitHub 地址**：全部包同仓 `github.com/Khorsheed/dsh-plugins`，各自目录 `packages/<dir>`——`repository` 字段是单一事实源，盘点表不逐行重复；**message-timeline 缺 `repository` 字段**，M1 顺手补齐。
- **profile / bundle 归属**：19 个 bundle（声明 `dsh.bundle.patch`，自挂载、进 bundles 层）+ 1 个 plain（`local-agent-tool-subagent`，无 patch、家族内部行，由 kimi 的 patch 挂载；属于 profile 依赖但不属于 bundles 层）。

### 官方契约实测（决定整合包形态的关键事实）

1. **`dsh plugin` 是 pnpm 薄转发**（harness `apps/cli/src/plugin.ts`）：把参数原样转发到 profile 目录的 pnpm，成功后跑 `reconcilePlugins`——**只扫描 profile package.json 的直接依赖**，把声明了 `dsh.bundle.patch` 的追加进 `dsh.profile.bundles` 层；被移除或不再声明 bundle 的从层里剔除。
2. **`loadProfile` 只读 `dsh.profile.bundles` 列表**（harness `packages/boot/app-boot/src/profile.ts`），逐名解析 patch 层；不自动扫描 node_modules。列表中无 `dsh.bundle` 的包直接 fail loud。
3. **`pnpm add <pack>` 只把 pack 写进 profile 直接依赖**，pack 的子插件是传递依赖，不出现在 profile `dependencies` → reconcile 扫不到 → **装了但不会挂载**。这就是 `docs/ops.md` 薄元包规划与当前 CLI 之间的缺口。
4. **实证**：prod profile（`$DSH_HOME/profiles/web/package.json`）17 个插件全部是直接依赖、bundles 层逐名列出——「每个 bundle 可自由装卸」的物理前提是**每个插件都是 profile 的直接依赖**（`local-agent-tool-subagent` 无 patch，是家族内部行，由 kimi 的 patch 挂载，不在 bundles 层）。

## 方案

### 分层：分类落点

- 每个包 package.json 加可选元数据 `dsh.category`：`base` / `domain` / `ops`（主标签唯一；`domain` 包可再加 `dsh.domain` 备注，如 `eval` / `novel`）。不新增 checker 约束（未知字段无碍），README 总表同步标注。
- 边界包（如 file-preview 对同时服务评测）主标签取基础层，整合包侧显式包含即可，不搞多标签。

### 分发形态（按可分发性从低到高）

**形态 A：add 清单（今天可用）**——每个插件独立发布；整合包 = README 里一组 `dsh plugin add <p1> <p2> ...`（pnpm 支持多包）。每个插件成为直接依赖 + 自动 reconcile；`dsh plugin remove <pkg>` 卸单个。**自由装卸载完全成立**，只是「一条命令」靠脚本/文档。

**形态 B：profile 目录模板（今天可用，推荐首发）**——整合包 = 一个现成 profile 目录（git 仓库或 tgz）：写好的 `package.json`（所有成员为直接依赖，`^` 或 `file:` 版本）+ `dsh.profile.bundles` 层 + README。用户放到 `$DSH_HOME/profiles/<name>/` 后 `dsh plugin --profile <name> install` 装依赖、`dsh --profile <name>` 启动。成员仍为直接依赖 → 单独 add/remove 照常。这是今天唯一「一条命令装全家 + 每个 bundle 自由卸」的可分发形态。

**形态 C：npm 薄元包（目标形态，需上游 seam）**——发布 `@khorsheed/dsh-eval-pack`（只声明 dependencies + README，无 build 无 patch）。要让 `dsh plugin add <pack>` 全成员挂载且成员可卸，需要上游 `reconcilePlugins` 支持依赖闭包（设计见 [upstream-meta-pack-reconcile](2026-08-21-upstream-meta-pack-reconcile.md)）。上游落地前不可用。

### 演进路径

M1/M2 先落分类与流程文档 → M3 用形态 B 首发 `dsh-eval`（不等上游）→ M4 上游 seam 落地后转形态 C → M5 `dsh-novel` 等小说领域插件出现再出。

### 发布流程管理

- **每包独立线**：build + test + hygiene/plugins 全绿 → `scripts/pack-dist.ts` 出 tgz → 验证 tarball → `npm publish`（版本必须超过 registry 已发布线）；19 包首发无 403/409 风险，ankh-guard 已发布（0.1.0-rc.8.9）、后续发布需超过该版本；唯一顺序约束是 local-agent 家族同发、按依赖序。
- **整合包规则**：`^` 范围引用成员；**只在成员增删或跨大版本线时 bump**（比 ops.md「随任一子包发布而 bump」更省——caret 范围下子包 patch 发布不需要动 pack）；无代码无 build，但发布前同样跑 hygiene + pack-dist 出 tgz + 空 profile 冒烟（装、卸单个、再起）。
- **首发整合包 dsh-eval 组成**（初稿）：datasets + lab + file-preview 对 + client-message-tools + taskpilot + 基础层全体（除 ankh-guard）。

## 里程碑

- M1：包盘点定稿——分类表 + `dsh.category` + `dsh.compat.latestHost` 字段 + README 总表 + `repository` 补齐（进行中）
- M2：流程文档——`docs/ops.md` / `docs/publishing.md` 增补整合包发布规则与首发顺序
- M3：dsh-eval 整合包（形态 B：profile 模板 + 安装脚本 + README，空 profile 冒烟）
- M4：上游 seam 落地 → 形态 C 薄元包发布（`@khorsheed/dsh-eval-pack`）
- M5：dsh-novel（等 1–2 个小说领域插件）

## 实现记录（随实施追加）

- 前置盘点与契约实测（2026-08-21，本会话）：19 包未发布、ankh-guard 已发布（registry 实测 0.1.0-rc.8.9，初稿误判全未发布系 `npm view` 超时所致）；prod 17 包全直接依赖；`reconcilePlugins` 只扫直接依赖（`apps/cli/src/plugin.ts`）；`loadProfile` 只读 bundles 层（`packages/boot/app-boot/src/profile.ts`）→ 薄元包需上游 seam。
- 2026-08-21 修订：矩阵新增 latestHost（信息性上限，缺省 = minHost）与 npm 已发布列；GitHub 同仓单行记录 + message-timeline 缺 `repository` 字段；宿主兼容语义与 prod 线（rc.8）推断见上。
- （实施时登记相关 Agent Note / PR / 包名）

## 验收标准（done 判定，绑定可插拔交付）

- 分类机械可查：每个包 `dsh.category` 与 README 标注一致，盘点表入 README 总表。
- 宿主兼容盘点入表：每包 `minHost` / `latestHost` 与 README Compatibility 段落一致（latestHost 缺省 = minHost）；全包 `repository` 字段齐备（当前 message-timeline 缺）。
- dsh-eval 整合包：空 profile 一条命令（M3 用脚本/模板、M4 用 `dsh plugin add <pack>`）装全家；任一 bundle 单独 `remove` 后其余不受影响、boot 零错误；preflight 无 FAIL。
- 发布全链路走通：至少一个包完成 pack-dist → npm publish → 一次性目录消费者冒烟；整合包按 M3/M4 形态可复现装出。

## 风险 / 放弃的东西

- **上游不接受形态 C** → 长期走 A/B，把「薄元包」登记进 upstream seam registry（S 条目），不阻塞整合包交付。
- **分类主观性**（datasets 既基础又评测）→ 主标签唯一 + `dsh.domain` 备注，避免标签爆炸。
- **pack 的 `^` 范围漂移**（成员大版本升级引入不兼容）→ 成员兼容性由各自 `dsh.compat` 标注；pack 在跨大版本线时 bump 收紧范围。
- **放弃**「胖整合包（自带 patch 插入全部子行）」：卸单个会与 pack 拥有的行打架，违背每包一行自挂载约定（plugin-ops-model note 已否决，本提案沿用）。
