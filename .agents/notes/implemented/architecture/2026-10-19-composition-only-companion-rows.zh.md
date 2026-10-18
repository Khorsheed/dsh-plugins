# Agent Note: 伴生行只活在 preset 组合里,评测套件接管 local-agent 家族

Status: implemented

## Problem

模式包落地([2026-10-18-mode-bundle-packs](2026-10-18-mode-bundle-packs.zh.md))留下两个尾巴。其一,gamedev 和 writing 在 profile 根带着出厂**停用**的「手柄行」(`game-agent`、`canvas-novel-agent`,外加一条 `canvas-agent` 裸禁用覆盖),而 dev/learning/video/bundle-eval 从不这么干——这是 0.2.x 之前「同 id 的 profile 行与 preset 组合行双注册会崩 boot」观念的遗迹;手柄行把插件列表弄出「已关闭」卡片噪音,唯一用处是全局开启的后门。其二,评测套件没带 local-agent 家族,可 eval 的 run 动词每个 cell 都经 `localAgent` 服务门面委派,缺了它 provision 直接拒绝(`packages/eval/src/service.ts` 的 run/provision)——套件的核心流程栽在一个没装的依赖上。

## Decision

伴生工具/agent 行只活在 preset 组合里。模式包的 patch 只 insert 成员的**根行**(逐字复制自成员 patch)加它那一行 preset;模块名带子路径的行(`@khorsheed/dsh-game/agent`、`…/tool`)一律不进 profile 根——由包内 preset 按会话授予。gamedev 删掉了停用的 `game-agent` insert;writing 删掉了停用的 `canvas-novel-agent` insert 和 `canvas-agent` 裸覆盖。宿主 0.2.x 让旧崩溃理由作废:同 id 行在 profile 根与 preset 作用域是遮蔽而非相撞(宿主 `packages/core/tools/tests/scoped.spec.ts` 钉着 "scoped shadows global on a name conflict, in either registration order"),canvas/game/canvas-novel/writing/gamedev 的 patch 与 README 里的过时警告已一并改写。

成员 patch 反向翻转:game 和 canvas-novel 的 `./agent` 行在自有 patch 里出厂**使能**(canvas 本来如此)。成员 patch 在套件下惰性(成员是传递依赖)、单装时激活——单装现在开箱即有工具,不用再找开关。

bundle-eval 的成员加入 local-agent 家族(核心 + kimi/codex/claude-code/dsh 四 provider;headless 依旧 deps-only),行逐字复制自 dev 包(含两条官方工具裸禁用覆盖)。preset-dsh-eval 的组合不动:家族是 eval run/provision 路径的**服务**依赖,不是会话工具授予。dev 与 bundle-eval 的成员重叠是刻意且安全的:同 id 行跨 bundle 层塌缩成一条 entry(后写层赢),checker 新规则把共享行跨 bundle 钉成逐字一致(剥注释、单引号归一为双引号),两份拷贝不可能漂移。

`scripts/check-plugin-independence.ts` 的 mode 钉板改为:pack 行 = 成员 patch 项并集**减去** name 带子路径的成员行;每条被减去的伴生行 id 必须出现在本包内联 preset 的组合里且模块名一致;组合里每个 `@khorsheed` 模块必须属于成员之一;外加上述跨 bundle 行一致性规则。这只是把 dev/learning/video/bundle-eval 的现行做法写成规约。

## Alternatives considered

**单独建「多智能体协作」套件(复活 bundle-local-agent),dev 相应瘦身。** 否决:宿主只协调 profile 的**直接依赖** bundle——bundle 套 bundle 不会挂载(plugin-manager 的 `installBundle` 差集与 `reconcile` 都只读一层),dev 无法「包含」它;而且 dev preset 点名一个可能未装套件的工具行,崩的是**整个** preset(选择时报 `agent-preset/invalid`),不只是少三个工具。重叠放置让两个套件各自自足、preset 零手术。bundle-local-agent 维持退役;单装路径(核心 + provider,核心缺席时 provider 挂 pending)仍服务「模式之外的委派」需求。

**保留手柄行。** 否决:它唯一真实的需求是单装,而单装由「成员行使能」服务得更好;套件语境下它只是惰性噪音加全局开启的误触点。

**连成员的 `./agent` 行一起删。** 否决:单装会彻底丢掉工具,没有补救路径。

**在 dev 包里把委派 `./tool` 行全局授予。** 否决:按会话授予保持非 dev 会话的工具目录干净;组合机制就是为这个存在的。

## Consequences

- 插件管理器不再出现 `game-agent` / `canvas-novel-agent` 的「已关闭」卡;设置清单页的 preset 区不变(它读组合,不读 profile 行)。
- canvas 的「单装 + 套件」混装从「被 writing 包覆盖强制停用」变为遮蔽——单装的选择生效;接受,这才是诚实的分层。
- mode-bundle-packs 笔记的「有意偏离」段已更新为本现实。
- presets 包的注释保留旧措辞直到退役(parity 比的是组合,不比注释)。

## Testing

`pnpm check:plugins` 48 包 0 findings;`pnpm test:scripts` 绿(含新规则的单测/集成用例与两个 preset parity spec);各包测试绿(writing 7、gamedev 7、bundle-eval 8、canvas-novel 184、game 33、canvas 620);提交前对 0.2.1 宿主树(DSH_HARNESS=deepseek-harness-021)的全量 `pnpm run build && pnpm run test` 门禁绿。
