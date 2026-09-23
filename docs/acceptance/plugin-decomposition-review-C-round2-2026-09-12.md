# Reviewer C 复审（datasets / eval 线）

日期：2026-09-12  
冻结范围：`cf8f663..a0fa7c6`（`fix/design-review-batch1`，9 个提交）

## 总裁定

**WP3、WP4a、WP4b 的修复成立；WP6 的产物契约成立，但其宣称的 `check-plugin-independence` “漏配必报错”不成立。WP8 在冻结范围内未实施，而且连约定的“计划中，尚未分发”协议口径也未落地。**

因此，本轮对已实施的打包修复可以确认；对整个 FIX-PLAN 不能宣告完成。阻塞项是：（1）让 `check-plugin-independence` 真能在应声明的 core 漏掉 `gateRefs` 时报错；（2）兑现 WP8 的最小交付集。

## 1. WP3：家族边是否真按目标包版本

### 裁定：成立，不阻塞

1. `FamilySpec.targetVersion` 表达的是每个 sibling 自己的版本，而不是当前被打包者版本（`scripts/pack-dist.ts:138-162`）。`loadWorkspaceVersions` 从每个 workspace manifest 建立名称→版本索引（`:241-255`），`familySpecsFor` 用边的目标名查该索引（`:207-232`）。
2. 真正产生 range 的 `familyEdgeRange` 只读 `member.targetVersion`，返回 `^${member.targetVersion}`（`:270-283`）。`rescopePackageJson` 在 `dependencies`、`peerDependencies`、`devDependencies` 三个区域都通过该函数改写（`:325-343`）。`version` 参数只用于当前包本身的 dist manifest（`:304-310`）。
3. 裸名只是 rewrite-only：如果真实 manifest 边命中了没有 `targetVersion` 的 family member，直接 throw（`:275-280`）；CLI 语法确实为 `name[=version]`（`:600-622`）。
4. `peerDependenciesMeta` 以 peer 名为 key，实现与 peer 同步 rescope（`:344-350`），不会在跨 scope 后丢掉 `optional`。
5. 三个调用方都从 workspace 目标版本表构建 family specs：`pack-all-dist.ts:25-31,46-49`，`verify-package.mts:24-27,77-80`，`deploy-3080.mts:35-38,145-147`。

### 边界用例覆盖

- 目标版本不同于打包者，且 peer/dev 同时改为目标版本：`scripts/pack-dist.spec.ts:110-136`。
- 跨 scope family（`@deepseek-ai/*` → `@khorsheed/*`）：`:114-132`。
- `peerDependenciesMeta` 同步 rescope：`:138-159`。
- 裸名命中 manifest edge 必须失败：`:209-223`。
- `name=version`、裸名、空/非 semver 版本和冲突重复项：`:226-255`。
- datasets/eval/mission/worktrees 四个原不可满足 tuple，以及 room/local-agent 原可满足对照：`:258-287`。

这些覆盖了我在 FIX-PLAN 确认时要求的四类边界。

### 真实 tarball 独立复核

- `dist-publish/khorsheed-dsh-datasets-tool-0.1.0.tgz` 中的 `package/package.json` 声明 `@khorsheed/dsh-datasets: ^0.1.0-rc.1`；源 core 版本为 `0.1.0-rc.1`（`packages/datasets/package.json:2-4`）。结论成立：修前 `^0.1.0` 不接受 `0.1.0-rc.1`，修后 range 可满足。
- `dist-publish/khorsheed-dsh-worktrees-tool-0.1.0.tgz` 声明 `@khorsheed/dsh-worktrees: ^0.2.0`；源 core 版本为 `0.2.0`。结论成立：修前 `^0.1.0` 排除 `0.2.0`，修后可满足。

注：该 worktrees-tool 旧 tarball 仍含 `.map` / `.tsbuildinfo`，显然是 WP4a 前的留存产物；它不能作为 WP4a 验收件。我另行对当前冻结代码打到 `/tmp` 的 25 包验证见 §3。

## 2. WP4b：显式 `files` 数组的偏离

### 裁定：可接受，不阻塞

`datasets` 的实现为 `lib/*.js` + `lib/types/**/*.js` + `lib/types/**/*.d.ts` + typert 显式产物 + patch（`packages/datasets/package.json:55-64`）；`datasets-tool` 与 `eval-tool` 都多了 `lib/types/**/*.js`（`packages/datasets-tool/package.json:24-28`，`packages/eval-tool/package.json:24-28`）。

以现有 packDist 语义看，这个偏离是合理的：

- packDist 无条件把整个 `lib/` 复制进 staging（`scripts/pack-dist.ts:456-475`）。
- `pnpm pack` 又会按 manifest `files` 过滤；`verifyTarball` 要求 staging 中的每个文件都出现在 tarball（`:551-559`）。
- 因此不改 staging 策略时，排除 `lib/types/**/*.js` 必然被完整性检查拒绝；将它们列入 files 不会把 map/build state 带回，因为 staging 已中央 prune（`:393-413,472-475`），tarball 还会再拒绝两类禁品（`:541-550`）。

