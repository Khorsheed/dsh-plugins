# 变更记录

## Unreleased（0.1.0 线）

- **改名**:npm 包名 `@khorsheed/dsh-bundle-eval` → `@khorsheed/dsh-eval-suite`(首发前改名,旧名从未发布)。包名与卡名「…套件」对齐,并与同名的镜像仓/集合名分开;preset id、行 id 与目录不变,会话与设置无感。
- **升级为模式包（`dsh.bundle.kind: 'mode'`,mode `dsh-eval`）**：patch 末尾新增一行 `preset-dsh-eval`(`@deepseek-ai/dsh-agent-preset` 声明,逐字镜像自 @khorsheed/dsh-presets,parity 由 scripts/preset-mode-parity.spec.ts 钉住)——装本包即同时装出评测家族与「评测模式」preset。成员、行、卡面标题(评测套件)均不变。

## 0.1.0（2026-10-01）

首个版本（T88）。评测家族的 family bundle：patch 逐字复挂 datasets / mission / lab / eval 四个成员的规范行，成员作为 npm 依赖一并安装，locale 卡面元数据把整族归成一张「评测」卡。三个工具行不进 patch——它们是各核心包的 `./tool` 组合入口，由 agent 预设点名授予。
