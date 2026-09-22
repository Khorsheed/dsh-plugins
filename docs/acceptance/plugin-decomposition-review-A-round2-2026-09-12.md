# 审查者 A 复审：local-agent / 安装契约方向

日期：2026-09-12  
冻结范围：`cf8f663..a0fa7c6`（9 个提交）  
复审 worktree：`.worktrees/fix-design-review`

## 结论

五类被复审修复的**当前代码行为均真实成立**：WP2 已把“npm 可解析”与“profile 激活”分开；WP1 已移除无 bundle 的根层条目并加入会失败的组合检查；WP4a 会在 staging 剪除且在 tarball 再拒绝 map/tsbuildinfo；WP6 已去掉五条 core → companion 反向 manifest 边；WP10 的“普通 gate 告警、发版检查致命、伴生 range 始终致命”实现与仓库现行版本纪律一致。

但本批尚不能按 WP2 完成验收：其最关键的“不允许 provider patch 重插 core 行”没有被任何测试或 checker 冻结。`packages/local-agent/tests/patch.spec.ts` 只读取 core patch；任一 provider patch 加回 `local-agent` 行，该测试、`check:profiles` 与当前 gate 都仍可通过。这是唯一阻塞项。

## 一、逐项复核

### 1. P0-2 / WP2：安装与激活契约纠真——代码现状成立，回归保护不成立（阻塞）

当前表述已纠正：

- `AGENTS.md:46` 明确说 provider 对 core 的 npm dependency 只保证模块可解析，不会让 host 挂载 core row；`reconcilePlugins` 只看 profile 直接依赖；provider 缺 core 时 pending。
- `packages/local-agent/cordis.patch.yml:1-10` 给出相同的两层语义和双 `dsh plugin add` 安装方式；`:12-14` 明令 provider 不得重插 core row，避免多 provider 时重复挂载。
- 四个 provider patch 均一致：Claude `packages/local-agent-claude-code/cordis.patch.yml:3-9`，Codex `packages/local-agent-codex/cordis.patch.yml:3-9`，dsh `packages/local-agent-dsh/cordis.patch.yml:15-20`，Kimi `packages/local-agent-kimi/cordis.patch.yml:2-8`。
- pack-dist 注释也不再声称 dependency 会激活 row；`scripts/pack-dist.ts:536-539` 明确把 family edge 定义为 runtime/module-resolution contract，而非 activation contract。
- `docs/ops.md:85-86` 分别说明家族按依赖序发布，以及 reconciler 只处理 profile 直接依赖、传递依赖不会挂载。与代码口径一致。

当前 patch 内容也确实满足契约：core patch 仅在 `packages/local-agent/cordis.patch.yml:16-21` 插入自己的 `local-agent` 行；四个 provider 的实际 insert 分别只包含自身和工具行（Claude `:34-42`、Codex `:34-42`、dsh `:22-24`、Kimi `:26-34`），没有重插 core。

但是回归测试没有验证上述关键负约束：

- `packages/local-agent/tests/patch.spec.ts:5` 只读取 `../cordis.patch.yml`，即 core patch。
- `:8-17` 只断言 core patch 含 core id/name/config；`:19-21` 只断言 **core patch 自身**恰有一个 `- id:`。
- 它完全不读取四个 provider patch，因此 provider patch 被改坏、重新插入 `id: local-agent` / `name: '@khorsheed/dsh-local-agent'` 时仍会通过。
- WP1 checker 的规则是 profile manifest 组合闭包（`scripts/check-profile-bundles.ts:169-220`），它不解析 package bundle patch 的 row id 冲突；因此也补不上该缺口。

另有一处文档内在张力：`AGENTS.md:42` 无条件写“每个 installable plugin……`dsh plugin add` must suffice”，而 `:46` 又正确说明 local-agent provider 必须显式同时安装 core。前者至少应收窄为“使该包自己的 bundle row 自挂载”，或显式注明家族组合闭包例外，否则新的贡献者仍可能读出“单独 add provider 即可工作”的旧结论。

裁定：**行为修复成立；测试/规范闭环不成立，阻塞。** 最小可执行修复是让测试读取四个 provider patch，并逐个断言不存在 core 的 row id 与 package name（同时保留 core 自己 exactly-one 的正断言）；更稳妥的是在通用 checker 中校验一个 bundle patch 不得插入另一自挂载 package 的 owner row。

### 2. P0-1 的家族相关部分 / WP1：profile 不再挂 bundle-less tool，且 checker 会失败——成立，非阻塞

