# 宿主大版本迁移 Playbook

> 2026-09-10/11 的 0.1.2 → 0.1.5-rc.1 迁移全流程实录 + 可复用清单。每次宿主大版本切换照此办理；新一轮迁移结束时把新踩的坑补进来。

## 阶段 0：侦察（不动代码）

1. **钉只读检出**：把目标宿主版本 clone 到 `~/code/deepseek-harness-<版本>`（钉 tag、装好依赖、构建好 lib）。主检出 `~/code/deepseek-harness` 是 3080 的生产检出，迁移期间不碰——它有看门狗守护，且凭证绑定 HEAD。
2. **读 delta 出盘点矩阵**：官方新能力清单 → 逐包定四类去向——**结合**（用官方新能力增强）、**开做**（官方终于支持的能力）、**换接口**（自绘改官方槽位/API）、**退役**（官方原生覆盖）。UI 归位决策（哪些进右栏、哪些留会话区）在这个阶段拍板，不要留给实现期。
3. **登记缝台账**：`docs/upstream-seam-registry.md` 记录每个「我们想要但官方没有缝」的点；迁移结束时重核哪些缝可以退役。

## 阶段 1：基线与逐包适配

1. **基线提交先行**：peer/devDeps 指向新宿主线、cordis override、`minHost` 前移——一个独立 commit（参照 bb04c84）。此后所有包在这个基线上适配。
2. **逐包适配**，每个 break 一个 commit；带 `!` 标记 breaking。
3. **宿主面优先**：gen-typert → tsc → tsdown 的构建序不能乱（客户端 tsc 消费生成的 remote 类型）。
4. 全程 `DSH_HARNESS` 指向钉版检出，不是主检出。

### 适配期陷阱（这波实踩，按概率排序）

| 陷阱 | 症状 | 解法 |
|---|---|---|
| cordis inject 祖先链 | 嵌套插件里 `sub.slots` 抛「without inject」，cordis 回滚整个 fiber，已完成的注册被带走（bfd6a87） | 嵌套插件能用的服务 = 自己 inject ∪ 祖先 fiber inject；要么父插件声明，要么直线化注册 |
| `ctx.get` vs 属性访问 | `ctx.remote.xxx` 被 inject 闸挡，服务探测静默失败（fd1059d） | 可选服务探测用 `ctx.get('remote.xxx')`，或嵌套 plugin + inject |
| notify 只唤醒 inject 声明者 | 可选服务「后到不激活」 | 探测后注册必须用嵌套 `ctx.plugin({inject: [...]})` 形态 |
| Typert Remote 加可选参数 = breaking | 客户端 arity 校验按声明参数个数，单参调用当场抛（195982e，四个 provider 授权卡片全灭） | 给 Remote 方法加参数时同步改全部调用方；回归测试钉住参数个数 |
| 会话记录是 released format | 插件写进 source 的扩展成员被下一代迁移器拒收（34e88d4） | 不写规格外成员；已污染的历史数据用 `scripts/repair-session-source-op.ts` 修复 |

## 阶段 2：集成验证实例（link: 全量挂载）

1. mktemp HOME + 官方 npm 工具链（`npm i -g` 风格的临时目录）+ 手写 profile 骨架（三件套：package.json 空 deps + bundles 清单、cordis.patch.yml、pnpm-workspace.yaml 带全量 `@khorsheed/*` → link: overrides）。
2. 凭证注入：从正式 HOME 拷 `.credentials.yaml` 和 settings.yaml 的 llm 段，免重复登录。
3. Playwright MCP 活体驱动——截图落 `.playwright-mcp/`（gitignore 覆盖），用完删。
4. **验收即修**：用户反馈循环在这个实例上跑，绿了才准进 3080。

## 阶段 3：上 3080（tarball + 门禁）

1. **基线切换**：主检出 `git reset --hard dsh-v<新版本>` + pnpm install + build。此刻起 3080 处于「旧进程 + 新 profile」过渡态，页面会坏——这是流程固有窗口，不是故障，watchdog 不管（进程健康），别慌。
2. **新包先 `plugin add`**（进 bundles），dep-only 家族成员（如 dsh-headless）显式加进 deps（deploy 脚本的 guard 拒绝非依赖包——这是设计）。
3. `pnpm deploy:3080 --package …（全量）`。已知坑：
   - **GEN_TYPERT_ONLY 作用域不含家族依赖会 TS2307**——deploy 列表必须带上家族 core（如 local-agent）。
   - 改动过源码结构的包先 `rm -rf lib` clean rebuild，否则 pack-dist 的 stale-types 门拦你。
   - 跨宿主版本后的第一次重启会被守卫以「install anchor 已变」拒绝——**先 `configure-launch` 重绑锚点**（installAnchor 是 `apps/cli/package.json` 的 sha256），再走标准闸。凭证有 10 分钟保鲜期，超时重录。
4. 门禁后验收：check-env、canary、`dsh plugin add` 冒烟、以及用户活体点一遍。

## 阶段 4：发布与收尾

1. **CI 基线与 prod 同切**（本波教训：主 gate 钉在旧线 = 证明的是昨天的世界；forward lane 跟 `dist-tags.next`，不跟会腐烂的 `alpha`）。
2. npm 发布照 [publishing.md](publishing.md)：版本只发已发线（未发包跟整合包波次）、pack 后 `tar -tzf` 验结构、**家族/pair 包的 peer 边由 pack-dist 按成员版本重写——版本线必须对齐**（file-preview/ui-file-preview 的 ^0.3.0 教训）。
3. git tag `<短名>-v<版本>` + GitHub Release + `pnpm release:status` 重录 + push（人协调）。
4. 清理：临时 HOME/工具链实例、mission 完成的 worktree、scratch 截图；ankh-guard 发版后跑镜像同步。
5. 重核缝台账与上游提案（docs/upstream-proposals/）：哪些缝官方已补、哪些缺陷报告该发。

## 数据安全红线

- 会话/凭证数据在 `DSH_HOME`，插件 tarball 部署不触碰——但**直接修数据文件时必须先备份再原子写**（write tmp + rename）。
- 会话日志是串接 Zstandard 容器，**第一帧必须恰好是 header 行**；整文件单帧重写 = 结构性损坏。修数据用现成的 `scripts/repair-session-source-op.ts` 的模式（帧扫描 + 宿主自己的校验器验收 + 备份）。
- 看门狗会把 checkout 回滚到最后一次证明过的良好启动——被守护的检出里不要留未提交工作。
