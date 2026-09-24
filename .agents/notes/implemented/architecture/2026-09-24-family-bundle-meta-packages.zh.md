# Agent Note: 家族 bundle 元包与 `dsh.bundle.kind: 'family'` 闸门 sanction(波 1)

Status: implemented

## Problem

本仓发布 30+ 个自挂载插件包;裸装进宿主 0.1.7-rc.1 的插件清单是一屏散卡,而官方形态把一个家族聚成**一张** bundle 卡、携带多个 loader 行(详情页带行级开关)。家族 bundle 提案([2026-09-24-family-bundles-and-collections](../../../proposals/active/2026-09-24-family-bundles-and-collections.md),v3 已拍板)把包组织成薄**家族 bundle 元包**——patch 复挂成员的规范行 + npm 依赖带齐成员——但两条仓级规则恰恰禁止这个形态:

- `check-plugin-independence` 的 patch row ownership 规则:任何包的 patch 不得挂载别的**自挂载**包的行(local-agent 双挂事故的冻结条款);其 loader 行 id 台账把两个 patch 里的同名行 id 计为炸 boot 的重复;
- 身份三角要求每个自挂载包挂自己的运行时行,而纯组合 bundle 故意没有。

没有 sanction,要落地这个形态只能绕过闸门——这正是闸门存在所要杜绝的动作。

## Decision

波 1(形态验证)落地 sanction 加两个样例 bundle。

**Sanction**(`scripts/check-plugin-independence.ts`):`BUNDLE_KINDS` 收入 `'family'`,由 bundle 清单以 `dsh.bundle: { patch, kind: 'family', members: [...] }` 声明。封闭词表的先例是同日的 `preset-declarations`(`packages/presets`):清单元数据决定,绝不靠推断。对 family bundle,闸门钉死:

- patch 顶层行只允许落在精确白名单内——白名单 = 所声明成员各自规范 patch 行的全集(id 相同、有 name 则 name 相同;bare override 的 id 同样必须来自成员的 patch——provider 规范行点名家族 deps-only 工具包正是沿这条路放行);
- 每个成员必须是仓内真实的自挂载包,必须列进 `dependencies`(装 bundle 即带齐家族),并登记进 `dsh.references`(名册是 pack 期与目录层读取的数据——边/名册互斥规则对声明成员豁免);
- 每个成员至少贡献一行,清单名册与 patch 不可能悄悄漂移;
- bundle 自身零注册:无 `dsh.client` 浏览器面,src 不得携带 apply 入口、`inject` 声明或任何服务/工具/槽位/命令注册(`FAMILY_REGISTRATION_RE`)。

由此放开的两条跨包豁免都收窄在同一个规范行白名单上:loader 行 id 台账整个跳过 family bundle 的 patch(这些行**就是**成员的行——`dsh plugin add` 只收编 profile 的直接依赖,装 bundle 绝不会连同应用成员自己的 patch);patch row ownership 仅当 family bundle 的行逐字匹配成员规范行时豁免。指向声明成员的依赖边由清单 sanction;bundle 顺带安装的 deps-only 家族库仍走显式 `ALLOWED_EDGES` 条目。

**两个样例 bundle**(`@khorsheed/dsh-bundle-<name>`,均 0.1.0,照 dsh-presets 薄元包形态:`src/index.ts` 常量桩保证可构建 `lib/`,tsc+tsdown,`locale/en.json`+`zh.json` 卡面元数据,双语 README 含 Compatibility,`dsh.compat`/`dsh.references`/`files`/`exports`):

- `packages/bundle-local-agent`「本地多Agent」——成员:local-agent 核 + kimi / codex / claude-code / dsh 四个 provider(停用官方同名工具行的两条 override 逐字取自 codex / claude-code 的 patch)。`local-agent-tool-subagent` 与 `local-agent-dsh-headless` 是无卡 deps-only 库:进 `dependencies`(与 `ALLOWED_EDGES`)但不在 patch 行里出现(超出成员规范行已点名者)。
- `packages/bundle-conversation-toolbox`「会话工具箱」——成员:message-tools、message-timeline、session-title-edit、quote、inline-html-render、context-guard、taskpilot(各一条规范行)。

两包各带 spec 钉死 patch ↔ `FAMILY_MEMBERS` 常量 ↔ 清单(成员清单、规范行逐字复用、引用加引号、依赖与名册登记),以成员自己的 patch 为事实源。`dsh.compat.minHost` 取各家族成员最高地板(两者均 `0.1.5-rc.1`)。

## Alternatives considered

- **给 bundle 行开 ALLOWED_EDGES 式中央白名单。** 否决:白名单会重复每个成员 patch 已经声明的事实并悄悄漂移。「可挂载」从成员规范行推导保持单一事实源——成员改行 id,bundle 要么逐字跟上,要么过不了闸门。
- **成员只进 `dsh.references`(不进依赖边)。** 否决:安装契约是「装我 = 装一族」——只有 npm 依赖边能让成员模块在装入的 profile 里可解析。名册登记作为数据随行(pack 期检查与波 3 目录层读取);互斥规则的成员豁免记录了这一刻意的双重登记。
- **bundle patch 自行改写行(换 id、裁 config)。** 被逐字规则否决:家族 bundle 只复挂,绝不发明。行 id 跨挪窝稳定(提案「挪窝不换 id」),引用行 id 的会话与设置在包迁入 bundle 后无损。
- **一个整体跳过 family bundle 的大豁免。** 否决:豁免精确到形态所需(规范行匹配),严格半边(成员真实/自挂载/已声明/有覆盖、自身零注册)保证这个 kind 不会变成外来行的洗白通道。

## Consequences

- 对 profile `dsh plugin add @khorsheed/dsh-bundle-local-agent`(或 `-bundle-conversation-toolbox`)即把整族挂成一张 bundle 卡;成员单独直装仍自挂载,重叠由官方行级开关解决。两个 bundle 本次不进任何仓内 profile、不部署、不发 npm——profile 换引与 npm 波段归波 2。
- 闸门 spec 覆盖正向形态(含 provider 行点名 deps-only 家族库)与严格半边的每个失败模式;真实树扫描干净(43 包,0 findings)。
- `docs/packages.md` 已重录(两个 bundle 以自挂载 `bundle` 形态出现;不属于任何 profile)。
- 3093 实例上的波 1 验收(卡面分组、行开关)刻意不在本次范围,在提案里保持开放。
