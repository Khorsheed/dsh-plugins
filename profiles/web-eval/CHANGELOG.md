# Changelog

## Unreleased

- I0 规划版本：22 个成员的评测模式 profile（基础体验 12 + 本地 Agent 家族 6 + 评测机制 3 + 运维守护 1）。编排器 `@khorsheed/dsh-eval` 尚未存在，随 I2 加入成员清单。
- M4'③：mission / datasets / eval 拆成 core + companion。按域档位（`read` / `authoring` / `all`）从 profile 根的 core 行移到 `eval` 预设的三条伴生行（`mission-tool` / `datasets-tool` / `eval-tool`）；三个 core 行不再写 `tools`。此后本 profile 中非 `eval` 预设的会话不携带这三套模型工具（服务 / CLI / slash / tab 仍是全局的）。
- `presets/eval` 的 persona 行改用 0.1.5 线的配置键 `prefix`（原 `text` 是 0.1.2 线的键，让 capability-catalog 在 0.1.5 上量不了 `eval` 预设：`$.prefix missing required value`）。
- README 立住理想架构、依赖插件、理想流程、最终 UI 与迭代计划（I0–I6），每个迭代带完成判据。
- 同端口交接脚本 `restart-into-web-eval.sh`，与 web-dev 同款（仅改名），走 ankh-guard 守卫通道；评测实例应使用独立的 `$DSH_HOME`。
- 安装路径可从源码走通（I1 · T5，缺口 G5/G6）：`install.sh` 增加 `--source <dsh-plugins 检出>` 源码模式——构建未上架成员、按 `--family` 打 tarball 进 profile 的 `tarballs/`、写 pnpm overrides 钉住家族边，再标准安装；npm 模式行为不变（成员全部上架的 I6 前会撞 registry 404）。
