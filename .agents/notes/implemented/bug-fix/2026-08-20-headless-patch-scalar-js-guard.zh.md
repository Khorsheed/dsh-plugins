# Agent Note: headless bundle patch —— `!!js` 只支持标量，patch 改动需要启动级验证

Status: implemented

[English](2026-08-20-headless-patch-scalar-js-guard.md) | 中文

## Problem

成员通道 M3 给 headless bundle patch 新增的 member-bridge 行（be0b300）写的是 `args: !!js […]`——`!!js` 标签打在 flow 序列上。loader 的 entry-list 方言把 `!!js` 定义为**仅标量**的 js-yaml 类型（harness 的 `vendor/include/src/index.ts`），所以整个 profile 在启动时的解析阶段就失败，早于任何插件代码运行。该改动通过了包测试和 review，但从未做过启动级验证。这里有两个独立的防复发缺口：仓内没有任何检查钉住 patch 方言，且 headless bundle 的挂载纪律（仅子 profile）此前只存在于 patch 文件注释里。

## Decision

- `packages/local-agent-dsh-headless/tests/patch.spec.ts` 用 js-yaml 以 harness include 同款的仅标量 `!!js` 类型定义解析 `cordis.patch.yml`，误标集合在 `pnpm test` 阶段就失败而不是留到 profile 启动；第二个用例钉住 member-bridge 行的形状（args/env 的值均为带标签的标量表达式、`failOnStartupError: false`）。js-yaml 列为 devDependency。
- headless README（双语）新增**挂载纪律**一节：该 bundle 绝不可加入交互式 profile 的 `bundles`（其 persona/hmr/tools/code-runtime 行是子 profile 专属，挂载即冲突或泄漏）；子 profile 由父侧 provider 自动 provision（`provisionDshSubProfile`），任何地方都无需手工挂载；patch 改动必须做启动级验证（对组合了本 bundle 的 profile 跑 `dsh preflight`，或真实拉起一次子 dsh）。

## Alternatives considered

- **字符串匹配 patch（如 `local-agent/tests/patch.spec.ts`）**——作为护栏否决：子串断言看不见 标签/节点类型误用，用真实方言规则解析才能看见。
- **仓库级共享 patch linter**——暂缓：一个包的一次事故还不足以证明需要跨仓门禁；若第二个包踩中同类问题，再把 `patch.spec.ts` 的 schema 检查提升进 `scripts/`。

## Consequences

- 这个 bug 类（非标量 `!!js`）现在在测试阶段快速失败；启动级验证要求和禁挂交互式 profile 的规则写进了未来编辑者一定会读到的地方。
- 启动级验证缺口本身是流程而非代码：包测试证明不了 profile 能启动。对 patch 改动而言，真实 profile 拉起仍是权威闸。
