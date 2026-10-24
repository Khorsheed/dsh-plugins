# 变更记录

## 未发布

- **preset 行正本归本包**:`@khorsheed/dsh-presets` 退役,本包 patch 里的 preset 行不再是镜像,而是唯一副本(组合内容不变)。
- **改名**:npm 包名 `@khorsheed/dsh-writing` → `@khorsheed/dsh-writing-suite`(首发前改名,旧名从未发布)。包名与卡名「…套件」对齐,并与同名的镜像仓/集合名分开;preset id、行 id 与目录不变,会话与设置无感。
- 成员加入本机转写(`transcribe`)与渲染抓取(`capture`)：灵感空间的本机转写引擎，和它「渲染抓取」所用的后台 Chrome（从基础合集移来）。
- 成员加入灵感空间(`reader`);preset 授予 `reader-tool`,灵感空间页签只在授予它的会话里出现。

## 0.1.0(2026-10-18)

首个公开发布:写作模式包——`dsh-writing` preset 行(镜像自 @khorsheed/dsh-presets)+ canvas 与 canvas-novel 的规范行;根级 canvas-agent 行以 override 停用,画布工具收窄为仅写作模式会话。
