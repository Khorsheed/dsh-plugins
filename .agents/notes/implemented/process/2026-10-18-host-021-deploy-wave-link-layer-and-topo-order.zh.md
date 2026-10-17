# Agent Note: host-021 部署波 — 链接层刷新与拓扑部署序

Status: implemented

## 问题

0.2.1-rc.1 宿主升线部署（2026-10-18,单次 `deploy:3080` 调用全部 40 个生产包）撞上了两道此前从未在这个规模上被踩到的闸：

1. **依赖链接检查报 12 条悬空符号链接。** 手工 provisioning 的官方包链接层（`~/.dsh-official/profiles/node_modules/@deepseek-ai/*` 及其 `local-agent/dsh/profiles` 孪生）符号链接进宿主检出的 `apps/cli/node_modules` 树，让 profile 安装时的 peer 解析永远落在正在运行的宿主自己的包上。rc 切换会重排这棵树：rc.1 把 `dsh-skill-badge` 提升到了 cli 顶层、把 otel 两个包挪进了根 `.pnpm`、彻底移除了 `dsh-invariants` 与 `dsh-subagent-in-process-driver`，并在上游删掉了两个 workspace 包（`native/landlock-run`、`packages/experimental/schedule-bundle`)——它们的磁盘残留变成幻影目录，连带 `node_modules/.pnpm/node_modules/` 下的 pnpm 镜像链接一并悬空。
2. **清 lib 会把闸①变成拓扑排序问题。** pack-dist 的 stale-types 闸（ops.md 构建卫生第二坑）在 invariant 清扫删掉 35 个包的 `src/invariant.ts` 后迫使 `rm -rf packages/*/lib`。lib 一空，闸①按命令行顺序跑裸 `pnpm --filter <pkg> build` 就炸了：`local-agent-dsh` 引用 `@khorsheed/dsh-local-agent-dsh-headless/wire` 的类型，而 headless 排在它后面构建。

## 决策

- **链接层刷新并入每次宿主升线**，与文档已录的三件套（lockfile / `minimumReleaseAgeExclude` / 幻影目录清理）并列。机械动作：包还在但路径变了的链接重指；包已离开树的链接删除；幻影目录删除（检出里 `git status` 干净即证明剩下的全是被忽略的残留）。删除前把每条 `路径 -> 目标` 记录到 `~/.dsh-official/scratch/`（本波记录：`link-cleanup-20261018-host021.txt`)，然后 `pnpm deploy:check-links` 验证。
- **升线波部署的 `--package` 按仓内类型边的拓扑序给出。** 边清单可 grep(`grep -rhoE "from '@khorsheed/dsh-[a-z0-9-]+" packages/<pkg>/src`);截至本波：`local-agent` 先于四个 provider 与 `room`;`local-agent-dsh-headless` 先于 `local-agent-dsh`;`inline-html-render` 先于 `canvas`。`ui-panel-kit` 与 `ui-content-preview` 从 `src` 解析（exports 指向源码），不需要 lib，不产生顺序约束。
- desktop profile(`~/.dsh/profiles/desktop`）仍列着 rc.1 已在上游删除的 `@deepseek-ai/dsh-experimental-schedule-bundle`;desktop 升过 0.2.0 之前必须先摘掉这个 bundle。

## 放弃的备选

- **让 deploy-3080 内部自动拓扑排序 `--package`**：长期正解，但部署进行到一半不是改闸门契约（「按你给的顺序构建你点名的包」）的时机；先记录在此。
- **部署前全仓重建一次代替排序**：typert 新鲜度缓存以宿主检出 HEAD 为键，升线后共享检出没戳记，全量再生成要价 20–50 分钟；排序零成本。
- **写 provisioning 脚本从头重建链接层**：该层的起源早于仓库的脚本化时代，没有生成器；232 条链接的再生成脚本只有在这层再次变形时才值得写。

## 后果

- 代价：两轮部署空跑（闸①约 2 小时）才发现两种失败模式。收益：宿主升线部署从此是有验证清单的机械流程，rc.1 切换以 preflight PASS + canary PASS 完成。
- `docs/ops.md` 的升线三件套应在下一次文档过堂时增补链接层刷新为第四件（本波中途不改文档）。
- stale-types 闸从此有了一条波级触发器的实录：任何跨包删 `src` 文件的改动，部署前都必须清 lib；而清 lib 意味着 `--package` 必须拓扑序。

## 相关

- [host-021 invariant 清扫](../simplification/2026-10-17-host-021-invariant-sweep.md)—— 武装 stale-types 闸的那次 src 删除。
- [ankh-guard 自我部署 reconfigure](2026-09-26-ankh-guard-self-deploy-reconfigure.md)—— 本次切换如期触发 `reconfigure` 动词的 install anchor 漂移。