- `profiles/web-dev/package.json:31-53` 与 `profiles/web-eval/package.json:37-59` 的 bundles 已不含 `@khorsheed/dsh-local-agent-tool-subagent`，但仍含 core 与四 provider，符合直接激活闭包。
- `scripts/check-profile-bundles.ts:169-181` 对 bundles 非直接依赖及 bundle-less entry 产生 finding；`:185-191` 检查自挂载直接依赖必须进 bundles；`:194-213` 对 hard dependency → self-mounting bundle 做直接 dependency + bundle 双闭包检查；`:215-220` 检查 preset row 可解析。
- `scripts/check-profile-bundles.spec.ts:64-97` 分别构造 rules 1–4 的破坏场景；尤其 `:71-74` 会在 bundle-less 包进 bundles 时失败，`:90-96` 会在 provider 仅传递依赖 core 时失败；`:125-141` 再跑真实 profiles。
- CLI 不是只打印：`scripts/check-profile-bundles.ts:231-247` 有 finding 返回 1，并以 `process.exit(main(...))` 退出。
- gate 在 build 之前调用它（`scripts/gate.mts:281-300`），同步命令非零会抛出，`:314-325` 将 gate 置为 exit 1 并停止。

命令证据（Node 22，已 unset 代理变量）：`node --import tsx scripts/check-profile-bundles.ts` → exit 0，输出 `profiles compose cleanly`；对应 spec 10/10 通过。

裁定：**成立，非阻塞。**

### 3. P0-4 / WP4a：发布载荷卫生——成立，非阻塞

- `scripts/pack-dist.ts:393-414` 递归删除 staging 内全部 `.map` 与 `.tsbuildinfo`。
- `:456-475` 显示剪除发生在复制完整 payload 后、写 manifest 与 pack 前。
- `:525-550` 在真实 tarball listing 上再次拒绝这两类文件；这是 artifact 级断言，不是只依赖 staging。
- `scripts/pack-dist.spec.ts:491-499` 冻结 tarball 拒绝路径；`:506-523` 冻结递归 prune；`:567-615` 做真实 pack，既断言 map/tsbuildinfo 消失，也断言 JS、CSS、hashed chunk、声明文件仍存在。

命令证据：聚焦 vitest 中 `scripts/pack-dist.spec.ts` 34/34 通过，其中真实 pack 的载荷卫生用例通过。

裁定：**成立，非阻塞。**

### 4. P1-2 / WP6：五条 core → companion 反向边——成立，非阻塞

冻结 diff 显示 datasets、eval、mission、room、worktrees 的 `peerDependencies`、相应 `peerDependenciesMeta` 和 `devDependencies` 中 companion 边均已删除；当前 manifest 的对应 peer 区域也不再出现 companion（例如 datasets `packages/datasets/package.json:70-98`、eval `packages/eval/package.json:62-90`、mission `packages/mission/package.json:64-92`、room `packages/room/package.json:88-110`、worktrees `packages/worktrees/package.json:60-98`）。

需要以字符串作为 UI 自隐藏判据的四个 core 改用制品元数据，而非依赖边：datasets `packages/datasets/package.json:156-159`、mission `packages/mission/package.json:148-151`、room `packages/room/package.json:66-69`、worktrees `packages/worktrees/package.json:154-157`。eval 没有此自隐藏引用，未虚构 gateRef，符合 FIX-PLAN 裁定。

通用约束也同步收紧：`scripts/check-plugin-independence.ts:96-118` 只允许 companion → core，不再允许五条 core → companion；pack-dist 对 gateRefs 的解释与发布检查见 `scripts/pack-dist.ts:561-570`。WP10 checker 还在 `scripts/check-release-groups.ts:184-208` 永久检查 companion 必须有 core 边、core 不得反指 companion、发布后的 range 必须能解析 core。

裁定：**成立，非阻塞。**

### 5. P1-6 / WP10：版本纪律——成立，接受撤销 bump，非阻塞

我接受撤销 `local-agent-claude-code` rc.5 → rc.6 的本分支 bump。可执行依据不是偏好：

- 仓库规则 `AGENTS.md:53-55` 指定版本在切 release 时 bump，而非每提交 bump。
- `docs/publishing.md:65-70` 明确规定 worktree 与 main 保持相同版本，版本治理只在 mainline 发版时发生。
- 同时 `docs/publishing.md:51-57` 把 local-agent 七包同版、依赖序发布、`pnpm check:release-groups --release` 和部分发布恢复写成明确操作流程。
- `scripts/check-release-groups.ts:73-86` 完整列出七包；`:147-169` 普通模式把不同版设为 warn，release 模式设为 error；`:172-209` 让五个 core/companion 的单向性和 emitted range 可满足性始终为 error；`:215-235` 只有 warning 时返回 0，有 error 时返回 1。
- `scripts/check-release-groups.spec.ts:58-75` 同时验证真实树无硬错误、已知 rc.5/rc.6 漂移普通模式是 warning、release 模式是 fatal；`:77-99` 构造漂移 fixture。
- gate 确实执行普通检查（`scripts/gate.mts:281-295`），所以日常开发可见漂移但不会因禁止 worktree bump 而永久红；发版命令必须显式带 `--release`。

