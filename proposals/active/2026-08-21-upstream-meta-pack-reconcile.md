# 薄元包一键装全家（upstream-meta-pack-reconcile）
- **分类**：seam
- **状态**：planned
- **最后更新**：2026-08-21
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——无同意图提案（薄元包仅在 `docs/ops.md` 有一行规划，无实施提案）。
- **官方依赖**：需契约扩展（upstream 候选）。提交对象：deepseek-harness `apps/cli` + `packages/boot/app-boot`。本提案是 [package-management](2026-08-21-package-management.md) 形态 C 的前置。

## 目标

让 `dsh plugin --profile <p> add <pack>`（pack = 只声明 dependencies、自身无 `dsh.bundle` 的薄元包，如 `@khorsheed/dsh-eval-pack`）能一键装全家：pack 的每个成员 bundle 自动挂载进 `dsh.profile.bundles` 层；之后任一成员可单独 `remove` / `add`，互不影响。消除社区侧「逐条 add + 手写 bundles 层」的现状。

## 现状（官方契约实测，2026-08-21）

1. **`dsh plugin` = pnpm 薄转发**（`apps/cli/src/plugin.ts`）：`runPlugin` 把参数转发给 profile 目录的 pnpm，成功后 `reconcilePlugins(before, dir)` 用**安装后的 profile manifest** 调和 `dsh.profile.bundles` 层。
2. **`reconcilePlugins` 只扫直接依赖**：`const dependencies = Object.keys(after.dependencies ?? {})`——对每个直接依赖做 `exportsPatch`（解析包 manifest 查 `dsh.bundle.patch`），声明了就追加进层；`after.dependencies` 里消失且层里还在的条目被剔除。**从不看传递依赖**。
3. **`pnpm add <pack>` 只把 pack 写进 profile 直接依赖**：成员是传递依赖，不出现在 `after.dependencies` → 不挂载；pack 自身无 `dsh.bundle` → 触发「installed as a plain dependency」警告。**结果：装了个寂寞，零成员挂载。**
4. **`loadProfile`（`packages/boot/app-boot/src/profile.ts`）只按 `dsh.profile.bundles` 列表解析 patch 层**，列出的包无 `dsh.bundle` 直接 fail loud；不自动扫描 node_modules。启动侧无需改动。
5. **`dsh plugin remove <pkg>` 只对直接依赖有效**：pnpm remove 只改 package.json 的 dependencies；传递成员无法按名 remove，也没有任何「从层里摘除」的入口。
6. **已有先例可复用**：同文件 `healProfilesModuleFallback` 已实现「BFS 依赖闭包解析」（从 app manifest 出发遍历 `dependencies`，`packageDirFromAnchor` 逐包定位）——闭包遍历的基建已在官方仓里。

## 方案

两个设计，推荐**设计 1（展开式）**；上游若倾向最小改动可选设计 2。

### 设计 1（推荐）：add pack = 展开为直接依赖

`dsh plugin add <pack>` 在 pnpm 成功后追加一步**展开**：BFS pack 的依赖闭包（复用 `healProfilesModuleFallback` 的遍历范式），把每个闭包成员以 caret 范围写进 profile 的 `dependencies`（已存在的直接依赖跳过、不重复），随后把 pack 本身从 dependencies 移除（或保留为 `devDependencies` 溯源标记，二选一，建议移除保持清单干净）。之后走既有 `reconcilePlugins`——成员全是直接依赖，自动入层；**remove / re-add 完全复用现有 pnpm 语义，零新状态**。产物 profile 形态与现有 prod profile（全直接依赖）完全一致。

### 设计 2（备选）：reconcile 扫闭包 + 排除表

`reconcilePlugins` 从「只扫直接依赖」升级为「扫 pnpm 安装闭包」（从 profile manifest 的直接依赖出发 BFS），凡声明 `dsh.bundle` 的加入 bundles 层，但跳过 `dsh.profile.exclude` 里的名字。`dsh plugin remove <member>` 对传递成员改为：写 `exclude` + 从层剔除（提示「包仍在磁盘，仅解除挂载」）；`add` 清除 `exclude`。需要新状态字段与 remove 分支，语义比设计 1 重。

### 两设计共同的行为细节

- **聚合器免警告**：pack 自身无 `dsh.bundle` 时不再打「plain dependency」警告——识别方式：其依赖闭包中存在声明 `dsh.bundle` 的包即视为聚合器（或 pack 显式声明 `dsh.pack: true` 标记，二选一，建议前者零 schema 变更）。
- **更新**：`dsh plugin update <pack>` 后新成员出现、消失成员（新版本不再依赖）从层移除——设计 1 下由展开逻辑重跑保证；设计 2 下由闭包扫描天然保证。
- **家族包同样适用**：local-agent 核心声明为成员的依赖（现有 `workspace:*` → 发布时 `^`），展开后核心仍是成员直接依赖，行 id 不重复的既有约束不变。

## 边界与测试用例（提交上游时随 spec）

1. 空 profile：`dsh plugin add @khorsheed/dsh-eval-pack` → bundles 层含全部成员（不含 pack 自身）；boot 成功、preflight 无 FAIL。
2. `dsh plugin remove <member>` → 仅该行消失；其余成员照常；boot 成功。
3. `dsh plugin add <member>` → 恢复该行，无重复行 id（与 `tool-subagent-kimi` 既有约束同源）。
4. 成员已在 profile 直接依赖中 → add pack 不重复写入、不重复挂载。
5. pack 无 `dsh.bundle` → 无「plain dependency」警告。
6. 混合 `file:` / `workspace:*/``^` 依赖时解析正确；解析失败（缺包）→ 沿用现有 fail loud 语义而非静默。
7. 与现有 prod profile 兼容：既有全直接依赖形态在升级后行为不变（回归）。

## 提交路径

- PR 到 deepseek-harness：`apps/cli/src/plugin.ts`（展开 / 闭包扫描 + 聚合器识别 + spec）+ `packages/boot/app-boot`（如需 expose 闭包遍历工具）+ 对应 spec。
- dsh-plugins 侧等待期间：形态 A/B（见 package-management 提案 M3）先行交付整合包，不阻塞。
- 若上游拒绝 → 登记 upstream seam registry（S 条目「薄元包不可一键装」），长期走形态 A/B。

## 验收标准

- 空 profile 一条 `dsh plugin add <pack>` 装全家，`dsh.profile.bundles` 层与成员一一对应；
- 任一成员 `remove` 后仅其 bundle 行消失、其余成员与整体 boot 不受影响；
- 上述测试用例 1–7 全绿；官方 preflight 对展开后的 profile 无 FAIL。

## 风险 / 放弃的东西

- **展开式改变 profile manifest 形状**（pack 变成一坨直接依赖）——这正是 prod 现状形态，可接受；代价是「pack 身份」不持久（重跑 `add <pack>` 才再同步成员），对一次性 bootstrap 场景足够。
- **排除表语义复杂**（设计 2）：exclude 与包实际安装状态可能漂移（升级 pack 又带回已排除成员）——设计 1 无此问题，故为首选。
- **放弃**「让 pack 自带 patch 挂载成员」：静态 patch 无法条件挂载（成员可能未装），且与每包一行自挂载约定冲突。
