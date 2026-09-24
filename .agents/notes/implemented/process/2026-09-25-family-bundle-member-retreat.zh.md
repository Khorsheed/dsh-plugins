# Agent Note: deploy-3080 让家族 bundle 的成员退出 profile 的直接名单

Status: implemented

## Problem

家族元包(`bundle-local-agent`、`bundle-conversation-toolbox`)通过 bundle 自己的 patch 挂载成员的规范行,成员则以传递 npm 依赖的身份到达、各自的自挂载 patch 保持惰性——`reconcilePlugins` 只把 profile 的**直接** `dsh.bundle` 依赖收编进 bundles 层。但部署流程此前没有任何「移除」能力:早年独立部署过的成员永远占着直接依赖和 bundles 名册条目。装了 bundle 的 profile 若还带着这些成员,家族的行会在重叠面上双份登记(官方 bundle 详情页的行级开关能调解,但行毕竟挂了两次);而插件清单页枚举的是带卡面元数据的直接依赖,于是每个成员还会持续领到一张本该被家族卡取代的顶层卡。

## Decision

`scripts/deploy-3080.mts` 现在对被点名包中声明 `dsh.bundle.kind: 'family'` 的执行**成员退场**,位置在第 3 步清单刷新之后:

- 每个 member 移出 profile 清单的 `dependencies` 与 `dsh.profile.bundles`。两处都已不在的成员记一行日志跳过——退场幂等,重复部署在这里是空操作。
- profile `pnpm-workspace.yaml` overrides 里成员的 `file:` 钉**保留**——bundle 里经 pack-dist 重写的 `^<版本>` 边靠它传递解析(overrides 对传递规格同样生效)。钉缺失时先从同次部署成员的新 tarball 补,否则取 tarballs 目录里最新匹配的存量;两者都没有就在 profile 安装前拒绝——没钉的成员边会漏到 registry(未发布的成员 404,已发布的悄悄装上旧版)。
- 同一次调用里被一起点名的成员(`--package packages/bundle-x --package packages/<member>`,顺序无关)先 pack——第 2 步刷新它的 tarball 与钉——bundle 后注册/退场;成员被排除在官方 `plugin add` 之外,它自己的行不会重新登记到 bundle patch 的副本之上。这也是文档规定的成员更新方式。
- 安装后校验对称扩展:bundle 留在 `dependencies`,成员留在 bundles 名册与直接依赖**之外**,且每个成员必须仍能从 bundle 的安装目录出发被 `require.resolve`——从 bundle 的**真实**目录出发,因为 pnpm 把一个包的依赖放在它的 store 条目旁边,而不是带符号链接的顶层路径下面。同部署的成员额外复核解析产物的名字/版本。

bundle 自身的首装不变:仍由官方 `plugin add <tgz> --profile web` 登记。

## Alternatives considered

**让成员与 bundle 并列留在直接依赖里。** 否决:这正是家族 patch 头注释警告的双挂,还会留着冗余的顶层清单卡——家族形态要消除的恰是这两样。

**退场时顺手删掉成员的 overrides 钉。** 否决:bundle 的成员边是 `^<版本>` 区间,能解析全靠钉把名字映射到 `file:` tarball;拔掉钉,pnpm 就走 registry,要么 404,要么悄悄装上已发布的旧版。钉是传递解析的承重件,退场保留它(必要时补回它)。

**钉缺失时静默吃 registry 回退。** 否决:对已发布 npm 的成员,安装会成功但装的是昨天的版本——静默降级。拒绝信息直接点名修法(把成员一起点名),而这也正是文档规定的成员更新工作流。

**从带符号链接的 `node_modules/<bundle>` 路径解析成员。** 否决:在 pnpm 下这条路径的 `node_modules` 链永远到不了 bundle 的 store 邻域,校验会在健康的 profile 上误报;校验先对 bundle 目录做 realpath。

## Consequences

- 部署一次家族 bundle 就把 profile 迁移到目标终态:成员退出直接名单、清单页只出一张家族卡、各行由 bundle patch 挂一次。
- `scripts/deploy-3080.spec.ts` 新增七个家族用例,钉住 `dependencies`、bundles 名册、overrides 块三处退场前后的精确形态、幂等、同部署顺序、bundle 经官方 add 首装、成员缺失的跳过日志、从存量 tarball 补钉,以及安装前拒绝的失败路径。
- spec 的命令边界 stub 现在模拟家族用例依赖的两个真实行为:pack-dist 的 `workspace:*` → `^<版本>` 边重写,以及经 overrides 钉的传递解析。
- 成员更新必须与 bundle 一起点名(docs/ops.md 已写);单独部署成员仍然可行并保持其独立安装——只有 bundle 被点名时退场才触发。