有一种**不改 tsconfig 也能严格满足原数组**的做法：让 staging 遵守 manifest `files` 的选择集，只复制/保留被 `files` glob 命中的 `lib` 文件，然后再做 staging↔tarball 完整性比较。等价地，可在复制整个 `lib` 后按 `files` allowlist 从 staging 删掉未声明文件。这样既保持声明产物的双向校验，又不需要 `emitDeclarationOnly`。但它是 packDist 较大的语义调整，目前多发一份与源模块对应的 JS emit 没有运行或泄密风险，不值得阻塞本批。

## 3. WP4a：删除 `optional()` 豁免后的全包影响

### 裁定：成立，不阻塞

旧 `verifyTarball` 把 `.map` / `.tsbuildinfo` 当作“可缺少的 staging 文件”；`1657ddb` 删掉了这个 `optional(file)` 豁免，改成：

1. pack 前从 staging 递归 prune 两类文件（`scripts/pack-dist.ts:393-413,472-475`）；
2. tarball 内出现任一类就拒绝（`:541-550`）；
3. prune 后 staging 剩下的所有文件都必须入 tarball（`:551-559`）。

语义上不再存在需要“合法开关”的包：开关过去只是允许打包器忽略 staging 与 tarball 的差异，现在这两类文件根本不会进入待验收 staging。

我在去除 `NODE_USE_ENV_PROXY` 及所有大小写 proxy 变量后，用当前 `a0fa7c6` 代码的 `packDist` 对所有有 `dsh.bundle.patch` 的公开包重新打包到 `/tmp/review-c-round2-pack`：**25/25 成功**；对 25 个 tgz 逐一 `tar -tzf` 检查，**0 个含 `.map` 或 `.tsbuildinfo`**。这与 `pack-all-dist.ts:37-52` 的全量选包语义一致（只打自挂载 bundle，所以是 25 包）。

`verifyTarball` 本身并不理解业务必需文件；它的双向语义是：禁品不得在 tarball，以及 prune 后 staging 不得有任何文件被 `files` 过滤掉。其他 root/skills/assets 的“声明但不存在”由 `assertDeclaredPayloadsExist` 补充（`:72-95`）。此语义下未发现包被误报红。

## 4. WP6：反向边、gateRefs 与 eval

### 4.1 边与元数据归属

### 裁定：代码/产物契约成立

- `datasets`、`mission`、`room`、`worktrees` 已不再有 core→tool peer/dev 边，而各自在自身 manifest 声明其真实的产物字符串引用：`packages/datasets/package.json:156-160`，`packages/mission/package.json:148-152`，`packages/room/package.json:66-70`，`packages/worktrees/package.json:154-158`。这正是“事实属于产出制品的包”，不应变成三个编排调用方的 CLI 特例。
- 四个 core 的当前 `lib` 都存在非注释的 companion 名引用（datasets/mission/room 的 preset-visibility emit，worktrees 的 Badge emit），所以它们的 `gateRefs` 不是冗余豁免。`verifyTarball` 同时拒绝“产物有引用但无 edge/gateRef”和“gateRef 声明但产物无引用”（`scripts/pack-dist.ts:561-596`）。
- `eval` 不需要 `gateRefs`。它没有 client/preset visibility 判据；当前 `lib` 中的 `@khorsheed/dsh-eval-tool` 出现都在 JS/JSDoc/d.ts 注释。`verifyTarball` 先对 JS/d.ts 剔除 block 和 line comments，对 YAML 剔除整行注释（`:571-579`）；剔除后 eval 产物的非 self `@khorsheed/*` 引用为空。因此不给 eval 加 `gateRefs` 是正确的。

### 4.2 `check-plugin-independence` 漏配检查

### 裁定：不成立，阻塞

`check-plugin-independence.ts` 的“泛型校验”只做了：

- 已声明 ref 必须是本仓包（`scripts/check-plugin-independence.ts:362-371`）；
- ref 不能与 manifest edge 重复（`:372-378`）；
- 有非空 refs 的包必须列在 `GATE_REF_PACKAGES`（`:380-385`）。

它**没有反向规则**：`GATE_REF_PACKAGES` 中的包必须存在且必须声明非空 `gateRefs`，也没有扫描 src/build artifact 去发现未声明的字符串引用。因此，从 `datasets/package.json` 删掉整个 `composition` 字段后，`gateRefs=[]`，上述三段循环均不产生 finding。

真正能抓到这种漏配的是 `pack-dist` 的产物检查（`scripts/pack-dist.ts:571-587`），不是 `pnpm check:plugins`。FIX-PLAN 明确要求“`check-plugin-independence` 泛型校验 gateRefs”，且本次问题特别要求验证“漏配报错”，所以这不只是命名或注释问题。

