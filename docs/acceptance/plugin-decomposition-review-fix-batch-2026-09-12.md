# 插件拆分复审批次 验收 — 2026-09-12

验收人:Lead(执行)· Codex A / C(复审裁定)· 分支 `fix/design-review-batch1`(worktree `.worktrees/fix-design-review`)
基线:**main `f4de9aa`**(本批已 rebase 到 mainline)· 认证提交:**`f15f1a3b`**

## 范围

四份审查报告(local-agent / file-preview / datasets-eval / 仓库架构)汇总成 `FIX-PLAN.md` v2 作为执行基线。
本批交付 WP1、WP2、WP3、WP4a、WP4b、WP5、WP7、WP8、WP10,外加复审提出的三个阻塞项。
**WP9(客户端改名)明确延后**,理由是需要与 mainline 协调 lockfile 窗口。

## 环境与限制

- Node 22.21.1;`pnpm gate` 需 `danger-full-access`(**`/bin/ps` 被 agent 沙箱拒绝**,ankh-guard 的
  `processIdentity()` 依赖它)。
- `npm view` 需要把 `NPM_CONFIG_CACHE` 指到工作区内(沙箱外 `~/.npm` 不可写 → EPERM,非网络问题)。
- **Docker daemon 不可达**:`scripts/integration-triad.spec.ts` 的 16 个容器集成测试按设计自我跳过
  —— 本会话早些时候该套件曾 16/16 通过,但**这批改动没有在 Docker 下复跑**。
- 测试运行时必须去掉 `NODE_USE_ENV_PROXY` 及各类代理变量,否则每个 node 子进程往 stderr 打 undici 警告,
  会让 `packages/datasets/tests/worktree.spec.ts` 的"stderr 必须为空"断言假失败(该断言的环境脆弱性属 datasets owner,未擅改)。
- **未 push、未部署、未重启 3080**;`pnpm gate` 的冷安装是 CI-only(`pnpm gate --full` 才覆盖)。

## 逐项结果

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| WP1 profile 组合 | 无 `dsh.bundle` 的包不得出现在 `dsh.profile.bundles`;preset 行必须可解析 | 通过 | 新 checker `check-profile-bundles`(+spec 10 用例、+gate 步);`profiles/web-dev`、`web-eval` 移除了 `local-agent-tool-subagent` 行;顺带修 web-dev preset 引用了非依赖的 `worktrees-tool`/`room-tool` |
| WP2 安装契约 | 文档与代码行为一致:"npm 依赖 = 模块可解析"≠"host 挂载行" | 通过 | `AGENTS.md` 两条 bullet、core + 4 provider patch 头、`patch.spec.ts`、`pack-dist` 注释、`docs/ops.md`;A 复审逐条核对 file:line 后判成立 |
| WP2 负约束(A 的阻塞项) | provider patch 不得重插 core 行,且该断言必须会在违反时失败 | 通过 | `packages/local-agent/tests/patch.spec.ts` 从树里自动发现家族成员(6 个)、逐个断言只挂自己的行;注入一条 core 行的临时代码证明断言有牙齿 |
| WP3 家族边版本 | pack-dist 必须按**目标包**版本生成 range,裸名只做 scope 改写、缺版本报错 | 通过 | `familySpecsFor`/`familyEdgeRange`;10 类边界用例;**真实 tarball 复核**:`datasets-tool` 由 `^0.1.0`(不可满足 `0.1.0-rc.1`)变为 `@khorsheed/dsh-datasets@^0.1.0-rc.1`;`worktrees-tool` 由 `^0.1.0`(排除 `0.2.0`)变为 `^0.2.0`(C 独立打开 tarball 核对成立) |
| WP4a 载荷卫生 | 发布的 tarball 不得含 `.map`/`.tsbuildinfo` | 通过 | staging 递归 prune + tarball 双向拒绝,旧的 `optional()` 豁免删除;C 用当前代码把 25 个自挂载包全量重打到 `/tmp` 后逐一 `tar -tzf`:**0 个**含禁品 |
| WP4b 显式 files | datasets/datasets-tool/eval-tool 的发布载荷显式化 | 通过 | 三个 manifest;多出的 `lib/types/**/*.js`(因 packDist stage 整个 `lib/`)经 C 复核判"可接受";备选做法已记录 |
| WP6 反向边 / 数据引用 | core 不得反指 companion;纯数据提及必须声明,且漏配必须被发现 | 通过 | **机制由 mainline 落地**(`dsh.references` + `pack-dist` family-edge 校验);本批关闭 C 指出的漏洞:源码里出现的兄弟包名必须有边或引用、声明的引用必须是真包且不与边重复 —— 删掉声明现在会让 `pnpm check:plugins` 失败 |
| WP6 通用化(A 的阻塞项) | 不得存在"patch 挂载另一个自挂载包的行" | 通过 | `check-plugin-independence` 新增 `patch row ownership` 规则;全仓扫描 25 个自挂载包、0 违规;spec 用两包 fixture 复现违规与合法(挂 `-tool` 行)两种情形 |
| WP5 skill 归属 | `3d-artifact` 由 inline-html-render 注册,file-preview 不再注册 | 通过 | skill 目录迁移(git 记为 rename R097);两个 skill 同 `provider: 'inline-html-render'`;file-preview 的 `files` 去掉 `skills/**/*.md`,inline-html-render 已覆盖;取代性 Agent Note(不改写历史 Note) |
| WP7 host 握手 | host 缺席时**所有** UI 面缺席(非错误卡/空 tab) | 通过 | host 零会话 `@Remote('capabilities') → { protocolVersion: 1 }`;client 探测通过才安装,`installFilePreviewSurfaces(ctx, remote)` 为边界;三个真实组合测试(client-only / host-only / paired);locale 未新增文案 |
| WP8 包地图 | 计数与形态必须从 manifest 生成,过期即失败 | 通过 | `generate-package-map.ts` → `docs/packages.md`(`--check` 进 gate);渲染实测 **32 包 / 25 自挂载 / 7 组合组件 / 22 带浏览器半边 / 3 profile**;README 的 "26/24/另外 2" 过时口径被替换 |
| WP8 组合元数据 | "刻意不自挂载"要有机器可读声明,取代中央名单 | 通过 | 7 个包声明 `dsh.composition.component`(`preset-composed-row` ×5、`provider-mounted-row`、`sub-profile-patch`);checker 改读 manifest,`NO_OWN_PATCH` 降为交叉校验 |
| WP8 release-status | 不得以并不存在的 sibling checkout 作权威源 | 通过 | `release-status.ts` 改读本仓 `profiles/web-basic`;`docs/release-status.md` 用真实 npm 版本重新生成(成员列首次有值) |
| WP8 协议口径 | skill 必须写成"计划中,尚未随包分发" | 通过 | `docs/dataset-authoring-protocol{,.en}.md`、`proposals/active/2026-08-23-*.md`(含分发门槛与验收人) |
| WP10 版本纪律 | 家族同版 + companion range 可解析 | 通过 | `check-release-groups`(+spec、+gate 步);普通模式对 rc.5/rc.6 漂移**告警**,`--release` 下**致命**;range 可满足性始终致命。**未在 worktree 内 bump 版本**(`docs/publishing.md` "worktree 不动版本号"),A 复审接受该裁定并撤回原要求 |
| 非阻塞修正 | 复审点名的表述/实现精度 | 通过 | release-group 注释("every direction"/"single dist version")与 `docs/publishing.md` 纠真;`satisfiesCaret` 改用数字 prerelease 比较(`rc.10 > rc.6`);`pack-all-dist` 不再硬编码包数 |

