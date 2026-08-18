# Agent Note：dsh 子代理会话镜像——第四家 harness 的对比级记录

状态：已实现

[English](2026-08-18-local-agent-dsh-session-mirror.md) | 中文

## 问题

dsh harness（`local-agent-dsh`）通过 sub-dsh headless 进程委派，但父侧子会话没有任何镜像——只有 descriptor 和 turn 边界，没有对话、没有 token。kimi/codex/claude 都已做到对比级保真的内容与 usage 镜像，dsh 成了四家评测里缺数据的一家。

## 决策

从 sub-dsh 自己的会话文件做镜像——四家里最便宜、保真度最高的路径，因为 sub-dsh 会话与子会话**同 id** 且同为 `SessionEvent` 格式：

- `src/session-mirror.ts` 读取 `<scoped home>/sessions/<workspace>/<id>/session.jsonl[.zstd]`。解压用 Node ≥22.15 内置 `node:zlib` 的 zstd 支持——已发布的 `dsh-session-persistence-jsonl` rc.6 的 JS 导出了 `decompressZstdFrame` 但类型未声明，引包反而编译不过。**多帧处理是必须的**：持久化层每个 flush 批次追加一个 zstd 帧，Node 的单次（和流式）解压都停在第一帧——本镜像首次部署时就因此只读到了会话头，改为逐帧扫描解压（用双帧测试 fixture 钉住）。
- **无需注册表的轮次定位**：父侧的 turn/start 计数就是轮次号，sub-dsh 的 turn 编号在 fresh/resume 下完全一致——本轮镜像区间 = sub-dsh 事件中 `turn === round` 的 turn/start 到下一个 turn/start。天然抗重启（不需要 kimi 的 `kimiMirrorOffsets` 那种 offset map）。
- **逐字复制而非重新编码**：`user/message`（只放行 `source.kind === 'user'` 的任务消息——sub-dsh 自己的 agent-instructions/plugin/skill-catalog 脚手架被过滤）和 `assistant/message`（content 块与 `usage` 字段随事件进入 tokenUsage 投影；reasoning 块原生渲染）。**不复制 turn 边界**——父侧实时 spawn→settle 的边界仍是 subagentTiming 的唯一权威。
- 镜像挂在 `result.then(() => child.done)` 之后、覆盖**所有**终止路径（completed/aborted/error）——被中止的轮次也保留部分成果。链式顺序沿用 one-shot 中止修复在 kimi 上确立的模式（先 settle 链写 turn/end，再等进程退出读文件，否则持久化批次缺 turn/end）。

## 曾考虑的替代方案

- **依赖 `dsh-session-persistence-jsonl` 解压**——否决：其 rc.6 发布类型的公开面未声明 `decompressZstdFrame`（仅 JS 有）；Node 内置 zlib 的 zstd 零新增依赖即可覆盖。
- **注册表持有镜像 offset（kimi 模式）**——否决：两个会话的 turn 编号天然对齐，区间可直接从事件推导，少一份重启即丢的状态。
- **连 turn 边界一起镜像**——否决：sub-dsh 自己的 turn/start|end 会与父侧实时边界在 subagentTiming 投影里重复折叠。

## 影响

- dsh harness 的子会话现在展示完整对话（任务、回复、原生渲染的思考）和真实的逐轮 token usage——四家 harness 的记录全部达到对比级。
- resume 轮次天然增量（区间 = 对齐的 turn 编号），没有会在宿主重启时丢失的 offset 状态。
- 零新增包依赖：解压走 Node ≥22.15 内置 zstd，engines 范围（`^22.19 || >=24`）已保证可用。

## 测试

`tests/session-mirror.spec.ts` 钉住轮次区间（第 2 轮不带出第 1 轮内容）、脚手架过滤、usage 逐字携带、zstd 读取、会话缺失时的 no-op；provider 现有套件在镜像链接入 `startDshCliRun` 后全部保持通过。

## 交叉引用

- [CLI 子代理 resume](2026-08-16-local-agent-resume.md)——本镜像增量跟随的 resume 轮次。
