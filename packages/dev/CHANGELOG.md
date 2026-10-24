# 变更记录

## 0.1.0（2026-10-24）

- 文案:成员 room 的卡名随之改为「协作间」。
- **成员加入重启守卫(`ankh-guard`)与上下文透镜(`context-lens`)**:从基础体验移来,两者都是开发者用的;规范行原样挂载,地板同为 0.1.5-rc.1,minHost 不动。
- **preset 行正本归本包**:`@khorsheed/dsh-presets` 退役,本包 patch 里的 preset 行不再是镜像,而是唯一副本(组合内容不变)。
- **改名**:npm 包名 `@khorsheed/dsh-dev` → `@khorsheed/dsh-dev-suite`(首发前改名,旧名从未发布)。包名与卡名「…套件」对齐,并与同名的镜像仓/集合名分开;preset id、行 id 与目录不变,会话与设置无感。

首个公开发布:开发模式包——`dsh-dev` preset 行+ local-agent 家族五成员、worktrees、room、typesafe 的规范行,deps-only 库 local-agent-dsh-headless 随行。
