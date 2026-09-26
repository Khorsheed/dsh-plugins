# 变更记录

## 0.3.2（2026-09-27）

无功能变更。随宿主 0.1.7-rc.2 基线发布波重发：全量构建+测试在 rc.2 基线通过（rc.1→rc.2 无触及本包的宿主变更，逐类清点见 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-27-host-017-rc2-breaking-changes.md)）。

## 0.3.1（2026-09-26）

适配宿主 rc.1 线并实证 0.1.5/0.1.7 双线可用（0.1.5-rc.1 全量 boot 实证，2026-09-25）。

- V4 一等 tool-role 双形读：读取侧同时接受 rc.1 的一等 `tool` 角色与 0.1.5 的包装形态，V3→V4 迁移存量照常展示
- 大文件读取窗口收敛：超大文件的预览读取以预览窗为界，不再整文件进内存
- typert 面双线：生成的 face 同时携带 0.1.5 要的立即求值 `schema` 与 rc.1 要的惰性 `create()` 工厂（两版 loader 各自只查自己的键）；tarball 自带 zod@4 依赖，face 的裸 `import 'zod'` 不再被 profile 里提升的 zod@3 劫走（0.1.5 loader 的 `_zod` 品牌校验实证通过）
- 插件清单展示元数据（`locale/*.json`）：rc.1 宿主插件页的卡面标题/描述中文化
- 从只读宿主包移除 `3d-artifact` 作者 skill；现在由 `@khorsheed/dsh-inline-html-render` 分发并注册。
- 新增零会话 `capabilities()` Remote 握手（`protocolVersion: 1`），供客户端在宿主缺席时抑制全部 UI。

## 0.3.0（2026-09-11）

（以 minor 发布：openExternal 是新增能力；pair 包 ui-file-preview 的 peer 边由 pack-dist 按本包版本重写，两包版本线须一致。）

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` 的用户请停留在 `0.2.0`。dispatch 事件只匹配 0.1.5 的 `tool/ptc-dispatch`（官方 v2→v3 日志迁移会把持久化的旧名改写过来，0.1.5 宿主不会再发出 `tool/code-dispatch`），0.2.0 的双名探测退役
- 新增 Remote 方法 `openExternal(agent, path, app, signal)`：在指定宿主应用中打开文件（macOS `open -a`），供浏览器半的「在 IDE 打开」手势使用——官方 open-in-app 路由只收目录。`app` 为官方 catalog id（id → `.app` 名映射镜像官方 catalog 的 darwin 条目）；非 macOS / 未知 id 返回 `opened: false`，不写入。


## 0.2.0（2026-09-10）

适配宿主 0.1.2 线。

- **BREAKING**：minHost 前移至 `0.1.2-rc.1`；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 线（末版 `0.1.1`）
- 会话事件读取走 `Session.snapshotEvents()`（`session.events` 已随宿主移除）
- 嵌套 dispatch 事件按名探测（feature detection，非版本判断）：同时识别 Code Mode 的 `tool/code-dispatch` 与 PTC 更名后的 `tool/ptc-dispatch`

## 0.1.1（2026-08-23）

- 修复：随包 skill 在目录里可见、调用即炸——宿主在 load 时才校验注册的 `source` 字段，之前没传；已补 `source: 'runtime'`，并加了真实 SkillRegistry 往返测试（list + load）防回归

## 0.1.0（2026-08-22）

首个公开发布。

- 会话文件清单：列出会话 `read`/`write`/`edit` 触碰过的每个文件，每次 write/edit 改动附 diff
- 内容读取：返回文件当前文本，超限截断并标记；web 宿主上图片返回浏览器可加载的 URL；二进制、缺失、超限文件返回分类提示
- bash 写入采集：heredoc、重定向、`tee`、`sed -i` 写入的文件并入清单，经 stat 验证，宿主重启后重建
- 在宿主文件管理器中打开所在文件夹并选中文件，支持 macOS、Windows、WSL、桌面 Linux
- 只读设计：无会话状态、无写入，宿主重启不丢任何东西