最小修法：删掉反直觉的单向白名单用法，至少增加 `GATE_REF_PACKAGES` → manifest 的反向完整性校验（包必须存在，`gateRefs` 必须非空）和回归 spec；更理想的泛化方式是检查包内可见性源码/建立后产物与 manifest 的双向关系，不再中央手工维护四包名单。

## 5. WP8 推迟是否与当时确认相容

### 裁定：“单独推迟协议归属/生成”相容；“整个 WP8 不做即宣告本批完成”不相容，阻塞

我当时接受推迟的是 **dataset-authoring 协议片段归属与机械生成**，前提是本批先把可验证事实写对：它处于 planned，尚未随 datasets npm 包分发。FIX-PLAN 也把其余 WP8 作为本批正式步骤，只明确延后“协议片段归属与生成”（`FIX-PLAN.md` “最终执行顺序” WP8 及“明确延后”）。

冻结范围 `cf8f663..a0fa7c6` 对以下文件没有 diff：`scripts/release-status.ts`、根 README 双份、`docs/release-status.md`、`docs/dataset-authoring-protocol.md`、`proposals/active/2026-08-23-dataset-authoring-protocol-skill.md`；也没有 `scripts/generate-package-map.ts` / `docs/packages.md`。当前提案仍写 `planned`（`proposals/active/2026-08-23-dataset-authoring-protocol-skill.md:4`）但同时无限定地写“datasets 包携带 `skills/dataset-authoring/SKILL.md`”（`:40`）；协议本文仍说 validator/form/skill “都从本协议派生”（`docs/dataset-authoring-protocol.md:5`），没有“尚未分发”限定。所以，就 **a0fa7c6 冻结点** 而言，用户题干所述“只做了协议口径”也尚未发生；STATUS 实际也把它列在未完成 WP8 内。

### WP8 必须兑现的最小项

1. `scripts/generate-package-map.ts` + `--check` + gate，生成唯一权威 `docs/packages.md`；包计数、自挂载/组件形态和组合元数据不再手工漂移。
2. `scripts/release-status.ts` 从本仓 profile 读成员，不以 sibling harness/profile 作权威源；当前其注释仍是“Bundle membership from the dsh-web-basic profile, when the sibling checkout exists”（`scripts/release-status.ts:32`）。
3. 根 README 中/英文都把整合 profile/add 清单写成默认安装单元，单包安装保留给高级用户；并说清 `-tool` 是“直接依赖 + preset row”，不是 bundle-root 自挂载。这是 datasets/eval 四包拆分可发现性的最小补偿。
4. 7 个无 patch 包在可生成的元数据中标明 `compositionComponent`，否则生成器仍无法区分“故意不自挂载”与“漏 patch”。
5. 立即把协议/提案口径改成“计划中，尚未随 datasets 包分发”；可以继续推迟包内协议片段的归属、组装器与 skill 本体，但必须保留明确的后续分发门槛。

## 6. 阻塞项与非阻塞建议

### 阻塞项（必须修才能称 FIX-PLAN 完成）

1. **WP6 漏配校验**：补上 `check-plugin-independence` 的反向完整性规则和“删掉 datasets 的 gateRefs 必失败”回归用例。现在只有 pack 阶段能抓到，不符合 WP6 验收承诺。
2. **WP8 最小交付集**：完成上节 1–5；尤其是冻结点尚未落地的“尚未分发”协议口径。

### 非阻塞建议

1. 未来若要严格恢复我原先给 tool companions 的 `files` 数组，优先让 staging 按 manifest allowlist 复制/裁剪，无需为此把 tsconfig 改成 `emitDeclarationOnly`。
2. 删理 `dist-publish` 中 WP4a 前的留存 tgz，避免人工抽查误把旧产物当新产物；本项不影响源码修复。
3. WP10 的 `satisfiesCaret` 手写了 prerelease 比较，并使用 `localeCompare`（`scripts/check-release-groups.ts:110-131`）；它不完全等价于 semver 数字 identifier 规则（例如 `rc.10` 与 `rc.6`）。当前 companion 的 emitted range 直接以当前 core 版本为下界，所以本批 tuple 不受影响；后续应改用仓内已有 semver 实现或补数字 prerelease 测试。
4. `pack-all-dist.ts` 文档仍写“26”（`:16-18`），实际本轮是 25；应由 WP8 的生成包地图消除这类手工数字。

## 结论表

| 项目 | 是否成立 | 是否阻塞 |
|---|---|---|
| WP3 目标包版本改写 + 边界用例 + 两个真实 tgz | 成立 | 否 |
| WP4b 多加 `lib/types/**/*.js` | 可接受 | 否 |
| WP4a prune + tarball 拒绝 + 25 包全量 pack | 成立 | 否 |
| WP6 反向边移除、四 core gateRefs、eval 无 gateRef | 成立 | 否 |
| WP6 `check-plugin-independence` 漏配必报 | 不成立 | **是** |
| WP8 整体推迟 | 只对协议归属/生成的推迟相容；其余不相容 | **是** |
