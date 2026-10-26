# 变更记录

## 0.1.0（2026-10-24）

- **灵感画布移出成员**(2026-10-26):画布这一波不发布,套件不再带 `canvas` 行与 `canvas-agent` 授予;图书馆与灵感空间不依赖它,灵感空间的「同步到画布」在没装画布时自动隐藏。
- **preset 行正本归本包**:`@khorsheed/dsh-presets` 退役,本包 patch 里的 preset 行不再是镜像,而是唯一副本(组合内容不变)。
- **改名**:npm 包名 `@khorsheed/dsh-learning` → `@khorsheed/dsh-learning-suite`(首发前改名,旧名从未发布)。包名与卡名「…套件」对齐,并与同名的镜像仓/集合名分开;preset id、行 id 与目录不变,会话与设置无感。
- 成员加入本机转写(`transcribe`)与渲染抓取(`capture`)：灵感空间的本机转写引擎，和它「渲染抓取」所用的后台 Chrome（从基础合集移来）。
- 成员加入灵感空间(`reader`);preset 授予 `reader-tool`,页签只在授予它的会话里出现(同批加入的灵感画布已于 10-26 移出)。

首个公开发布:学习模式包——`dsh-learning` preset 行+ library 规范行。
