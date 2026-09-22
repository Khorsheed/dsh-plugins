# preset 可见性收口：worktrees/canvas 右栏入口、slash 命令搬家与 local-agent 定性（preset-visibility-rollout）

- **分类**：plugin
- **状态**：in-progress（A1/A2/A3 已实施并部署 3080、验收观察中；A5 已落地；A4 定性修正与 `/<harness>` slash 搬家本轮不做，见「不做」清单）
- **最后更新**：2026-09-18
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`。统一规范在 [docs/plugin-visibility.md](../../docs/plugin-visibility.md)（本提案是它的实施清单，不重复规范本身）；[mode-switcher](2026-08-26-mode-switcher.md) 是入口设计、[canvas-space](2026-09-16-canvas-space.md) 与 [inspiration-canvas](2026-09-13-inspiration-canvas.md) 是各自包的界面，均非同一意图；交付记录见 [implemented/feature/2026-09-17-preset-visibility-rollout](../../.agents/notes/implemented/feature/2026-09-17-preset-visibility-rollout.md)。无重复，新建。
- **官方依赖**：纯插件（零上游改动；preset 组合数据经 `pluginInventory` Remote 探测）


2026-09-17。状态：A1/A2/A3 已实施并部署 3080（merge `197a5af4`，deploy-3080 OK，canary PASS），验收观察中；A5 已落地（2026-09-18，见下）。

**3080 preset 治理（2026-09-18，协调者拍板）**：3080 的「开发模式」preset 曾本地补挂 mission/datasets/eval 三行（与本仓 web-dev 的 dev preset 漂移），导致评测 UI 出现在开发会话。处置：新建 `dsh-eval`（评测模式）preset（`~/.dsh-official/.agent-presets/dsh-eval/`，配方 = web-eval pack 的 eval preset：datasets-tool `authoring` + eval-tool，不挂 mission-tool 即 R6），dev preset 摘掉三行。名册 discovery 无缓存（`list()` 每次重读文件系统），立即生效无需重启；preset 建会话时锁定，存量会话不受影响。效果：开发模式新会话失去题集 chip / 任务 tab / 实验室 tab / 三个 slash，评测模式新会话全部获得。

## 背景

统一规范已立：[docs/plugin-visibility.md](../docs/plugin-visibility.md)——判据轴是「**surface 的内容绑定谁**」，不是座位在哪。内容绑定会话且组合里有可 keyed 行的，按官方 preset 组合数据自隐（fail-open）；内容跨会话/绑定实例的，归安装层或刻意常驻。

全仓盘点（2026-09-17，两个调研代理复核）后的矩阵确认：工具与 prompt 注入已全部 preset 化（5 个伴生包 + canvas `./agent` + sidechat per-agent-scope），剩下的缺口都在 UI 入口与 slash 面。本提案是缺口的实施清单，**随 0.1.6 rc 适配窗口一起发**。

## 行动项

### A1. worktrees 右栏 tab 自隐

现状自相矛盾：会话头徽标已按 preset 自隐（`packages/worktrees/src/client/Badge.tsx:111-119`），右栏 tab 却无条件注册（`packages/worktrees/src/client/index.ts:166`）。

改法：`RegistrationToggle` 套 `ctx.sidebarRightTabs.register`，判据与徽标完全一致（`visiblePresets` 手配 override → 官方组合数据 → fail-open；`@khorsheed/dsh-worktrees-tool` 行常量已在 `dsh.references`）。tab body 的 keyed 槽注册**不动**——类型注销后 entryKey 退到 kind、渲染 host 的 `tab.unavailable` fallback（host 注释明写是合法状态），且已打开 tab 按会话存储，未授予会话的布局里本就没有它。

### A2. canvas 右栏 tab 只在 writing 模式出现

工具+prompt 已 preset 化且 3080 已实配（`dsh-writing` user preset 含 `canvas-agent` 行，3080 profile patch 已停根行）。缺 UI 入口收敛。

改法：`RegistrationToggle` 套 `ctx.sidebarRightTabs.register`（`packages/canvas/src/client/index.ts:219`），判据模块新建 `src/client/preset-visibility.ts`（room 模板）。

**判据必须双查，这是 canvas 与 A1 的本质差异**：`canvas-agent` 行有两种合法挂载形态——profile 根挂（社区默认，`cordis.patch.yml:22-26`）或 preset 挂（writing 配方）。只查 preset 组会让根挂部署下 UI 永隐（组合读得到、行不在 → fail-closed，正是 2026-09-16 事故的完整版教训）。判据 = 「`pluginInventory.list()` 的 **entries 根行**含 `@khorsheed/dsh-canvas/agent` ∪ 当前会话 preset 组行含它」∪ 一切读不到 fail-open。实施时先验证 preset 行在 inventory 里的 `moduleName` 形态（子路径 export 行名解析，读 3080 `~/.dsh-official/.agent-presets/dsh-writing/agent.cordis.yml:263-264` 核对）。

### A3. slash 命令搬进伴生包（/eval /datasets /mission）

host 复核（0.1.5 线）：`CommandDefinition` 无任何可见性谓词，client 补全渲染对 host 行也无过滤缝——但**官方先例就是答案**：`/goal` `/plan` `/compact` 靠「注册搬进 preset 行、落进 preset scope 层」实现条件显隐（`web-app/cordis.patch.yml:409-430` 在 host 面 disabled，shipped preset 的 agent.cordis.yml 挂载）。client 链路天然适配：补全目录按会话拉取、`agent-preset/selected` 自动重拉。

改法（零上游改动）：
- `/eval`（`packages/eval/src/slash.ts:586`）→ eval-tool；`/datasets`（`packages/datasets/src/index.ts:77`）→ datasets-tool；`/mission`（`packages/mission/src/slash.ts:395`）→ mission-tool。
- companion 内 `ctx.inject(['commands'], c => c.commands.register(...))`（plan-mode 先例），handler 经 `ctx.get('<core 服务>')` 委托；core 服务须 `ctx.provide`（datasets 已有，eval/mission 实施时确认补齐）。
- core 包摘掉 profile 面注册（breaking：slash 只在授予会话可见——这正是目的）。
- 兜底：handler 里 `agentPresets.composedPreset(invocation.agent.ctx)` + `compositionInventory()` 复查，未授予返回错误文案（便宜则加）。

### A4. local-agent 家族：定性修正，不做自隐

矩阵轮把 4 张 provider 设置卡 + member composer 标为缺口，按判据轴复核后**修正为刻意常驻**：

- 设置卡内容 = 实例级 provider 凭据/开关，**绑定实例而非会话**；设置页是全局页，打开时无当前会话 → fail-open 恒显示 → preset 判据对它既无定义也无效果。装不装家族由 profile 决定（web-basic 未装），这是正确且唯一的层。
- member composer / dock 已有**内容门**：select 只命中家族委派会话，standard 会话里本就不接管。

结论：不动代码，规范文档的「slash 命令与设置卡」行随本次实施更新为此定性。

### A5. writing preset 版本化（已落地，2026-09-18）

~~`dsh-writing` preset 本体是 3080 user root 资产，不在任何 git 仓~~ 已正本化：3080 名册里 prod 拥有的 preset 全部有 git 正本——`dsh-writing` 在 `profiles/web/presets/dsh-writing/`；`dsh-eval` 组合跟随 web-eval pack 的 eval preset；`dev` 归 web-dev pack 的 install/update 脚本。同步走 `profiles/web/scripts/sync-presets.sh`（幂等、备份、名册无缓存即时生效），规则写进 `profiles/web/README.md` 与 `docs/ops.md`「3080 的 preset 名册」节。提案原设想是 canvas 包自带 preset + install 脚本；落地时选了 3080 部署正本区（`profiles/web/`），因为 dsh-writing 是部署资产而非 canvas 包的资产。

## 验收标准

- A1/A2：web-dev 实例里，standard preset 会话不见 worktrees 右栏 tab（guide 页也无），dev preset 会话可见可开；无会话首页 fail-open 可见。canvas 在 3080：非 writing 会话不见入口，writing 会话可见；**根挂形态的部署（社区默认）入口常驻**——双查判据的回归要点。
- A3：standard 会话的 slash 补全无 `/eval` `/datasets` `/mission`，eval/dev preset 会话有；切换 preset 后补全自动刷新；未授予会话里直接执行（绕过补全）返回守卫文案。
- 各包 `pnpm run build && pnpm run test` 绿；`pnpm check:plugins`、`pnpm check:hygiene` 绿；新增判据带单测（fail-open 各路径 + 双查真值表）。
- `docs/plugin-visibility.md` 的「各维度细则」slash/设置卡行更新为实施后的现状。

## 风险 / 放弃

- **slash 搬家是 breaking**：未授予会话失去补全里的命令（目的本身）；直接敲全名的执行路径由兜底守卫接住。
- **canvas 双查判据依赖 inventory 行名形态**：子路径 export 行的 `moduleName` 若与预期不符，判据恒假即永隐——实施第一刀先验证这个，验证不过则 A2 缩回「entries 根行存在才显示 + preset 组存在才按会话判」的保守形。
- **不做**：local-agent 家族代码（A4 定性）；`/<harness>` `/local-agent` slash（运行时动态注册，搬家牵连 harness 回调，单列）；上游 `available?(agent)` 谓词提案（记 docs/upstream-proposals/ 候选，不阻塞本轮）。
- helper 仍不抽取：本轮后 preset-visibility 拷贝达到 6+ 份，触发 mode-switcher M3' 的「第 5 个消费者」决策点——helper 归属在下一轮单独拍板。
