# Agent Note:宿主 0.1.6 breaking 适配——alpha.1 基线升线与五处命中

Status: implemented

[English](2026-09-15-host-016-breaking-adaptation.md) | 中文

## 问题

宿主发布了 0.1.6-alpha.1(2026-09-15,距我们 0.1.5-rc.1 基线约 804 commits)。波次提案 `proposals/active/2026-09-15-host-016-adaptation.md` 审计了差异并排期 breaking 项;本 note 记录适配的实际命中与决策。波次策略是 probe+degrade、**minHost 不动**:0.1.6 在 npm 的 `alpha` tag 下而 `latest` 停在 0.1.5-rc.1,所以每个包必须既能在 0.1.5 上照常安装运行、又能对 0.1.6 编译运行。

## 命中项(五处,本批全部修复)

1. **`agent/created` 变 `@mode serial`**,负载 `{agent, source, signal}`,监听器契约 `undefined | Promise<undefined>`;`agent/session-start` 删除(本仓零引用)。ankh-guard 是全仓唯一 `agent/created` 监听方(`packages/ankh-guard/src/index.ts`):返回 `void` 的监听器不再过类型检查,且创建事务现在会等监听器的返回值,监听器必须保持 fire-and-forget。修法:显式 `: undefined` 注解 + serial 纪律注释;重启续跑的 `deliver()` 路径已审计,监听器作用域内无 await(永不 `agent.whenIdle`)。
2. **`SubprocessTerminalSpawnSpec.terminalType` 变必填**。gen-typert 的全 workspace 分析在 `packages/local-agent/src/index.ts`(登录 PTY spawn)挖出。修法:`terminalType: 'xterm-256color'`,与官方 terminal-controller 同款。
3. **`code-runtime` 家族删包**(`dsh-code-runtime(-worker-thread)` → `dsh-ptc-runtime(-node)`,行 id `code-runtime` → `ptc-runtime`;`workflow-worker-thread` → `workflow-ptc`)。local-agent-dsh-headless 带着依赖、patch 行、pin spec 与文档;eval 的 capability-probe fixture 镜像了该行。全部改名;撞 id pin spec 保留 P0 原由并补改名注记。
4. **`SidebarRightGuideEntry.id` 变必填**。四个 client definition(canvas、local-files、ui-file-preview、worktrees)注册了右栏 guide 条目;现在各自把 KIND 常量作为稳定条目 id 传入,与官方 `ui-sidebar-files` 同形。
5. **profiles**:`tool-ralph` 在 base bundle 变 `disabled: true`(官方文档化的恢复形态是 overlay 行加 `disabled: false`——已加进 web-dev 的行);web-dev 的 `workflow-worker-thread` 行改 `workflow-ptc` / `@deepseek-ai/dsh-workflow-ptc`;web-eval 散文跟进改名。

**零命中已核项**:e2b 删除(零引用)、provenance→source 类型改名(不 import)、`ComposerBarInjected.command` / `WorkspaceBrowserInjected.insertSessionBefore` / `MessageFeedbackInjected` 删除(零消费)、mobile 权限控件 DOM anchor(对照 0.1.6 `PermissionSelect.tsx` 静态核实:trigger 按钮仍渲染 anchor 探测的文本 span 与 aria-hidden chevron)。

## 决策

- **基线一次性机械升线**:每包 `@deepseek-ai` devDependency `^0.1.5-rc.1` → `^0.1.6-alpha.1`(32 包 347 行),pnpm-workspace 的 `overrides` + `minimumReleaseAgeExclude` 钉版同步(exclude 条目带版本,且 alpha.1 当天发布);cordis override 维持 `4.0.2`(0.1.6 仍 vendored 4.0.2)。`dsh.compat` 的 minHost/verifiedHost **刻意不动**——只在波次的兼容标注流程里说动才动。
- **第二个 harness 检出承载 alpha 线**:`~/code/deepseek-harness-alpha` 是 harness 在 `dsh-v0.1.6-alpha.1` 的 detached worktree;波次 build/test 用指向它的 `DSH_HARNESS` 跑,共享 `~/code/deepseek-harness` 留 0.1.5 到合线(其他 agent 在用它解析)。alpha 检出必须**完整构建**(`pnpm install && pnpm run build`):ankh-guard 的 preflight drift tripwire 经 `lib/` 入口 import harness 包,只装不建的检出会以一个 `[object Object]` 的不透明 import 错误挂掉该 lane。
- **向前修,不加兼容 shim**。五处命中都是官方改名或新必填字段,正确值显然;0.1.5 的接受度来自这些字段在我们的用法里是纯增量(0.1.5 运行时永远看不到它们)。五处都不需要探针。
- **rc 复验排进日程而不是假设**。周四的 0.1.6 rc 在合并前重新审计——0.1.5 线的消息编辑曾在 alpha.2 与 rc.1 之间被回退,alpha.1 是证据不是保证。

## 否决的方案

- **minHost 随适配前移 0.1.6-alpha.1**——会把 npm `latest`(0.1.5-rc.1)上的社区用户全部关在门外,零行为收益;波次策略禁止。
- **共享 harness 检出来回切换**——多 agent 隐患:其他 worktree 的类型解析与 gen-typert 都走 `DSH_HARNESS`,波中翻动会打断别人的构建。双检出在 0.1.2-alpha 复核时已有先例。
- **整体适配等 rc 再说**——headless 的 `dsh-code-runtime-worker-thread` 依赖与 web-dev 的 `workflow-worker-thread` 行在 0.1.6 上是**安装期**失败,不是优雅降级;等 rc 会让仓库对着即将定稿的线处于不可构建状态。

## 后果

- 仓库对 0.1.6-alpha.1 build + test 全绿,0.1.5 上行为零变化。
- `peerDependencies` 范围(`^0.1.0-rc.6`)在严格 node-semver tuple 规则下仍盖不住 0.1.5/0.1.6 的 prerelease(pnpm 目前只警告);复核项挂在波次的 npm 发布 checklist(`docs/publishing.md`)。
- S12 restore projection 随波次同批交付,暗态由 fold 语义闸门把守——见 [restore-projection note](../feature/2026-09-15-message-tools-restore-projection.zh.md)。
- ankh-guard 的在飞 test-lifecycle 分支(`fix/ankh-guard-test-lifecycle`)与本批后续的测试保真工作(给 `agent/created` emit 补 `source`)碰同一个 spec 文件,合并时协调。
- rc tag 落地后:重跑 seam 台账核对 → 重钉(alpha.1 → rc)→ 全量 build/test 复扫 → 合并并把共享检出推向前。
