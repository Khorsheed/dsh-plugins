# Agent Note: headless bundle carries no dsh.bundle declaration

Status: implemented

[English](2026-09-05-headless-no-dsh-bundle-declaration.md) | 中文

## Problem

`@khorsheed/dsh-local-agent-dsh-headless` 是一个子 dsh 组合：它的 patch 行（persona 覆盖、`hmr` 关闭、`tools` mode、`code-runtime` insert、member-bridge MCP 行）只为家族 scoped home 下 provision 出的 `headless-local-agent-dsh` profile 而存在。但这个包此前的 manifest 声明了 `dsh.bundle`，而该声明正是宿主的挂载触发器：`dsh plugin` 的 reconcilePlugins 会把每一个声明 `dsh.bundle` 的 profile **直接依赖**追加进 layer 栈。把它装成直接依赖——在不用 pnpm override 时满足其未发布传递依赖的最顺手操作——于是把子 dsh 组合挂进了交互式 profile。i1-walk 的 G3（2026-09-03）就是 2026-08-23 P0 的复发：`code-runtime` entry id 撞重，全实例 boot 失败。此前的纪律（「装作依赖、人手删 bundles 行」「只作传递依赖安装」）只在每个操作者都记得时才成立。

动手前先定了两个根因问题：

1. **headless 是否应该成为 profile 的直接依赖？** 不应该。它是家族内部包：父级 `@khorsheed/dsh-local-agent-dsh` 以 `workspace:*` 依赖携带它，provision 从该安装闭包按路径解析 bundle 目录。tarball 流里家族边是 registry range（`^0.1.0-rc.6`），包未发布时无法解析，所以 pnpm `overrides` 钉版（prod-3080 的做法）让它保持纯传递依赖。但「装成直接依赖」这件事靠纪律挡不住——那是安装者最自然的绕行——所以指望「没人直接装它」不是修复。
2. **它的 `dsh.bundle` 声明是否应该存在？** 不应该。家族里没有任何东西消费它：provision 用 `require.resolve('@khorsheed/dsh-local-agent-dsh-headless/package.json')` 解析 headless 目录，从不读这个字段。声明的唯一正当消费者是子 profile 的 boot——`loadProfile` 对 bundles 列表里不声明 patch 的包 fail loud——而这个要求不用声明也能满足。剩下的消费者就是 reconcilePlugins，即 bug 本身。

## Decision

- headless 包**不再声明 `dsh.bundle`**（`dsh.compat` 块与随包发布的 `cordis.patch.yml` 保留）。reconcile 再也不可能挂载它；附带的好处是，旧方案下已经带着脏 bundles 行的 profile 会在下一次 reconcile 时自动摘掉该行——因为 `exportsPatch` 对新装版本返回 false。
- 组合的落位归 provisioner（`packages/local-agent-dsh/src/provision.ts`）管：子 profile 的 manifest 只列 `@deepseek-ai/dsh-base`，headless patch 从 bundle 目录的 `cordis.patch.yml`（已知文件名）逐字节拷贝进子 profile 自己的 patch 层。该层在所有 bundle 层之后生效——与原先 headless bundle 行的位置等价。拷贝在内容不一致时重写，既治愈旧方案 provision 的 profile（它们的 manifest 把 headless 列为 layer，如今会 fail `loadProfile`），也把 patch 升级带进既有 scoped home；稳态下重复运行是 no-op。`node_modules` 符号链接保留：loader 解析 patch 的 insert 行仍靠它。
- `check-plugin-independence` 把 headless 包加进 `NO_OWN_PATCH`：它是家族内部组合，patch 由 provisioner 代为挂载，与 tool-subagent 的 provider 代挂行同理。
- 防御层保留：`webStartup` 不变量伴随与钉住 `code-runtime` insert 行 id 的 patch spec，在组合被手工接进 web profile 时依旧 fail loud。

已按一次性 home 在 npm 0.1.1-rc.2 工具链上验证：全新 `web` profile，`dsh plugin add` local-agent-dsh tarball（headless 经 overrides 作传递依赖），再故意 `dsh plugin add` headless tarball 作直接依赖——reconcile 打出 plain-dependency 警告且不挂载任何东西；`--dump-config` 组合成功，`code-runtime` 恰一行、headless 行为零；实例 boot 通过；provision 出的子 profile boot 成功，真实子 dsh 一次性一轮应答并 exit 0。

## Alternatives considered

**保留声明，靠 overrides + 纪律（修复前的绕行）。** 否决：这正是产出两次生产事故的安排。触发器对未来的每一个安装面都保持上膛，README 的「绝不要作直接依赖」与安装者最不意外的动作之间的矛盾继续靠记忆解决。

**让 headless 根本不需要显式安装：`pack-dist --family` 把家族内部边改写成 `file:` tarball spec。** 本任务否决：这改的是共享打包脚本（docs/development.md 归 mainline 管），且不加小心就会把构建机路径烤进可发布的 tarball；registry/npm 路径上声明依旧上膛。overrides 钉版就是 profile 流的既定等价物。

**等上游拆分声明（docs/upstream-seam-registry.md S9 的 `dsh.bundle.autoMount: false`）。** 作为主修复否决：harness 是跟踪不是修改，seam 的退役节奏在上游。我们这边根本不再需要这个声明，所以本包的 S9 直接关闭而非继续挂着；该条目注明上游拆分仍是未来任何家族内部 bundle 的一般解法。

**headless 留在子 profile 的 bundles 列表里，patch 另想办法送达。** 不改 harness 做不到：`loadProfile` 对列表里 manifest 不声明 patch 的包 fail loud——恰恰是我们要撤掉的声明。

## Consequences

- 子 profile 的 `--dump-default-config`（bundles-only 诊断）不再包含 headless 行，因为它们现在住在用户 patch 层；`--dump-config` 与真实 boot 都读该层，看到完整组合。
- 本变更之前 provision 的 profile 在下一次 provision 时自愈（父级在 toggle-on 与每轮委派前都会重跑 provision）：脏 bundles 行与空 patch 层被重写，无需任何手工 scoped-home 手术。
- 未来任何 patch 面向嵌套组合的包都必须走这个模式——不声明 `dsh.bundle`，由 provisioner 或父 patch 落位——并加进 `NO_OWN_PATCH`，理由以本 note 为准。
- reconcile 的摘除副作用意味着：若有 profile 真的想挂载 headless（现无已知者），升级后会静默丢行；这个丢失正是本修复的意图。