## gate 检查点

| 检查点 | 提交 | 结果 |
|---|---|---|
| A(rebase 前) | `a0fa7c6` | **PASSED — 12 步 / 532s**;25 包 build+test+pack 通过 |
| B(rebase 后,main 基线) | `f15f1a3b` | **PASSED — 14 步 / 241s** |

gate B 的分步证据:install freshness ✓、harness ref `dsh-v0.1.5-rc.1`(advisory)✓、workflow refs(1 workflow / 0 finding)✓、
build scripts declared(2 个有 install script 的依赖、0 未声明)✓、repo hygiene 全树(**2148 文件 / 0 finding**)✓、
plugin independence(**32 包 / 0 finding**)✓、profile composition(compose cleanly)✓、
release groups(7 条已知 rc.5/rc.6 告警,`--release` 下致命)✓、**package map(current:32 包 / 25 自挂载)**✓、
doc gates(251 份 Agent Note 格式与分类、284 对翻译配对)✓、脚本 spec(**17 文件 / 164 测试**)✓、
build ✓、test ✓、pack bundles(**25 包 packed and verified**)✓。

时长:test 171s、pack 25s、脚本 spec 18s、build 12s(热 lib)、doc gates 9s、hygiene 1s。

**本文件与其后的一处文档修正都在 gate B 之后**;gate B 的认证范围是提交 `f15f1a3b`。

## 复审回执

- `scratch-ds-design-review/05-review-A-round2.md`:WP1/WP2/WP4a/WP6/WP10 行为成立;唯一阻塞项(provider patch 负约束无测试)已在 `bcb1dc5` 修复。
- `scratch-ds-design-review/05-review-C-round2.md`:WP3/WP4a/WP4b 成立;两个阻塞项(`check-plugin-independence` 漏配、
  WP8 最小交付集)已分别在 `678ba77` 与三个 WP8 提交修复。
- **第三轮(修复验证)**
  - `06-review-A-round3.md`:**阻塞项 A 解除**。审查者自己构造了一次真实违规(给 provider patch 注入 core 行),
    专项 spec 与通用 `patch row ownership` checker 均退出 1,证明断言有牙齿;合法 `-tool` 行与官方包行不被误伤;
    验证后工作树恢复干净。
  - `06-review-C-round3.md`:**阻塞项 1 解除**(实测删掉 `datasets` 的 `dsh.references` → 检查器退出码 1,
    且规则从源码与 manifest 推导、不依赖任何 core/companion 名单);**阻塞项 2 只差一处文档修正并被采纳**:
    README 与包地图此前把 `*-tool` 写成"由各自 core 作为直接依赖安装",而事实是
    **`-tool` 是安装它的 profile 的直接依赖(与 core 并列),并由它自己声明 core 边(companion → core)**。
    两份 README 与该句所在的生成模板已改正,`docs/packages.md` 已重新生成。
  - 非阻塞建议状态:C 的第 3 条(`satisfiesCaret` 数字 prerelease)与本批第 4 条(`pack-all-dist` 硬编码包数)已修;
    第 1 条(staging 按 `files` allowlist 裁剪)维持不改并记录了理由;第 2 条(`/tmp` 下的历史 tgz)
    经确认不是仓库工作项。


## 未覆盖 / 遗留

1. **Docker 不可达**,16 个容器集成测试在本批未复跑(按设计跳过)。
2. **未 push、未部署、未重启 3080**;`pack-dist` 的产物只到 `/tmp/pack-all-dist`。
3. WP9 客户端改名延后(需 mainline lockfile 窗口)。
4. `files: ["lib"]` 全仓显式化、`verify-package.mts` 对无 patch 包的覆盖、数据集作者协议的包内片段与组装器:延后项(不静默丢弃)。
