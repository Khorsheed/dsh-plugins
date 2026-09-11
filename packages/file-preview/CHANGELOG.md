# 变更记录

## 0.2.1（2026-09-11）

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
