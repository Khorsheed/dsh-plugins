# Agent Note: typesafe 工具行折进核心包

Status: implemented

## Problem

`@khorsheed/dsh-typesafe-tool` 是树里最后一个独立的 preset 组合伴生包。它只装一条工具行——对核心包 `typesafe` 服务的 `inject`、一个布尔 `tools:` 配置、`typesafe_judge` 定义、它的提示词段和 `typesafe-decide` skill——一切委托给 `ctx.typesafe`。它是一个完整的发布单元（双语 README、locale 卡、发布席位、日后的退役负担），却没有任何值得拆分的代码；跨包缝隙还迫使工具行用结构接口重新声明核心包的线上类型，且永远不能 import 它们。家族级先例（canvas `./agent`、worktrees 0.3.0、room 0.2.0、local-agent 折叠、T88 评测家族折叠）早已证明：`./tool` 组合入口给出完全相同的授予点，却不需要多出来的包。

## Decision

host-021 波（2026-10-18）的一次纯形态整理，逐项照 T88 走。能力不挪包。

1. **工具折进核心包的 `./tool` 入口。** `packages/typesafe-tool/src/index.ts` 搬进 `packages/typesafe/src/tool.ts`，保留行 id（`export const name = 'typesafe-tool'`）、`inject = ['typesafe']` 声明（2026-09-27 启动顺序教训）和 `tools:` 布尔配置。工具 origin owner 与 skill 的 `provider` 归一到 `@khorsheed/dsh-typesafe`。结构缝隙类型（`TypeSafeSeam` 等）让位给同包类型直引（`QuestionSpec` / `Decision` / `JudgeResult` / `TypeSafeService`），外加 `import type {} from './index.ts'` 拉入 `Context.typesafe` 增强。套件进 `tests/tool-row.spec.ts`；`typesafe-decide` skill 进 `packages/typesafe/skills/`。包新增 `./tool` export、`@deepseek-ai/dsh-tools` peer，`files` 加 `skills/**/*.md` 与 `lib/*.js`，tsdown 加第二个入口。
2. **组合改指，行 id 不变。** `packages/presets` 的 dsh-dev preset 保持 `id: typesafe-tool`，只把 `name` 改为 `@khorsheed/dsh-typesafe/tool`；`dsh.references` 与 README/compat 说明里的工具行清单同步。preset 的组合状态不受影响。
3. **伴生包退役。** 目录删除，名字登记进 `scripts/retired-packages.ts`（已发布的 0.1.2 npm 名随同一发布波 deprecate）。check-plugin-independence 把它从 `NO_OWN_PATCH` 摘掉（`preset-composed-row` 词汇值保留；树内已无该形态包），`COMMUNITY_SERVICE_INJECTORS` 的 `typesafe` 条目改为核心包自注；spec 夹具改用 `local-agent-dsh-headless`。

## Alternatives considered

**保持独立 tool 包。** 否决，与此前每次折叠的理由相同。拆分的唯一目的是给模型面一个独立的授予点，而 `./tool` 子路径行恰恰就是这个授予点：preset 点名即授予，其它会话拿不到。留着这个包只是留着一个没有代码的发布单元和它的账面工作，还让工具行的类型永远靠结构重声明。

**折进核心包（选定）。** 按会话授予、配置键与行 id 原样保留；只有模块名移动，组合侧改 `name` 即可吸收。

## Consequences

- `dsh plugin add @khorsheed/dsh-typesafe` 仍只挂核心行；`./tool` 行随包携带，保持 preset 授予。capability-catalog 把 `typesafe_judge` 归因到 `@khorsheed/dsh-typesafe`——用户实际管理的那张卡；独立的「TypeSafe Tool」卡随退役包消失。
- 仓外引用了 `@khorsheed/dsh-typesafe-tool` 的组合须把 `name` 改指 `@khorsheed/dsh-typesafe/tool`。仓内由 check-profile-bundles 拦住任何仍点名退役包的组合。
- 工具行的类型再也不可能与服务的类型漂移：两侧同在一个包的 `src/`。
- 树内不再有 `preset-composed-row` 形态的包；该词汇值保留在 manifest 元数据语法里。

## Testing

- `packages/typesafe` 构建 + 套件，含搬入的 `tool-row.spec.ts`（行形态、core 缺席降级、`tools: false`、origin owner、答案渲染）。
- `pnpm check:plugins`（NO_OWN_PATCH / injectors / 卡标题唯一性）、`pnpm test:scripts`（折叠后形态的 checker 夹具）、presets 包套件（改指后的行钉）。
- 未覆盖：没有真实 boot——该行的挂载路径与 T88 各行在生产上跑的 inject/延迟注册形态完全相同。

## Related

- 本次照抄的折叠：[评测家族把工具包折进核心包](2026-10-01-eval-family-tool-fold-and-bundle.zh.md)。
- `inject` 声明背后的启动顺序教训：[preset 组合的工具行声明对核心服务的 inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.zh.md)。
- typesafe 这对包的起点：[typesafe 决策原语](../feature/2026-09-20-typesafe-decision-primitive.zh.md)。
