# 变更记录

## 未发布

- **图片加载失败会说出来**：预览里加载不了的图片显示成「⚠ 图片加载失败：说明」链接，点开原地址或在面板里打开那个文件；之前是悄悄只显示说明文字
- **Markdown 预览显示图片、点链接跳转**：`<img>` 与本地图片在预览里显示（本地图片走本插件的图片地址）；本地链接点了在当前页签打开那个文件，agent 改过的文件照样带改动记录
- **就地编辑**：详情页标题行新增「编辑」（交互同 local-files）；新 Remote `filePreview/write` 走宿主 `ctx.fs.writeText` 并带读到的版本号做条件写，沙箱后端照样围栏；文件在编辑期间被 agent 改过答 `conflict`；保留 UTF-8 BOM；图片、二进制扩展名、超过读取上限、非 UTF-8 的文件不写。手机等非本机页面只读
- 可编辑的文件上，「复制路径」收进 ⋯ 菜单，把标题行的位置让给「编辑」

## 0.4.3（2026-10-24）

- **子代理会话里的面板**:面板的 Remote 方法改为按 `sessionId` 读取会话(新增 `panel-session.ts`),宿主对子代理会话的按 agent 查找会拒绝,协作间里 CLI 成员的会话因此打不开面板;客户端调用形状不变。

## 0.4.2（2026-10-22）

- **修复图片预览路由受插件加载顺序影响而静默缺席**：此前构造时一次性探测 `webServer`/`agents`，Cordis 加载顺序不保证——先应用就永不注册路由，3080 生产实证（2026-10-20）所有会话产物图片读成「二进制文件」。路由改挂 `ctx.inject(['webServer', 'agents'])` 子 fiber：两服务到齐（任意顺序）即注册、任一离开即卸载，宿主 web server 或 agent 注册表重启后自动恢复；headless 组合行为不变（无 webServer 时图片仍读 `binary`）
- **面板紧凑化（面板规范 P1）**：预览标题行换成 panel-kit 的 PanelHeader，内容/改动记录、预览/源码、HTML 分级开关共用一条下划线 tab 行；紧凑面板（≤560px）把路径/复制/打开手势收进 ⋯、搜索收进图标、结构化文档去掉格式横幅框；markdown 正文改读 `--dsh-panel-*` 阅读字级，移动端触摸字号终于到达预览。「打开所在文件夹 / 在 IDE 打开」等拉起宿主本机程序的手势在非本机浏览器（手机经隧道）上隐藏
- **新增免 Agent 读取面 `createFilePreviewReadSurface`**（包根导出）：list/turnFiles/read 核心抽为按事件源/cwd/fs 参数化的自由函数，Remote 方法改调同一核心（奇偶由构造保证），供已自行授权的可信服务端调用方（如协作插件）消费——不构造、不解析、不唤醒会话运行时对象。Remote 面不加动词、不改 wire，不消费该接缝的部署零行为变化
- 适配宿主 0.2.1 线：退役 invariant 伴生（上游 0.2.1-rc.1 删除 `@deepseek-ai/dsh-invariants` 与全部 `./invariant` 导出）并声明 `engines.dsh`（`>=0.1.5-rc.1 <0.3.0-0`，0.2.1-alpha.3 起其在场即唯一兼容判据）；peer 区间加 `|| ^0.2.1-rc.1`（semver 预发布比较符 `^0.2.0-rc.1` 在严格 npm/pnpm 解析路径不覆盖 0.2.1）；verifiedHost 前移 0.2.1-rc.1

## 0.4.1（2026-09-30）

- **适配宿主 0.2.0 的 `runNativeCommand` 第四参**（`'hidden' | 'visible'`，Windows 启动可见性，其余平台忽略——0.2.0 起必填）：GUI 启动器（`open -a`、`open -R`、`explorer /select`、nautilus/dolphin/nemo `--select`）传 `'visible'`，wslpath 翻译工具传 `'hidden'`
- 加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0

## 0.4.0（2026-09-27）

- **BREAKING（包结构）**：`@khorsheed/dsh-client-ui-file-preview` 并入本包——宿主 Remote 与浏览器半（「会话产物」右栏 tab、回合变更卡片、详情页）合并为一个包、一条 loader 行（id 仍为 `file-preview`，浏览器半经 `dsh.client` 发现，message-tools / taskpilot 同形态）。迁移：卸载旧界面包并删除组合里的 `ui-file-preview` 行；针对旧行 id 的 `disabled` 覆盖不再匹配，需要的话改写为 `file-preview`。旧包名已在 npm deprecate。
- 插件清单展示卡片（`locale/*.json` 的 meta）改用产物预览那张（会话产物 / Session Artifacts）。
- tab 实现 id（`FILE_PREVIEW_ID`）与文档/注释里的旧包名统一归一到 `@khorsheed/dsh-file-preview`；行为、wire 命名空间（`filePreview`）与字典命名空间不变。

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
