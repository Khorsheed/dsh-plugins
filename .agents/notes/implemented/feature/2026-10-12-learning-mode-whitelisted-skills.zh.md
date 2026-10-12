# Agent Note: 学习模式的白名单化 skill 面

Status: implemented

## 问题

bundle-learning 的 preset 曾把 skill 面整体删掉（`tool-skill` + `skill-filesystem`），因为 skill 注册表会把所有无关的本地 skill 带进学习会话。代价在[按 preset 限定投递](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md)出现后显现：一个被显式限定到 `learning` 的 skill（weread-skills）被正确投递进了该 preset 的 scope 层，但会话里既没有 skill 工具也没有 catalog 注入——模型根本无从得知这个 skill 存在。

## 决策

preset 只挂 `tool-skill`——永不挂 `skill-filesystem`。组合里没有默认根 provider，本地 skill 根本不会从本 preset 进入注册表；学习会话看到的恰好只有 capability-catalog 受管投递限定到 `learning` 的那些 skill。限定投递把过去「全开或全关」的取舍变成了白名单。`tool-skill` 注入 `agents`/`tools`/`skills`，三者都沿 scope 父链可解析（注册表挂在根上），因此该行无需 config、无需配套 provider。catalog 在每个 pre-step 边界刷新会话的 catalog，注册表没有会话级缓存，所以新限定的 skill 在已打开的学习会话的下一轮即可到达。

## 考虑过的替代方案

**保持学习模式无 skill，并在 catalog UI 上加守卫**（把没有 skill 面的 preset 标为不可限定）。不作为主方案：把 skill 限定到学习模式是正当需求，而白名单组合已经让它安全。该守卫对未来不设 skill 面的 preset 仍是有效补充。

**挂标准模式的一对（`tool-skill` + `skill-filesystem`）。** 不采用：这会重新打开节食之初要关上的闸门——默认根里的每个本地 skill 都会涌进学习会话。

## 影响

skill 在学习模式从「不可能」变成「显式授予」，代价是多挂载一行。由于 fs 仍然不带，被限定 skill 的 bundle 分册（`search.md`、`notes.md` 等）依然不可读——只有 SKILL.md 到达模型；是否值得补一条只读的分册通道，留待观察到真实需求再定。bundle 规格测试现在钉死 `tool-skill` 在场、`skill-filesystem` 缺席。
