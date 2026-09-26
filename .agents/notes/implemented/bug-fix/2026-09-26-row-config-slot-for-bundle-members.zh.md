# Agent Note: family-bundle members register their settings card on the row-level slot (`plugins.row.config`)

Status: implemented

## Problem

家族 bundle 化把成员包移出了 profile 的直接依赖：安装 `@khorsheed/dsh-bundle-local-agent` 或 `@khorsheed/dsh-bundle-conversation-toolbox` 时应用的是 bundle 的 patch（逐字重挂成员行），成员作为传递依赖到达。而插件页只给直接依赖开详情页，所以注册在 `plugins.bundle.config`、键为成员自己包名的成员设置卡——各 provider 的登录/认证面、context-guard 的阈值编辑卡——无家可归：成员详情页没了，bundle 的页面又不知道这张卡。恰恰是家族 bundle 要推广的安腾形态让卡失了入口。

## Decision

每个受影响成员的客户端 apply 新增第三条设置面注册轨，置于独立安装轨与 0.1.5 legacy 轨之间：

- **独立安装**——`plugins.bundle.config`，键为成员自己的包名（自己的详情页），不变；
- **随家族 bundle 安装**——`plugins.row.config`，键为 `<bundle 包名>#<行 id>`，行 id 以 bundle 的 `cordis.patch.yml` 声明为准（宿主 `rowConfigKey` 的形状；bundle 详情页随后给该行一个「配置」入口，打开即以该插件的标题/描述为头的配置页）;
- **0.1.5**——legacy `settings.plugin.item` 卡，不变。

三轨全部走 `slots.inject`，只有宿主声明了对应槽位的那一轨才开火（0.1.5 宿主跳过两个 alpha.2 槽位；未装 bundle 的宿主上 row 键只是惰性数据，无页面渲染它）。组件、`locale`、`inject` 全部复用现有轨的值——不新写 UI。键里嵌入的 bundle 包名是纯数据的跨包引用，申报在成员的 `dsh.references`（既定申报位；pack-dist 的 family-edge 检查认得它）。

五个成员及其键：四个 local-agent provider(claude-code、codex、kimi、dsh）挂在 `@khorsheed/dsh-bundle-local-agent#<行 id>` 下，context-guard 挂在 `@khorsheed/dsh-bundle-conversation-toolbox#context-guard` 下。

## Alternatives considered

**让成员继续作为 profile 直接依赖与 bundle 并存。** 被否：这违背家族 bundle 的一卡安装初衷，还会重现 bundle 逐字重挂所独有的 duplicate-row-id 冲突。

**请上游给传递依赖也开详情页。** 被否：宿主为这件事设计好的接缝本来就在——行级槽位正是正解（bundle 拥有自己的页面，行拥有自己的配置）；上游变更管线是留给缺失接缝的，不是用来拒绝现有接缝的。

**把各成员的卡合并成一张 bundle 级配置页。** 被否：这些卡是按 provider 分的面，认证流程各不相同（claude-code 的手工交接、codex 的设备码、dsh 走宿主凭证）；合并成一页既丢失宿主按行渲染的标题/描述身份，又把各成员的 UI 无谓耦合起来。

## Consequences

所得：成员设置卡在两种安装形态下都可达——独立安装走自己的页面，随家族安装走 bundle 页面上的行级「配置」入口——0.1.5 线不受影响。模式就此成文，供未来任何带设置卡的 bundle 成员遵循：注册到 `plugins.row.config`、键取 bundle patch 声明的行 id、把 bundle 名申报进 `dsh.references`。

所费：五个包各多一条「未渲染时惰性」的注册和一条 references 申报；行键把 bundle patch 里的行 id 字符串复制了一份（那边改名这边必须同步——今天没有机械检查拴住两者）。

## Testing

各包既有 client-apply spec 新增行轨断言：四个 local-agent provider 的 `client-apply.spec.ts` 假注册表 describe（改名为三轨实况）钉住 `{ name: 'plugins.row.config', key: '<bundle>#<row>' }`；context-guard 的真 SlotRegistry spec 在声明 `plugins.row.config` 槽位的环境中启动，断言注册以 conversation-toolbox 键出现且随 fiber 移除。

## Related

- [Family bundles and collections（提案）](../../../proposals/active/2026-09-24-family-bundles-and-collections.md) —— 行重挂决策，无家可归的卡即由此产生。
