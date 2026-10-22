# Agent Note: 评测家族把工具包折进核心包，并以 `@khorsheed/dsh-bundle-eval` 一次装齐

Status: implemented

## Problem

评测家族（datasets、mission、lab、eval）此前的形态，和 local-agent 在 2026-09-30 折叠前一样：

1. **每个带模型工具的核心包，工具都放在另一个伴生包里。** `@khorsheed/dsh-datasets-tool`、`@khorsheed/dsh-mission-tool`、`@khorsheed/dsh-eval-tool` 各只装一条工具行：对核心服务的 `inject`、一个 `tools:` 分层配置、一个从核心包 import 的定义工厂。三个都是发布单元，各带 invariant、双语 README、release-group 席位和日后的退役负担，自己却没有任何代码。
2. **没有一步装齐的路。** web-eval profile 把四个核心包和几个伴生包分别列为依赖。此前认为「整族一次装」要等上游的薄元包接口，这是误判：bundle-local-agent 已经证明家族 bundle 在今天的宿主上就能用。它的 patch 逐字复挂成员的规范行，成员作为传递依赖安装，自己的 patch 不生效，所以不会重复挂载。

## Decision

T88 只做形态整理，分六步，不在包之间挪任何能力。

1. **工具折进各核心包的 `./tool` 入口**（room 0.2.0 / worktrees 0.3.0 / local-agent 0.2.0 的模式）。
   - 每个核心包的定义工厂改名为 `src/tool-definition.ts`。
   - 新增 `src/tool.ts` 作为可挂载的行，保留：
     - 原来的 `name`；
     - 对核心服务的 `inject`，所以核心行提供服务之前这一行保持 pending（2026-09-27 的启动顺序教训）；
     - `tools:` 分层配置，原样不动。
   - 工具来源 owner 改成核心包名。
   - 伴生包的测试迁到各核心包的 `tests/tool-row.spec.ts`。
2. **组合改指，行 id 不变。** `packages/presets` 与 `profiles/web-eval/presets` 两处的 eval 预设保留 `datasets-tool`、`eval-tool` 两个 id，只把 `name` 改成 `@khorsheed/dsh-datasets/tool`、`@khorsheed/dsh-eval/tool`。mission 任务 tab 的判据（`MISSION_TOOL_ROW_MODULE`）和 datasets、eval 客户端 preset-visibility 的常量都换成子路径名。行为不变：eval 预设仍不点名 mission 的工具行，所以评测会话里任务 tab 照旧隐藏。（任务 tab 与其 Remote 数据面后来整体退役——见[退役 note](../simplification/2026-10-23-mission-tab-remote-retirement.md)；上述行 id 改指不受影响。）
3. **三个伴生包退役。**
   - 删除目录，名字写进 `scripts/retired-packages.ts`。
   - check-plugin-independence 从边与注入方名册里删掉它们，check-release-groups 从家族名册里删掉它们。两者 spec 的夹具都改到折叠后的形态。
4. **新包 `@khorsheed/dsh-bundle-eval` 0.1.0。**
   - 声明 `dsh.bundle.kind: 'family'`，成员是 datasets、mission、lab、eval，都是硬依赖。
   - `cordis.patch.yml` 是成员自身行的逐字并集。
   - locale 里卡片标题是「评测」；双语 README 把 lab 需要 Docker 写在已知限制里。
   - `tests/bundle.spec.ts` 从成员 patch 重新推导这个并集。
5. **web-eval profile 改为依赖这个 bundle。** `scripts/install.sh` 从源码打包它。scripts/check-profile-bundles 认得了 family 这种 kind：
   - 规则 4（闭包）：直接依赖里的家族 bundle 已经挂了某个成员时，不再要求把这个成员另外叠一层。
   - 规则 5（预设行可解析）：经 bundle 的硬依赖到达的成员 `./tool` 行算作可解析。