命令证据（Node 22，已 unset 代理变量）：

- `node --import tsx scripts/check-release-groups.ts` → exit 0，报告 7 warnings；
- `node --import tsx scripts/check-release-groups.ts --release` → exit 1，报告 7 findings；
- 对应 spec 9/9 通过；三个聚焦 spec 合计 53/53 通过。

这比我上一轮要求“立即 bump”更符合现行仓库职责分层，同时没有放弃同版发布不变量。前提是 operator 的发版流程确实调用文档规定的 `--release`；当前 CLI 和文档已提供可执行门槛。

裁定：**成立，非阻塞。**

## 二、是否引入新问题

发现一个必须修的闭环缺口（WP2 provider patch 负约束未测试），详见上文。除此之外，在冻结范围内未发现新的运行时、打包或 gate 退出语义问题。

两项非阻塞的表述精度建议：

1. `scripts/check-release-groups.ts:8-13` 所谓 local-agent 家族“hard-depends on itself in every direction”并不准确；实际是 provider → core/tool，tool → core 为 peer/API 边，core 不反指 provider。建议改成“家族内存在多条硬依赖并形成协调发布闭包”，避免与单向依赖原则混淆。
2. 同文件 `:68-71` 和 `docs/publishing.md:53` 说 pack-dist 按“single/same dist version”改写，WP3 的真实机制则是按**目标 sibling 自己的版本**（`scripts/pack-dist.ts:119-150`）。在 release group 同版时结果相同，但机制描述宜改为“目标包版本；发版时七包须先对齐”，以免未来维护者误把 WP3 改回 packer version。

## 三、三条分歧裁定

1. **WP10 bump 时点：认可现裁定（撤销本 worktree bump）。** 上述普通告警 / release 致命的退出码已实测；它同时满足 worktree 不改版本与发版前同版两个规则。没有可执行反驳。
2. **core/tool 对不强制同版本、只强制可满足：认可。** `scripts/check-release-groups.ts:172-209` 检查的是实际单向边和 pack-dist emitted range，正对应可安装性；把独立演进的 pair 强制同版没有额外运行时收益。
3. **`gateRefs` 取代反向依赖：认可。** 这把“制品里的字符串引用”与 npm 安装义务区分开，且发布重写仍可跟随 scope。

关于把 `local-agent-tool-subagent` 折进 core 子路径：我不再申辩，将 **REJECTED** 视为最终结构裁定。D 指出的边界一致性优先于减少一个发布单元；本轮也没有新证据证明收编能保持独立可配置 row、安装与升级兼容性。保留独立 companion，并以 release group 管住协调成本，是可执行且已被 checker 覆盖的方案。

## 四、阻塞项

1. **补上 provider patch 不得重插 core row 的机械断言，并消除 `AGENTS.md:42` 与 `:46` 的安装口径歧义。** 当前行为正确，但现有 `packages/local-agent/tests/patch.spec.ts:5-21` 无法在最危险的契约回归时失败。修复后应至少用一个负向 fixture/临时字符串证明：任一 provider patch 出现 `id: local-agent` 或 core package row name，测试/checker 返回非零。

## 五、非阻塞建议

1. 精确化 release checker 中“every direction / single dist version”的注释，改成实际依赖方向与“按 target version 改写、release 时版本相等”。
2. 后续可把“bundle patch 不得插入另一 self-mounting package 的 owner row”提升为通用组合 checker 规则；短期用 local-agent 专项测试即可解除本轮阻塞。

## 六、验证记录

未运行 `pnpm gate`，未 build / publish / deploy / restart，未改动修复 worktree。

在清除 `NODE_USE_ENV_PROXY` 与全部大小写代理变量，并显式使用 Node 22 后运行：

```text
pnpm exec vitest run --config vitest.scripts.config.ts \
  scripts/check-profile-bundles.spec.ts \
  scripts/check-release-groups.spec.ts \
  scripts/pack-dist.spec.ts

Test Files  3 passed (3)
Tests       53 passed (53)
```

直接 CLI 退出语义：

```text
node --import tsx scripts/check-profile-bundles.ts           => 0
node --import tsx scripts/check-release-groups.ts             => 0（7 warnings）
node --import tsx scripts/check-release-groups.ts --release   => 1（7 findings）
```

最初直接调用系统默认 `pnpm` 时落到 Node 18，与仓库 `package.json:6-8` 的 Node 22+ engine 不符；随后固定 `/opt/homebrew/opt/node@22/bin` 重跑。之后 `pnpm` script wrapper 的 `tsx` IPC 在本沙箱报 `listen EPERM`，所以 CLI 退出语义用等价的 `node --import tsx` 执行；vitest 聚焦验证正常完成。这是执行环境限制，不是被审代码缺陷。