6. **版本。** 家族同步推进：
   - datasets、mission、lab、eval 升到 `0.2.0-rc.1`，`minHost` / `verifiedHost` 为 `0.2.0-rc.2`，README 的 Compatibility 节同步更新；
   - bundle-eval 从 `0.1.0` 起；
   - presets 升到 `0.3.0`。
   退役名在 npm 上的弃用标记留给发布波。

## The user's decision (2026-10-01)

照录 T88 文案：

- mission 不退役，作为家族成员进 bundle。
- 三个 *-tool 包折进各自核心包。
- datasets / mission / lab / eval 各自保持独立的包，能单装。
- 能力在包之间怎么分（哪些能力该挪包）另行评估讨论，不并进本任务；有结论后另开任务。

## Alternatives considered

**保持独立 tool 包。** 否决。当初拆出来，是为了让每个核心包的模型工具有一个独立的授予点。`./tool` 子路径入口提供完全相同的授予点：agent 预设点名这一行，其他会话就拿不到这些工具。保留这三个包，只是继续留着三个没有代码的发布单元和它们的簿记。

**折进核心包。采纳。** 这是全家族已有的先例（canvas `./agent`、room、worktrees、local-agent）。按会话授予、分层配置、行 id 都原样延续，唯一变的是模块名，组合里改一个 `name` 就吸收了。

**整族并成一个包。** 按用户决定否决。每个成员都要能单独安装（写题集的人只要 datasets，不需要 lab 的 Docker 运行时），mission 也是家族成员，不能并掉。一步装齐改由声明式的家族 bundle 提供：多了这条路，单装的路照样保留。至于有没有能力该在包之间挪，明确留给另行评估。

## Consequences

- 一条 `dsh plugin add @khorsheed/dsh-bundle-eval` 把四个核心行各挂一次。每个核心包仍能单独安装、单独运行，它的 `./tool` 行随包一起装上。
- web-eval 的依赖闭包少了三个包：临时实例 dump 实测 24 个 `@khorsheed` 名字、205 行 patch，每个顶层行 id 恰好出现一次。
- capability-catalog 把评测会话里的 `datasets_*` 工具归到 `@khorsheed/dsh-datasets`、`eval_*` 工具归到 `@khorsheed/dsh-eval`，也就是用户实际管理的那张卡。
- 仓外点名退役模块的组合必须改用 `/tool` 子路径。仓内由 check-profile-bundles 拦住任何点名退役包的组合。
- 家族一次装齐不再以上游薄元包接口为前提。docs/ops.md「整合包」改写为现行的两个家族 bundle，那个接口只作为历史保留。

## Testing

- 包测试：eval、datasets、mission、lab、presets、bundle-eval，含迁过来的 `tool-row.spec.ts`（行形态、缺核心时 pending、分层过滤、来源 owner）。
- check-profile-bundles 的 spec 新增家族 bundle 在规则 4 和规则 5 下的用例。
- 门禁：`pnpm check:plugins`、`pnpm check:profiles`、`pnpm test:scripts`、`pnpm check:hygiene --all`、`pnpm run verify-translation-pairing`。
- 在 0.2.0-rc.2 工具链上用 `install.sh --source --fresh` 起的临时 web-eval 实例上看到：
  - 每个顶层行 id 只出现一次；
  - 评测会话的 catalog 列出 datasets 与 eval 的读工具，owner 是各自的核心包，没有 `mission_*` 工具；
  - 评测会话的 tab 条里没有任务 tab；
  - 插件页显示「评测」卡。
- 未覆盖：没有配置凭据，所以没有跑到模型主动发起的工具调用。证据是 eval 预设作用域里的注册结果加上 Remote 读取。

## Related

- 本次照做的折叠：[local-agent 委派工具折进各 provider 的 `./tool` 入口](2026-09-30-local-agent-tool-fold.zh.md)。
- bundle 形态：[家族 bundle 元包](2026-09-24-family-bundle-meta-packages.zh.md)。
- `inject` 声明背后的启动顺序教训：[preset 工具行把核心服务声明为 inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.zh.md)。
- 文案：profiles/web-eval/docs/iterations.md 的 T88。
