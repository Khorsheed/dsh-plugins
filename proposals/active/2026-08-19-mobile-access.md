# 移动端接入（mobile-access）

- **分类**：plugin（交付形态为可插拔包 + 部署配方；全部部件以纯插件 / 纯配置交付，零官方代码改动）
- **状态**：planned
- **最后更新**：2026-08-19
- **查重结果**：已搜 `proposals/active/`、`proposals/closed/`、`.agents/notes/`（含 implemented/proposed/rejected）——无移动端 / 远程认证 / PWA / 推送 / IM bot 相关提案或 note。与 local-agent 家族的 device-code 网页登录（harness 自身认证，不涉 Web 网关，[note 先例](../.agents/notes/implemented/feature/2026-08-14-local-agent-family.md)）无意图重叠。
- **官方依赖**：纯插件。**硬约束：不修改官方包、不提交 upstream 需求**——凡无法纯插件 / 纯配置达成的形态一律不做或以降级形态交付，取舍与体验上限在 M1 / M3 如实标注。

## 目标

单用户自用场景（用户已确认）：**随时随地（不在同一 WiFi）访问完整 dsh Web UI**，保留全部现有插件能力（文件预览 / 产物 / 消息工具 / 会话等——它们全部跑在 `packages/client/*` 的 slot 系统上，换壳不换 UI），并具备主动推送通知（问完锁屏、答案好了弹通知）。

交付形态：一组独立可插拔包 + 部署配方（Tailscale / 网关认证 / TLS）。**零官方代码改动且不提交 upstream 需求**为总体纪律——部件取舍以"能否纯插件交付"为界：不能的（进程内登录页、完整移动布局）明确放弃或降级，不阻塞其余部件。

## 现状（官方契约实测）

| 面 | 实测事实 | 对方案的含义 |
|---|---|---|
| 认证 | `packages/host/webserver` 只有 route / upgrade / fallback / `tapIndex` 四类注册，**无中间件链**；`packages/client/connection` 的 `trustedHosts` 源码注释明言 *"a DNS-rebinding fence, explicitly not authentication"*；`PRIVILEGED_METHODS`（settings / credentials / agentPreset 等配置面方法）强制 loopback-only；全 host 包无 login / token / bearer 实现 | 进程内认证**无现成 seam 且官方不可改** → 认证完全由**网关前置**（dsh 进程外）承担；**放弃进程内登录页**（M1） |
| 端点 | webserver 仅 bind `127.0.0.1` / `0.0.0.0`，无 TLS；CLI 已有 `--host` / `--port` / `--trusted-host` | 端点与 TLS 全部可落在进程外（反代 / Tailscale），dsh 保持 loopback + `--trusted-host` 即可 |
| PWA | `apps/web/public/manifest.webmanifest` 存在（`display: fullscreen`、SVG icon），**无 service worker** → 当前不可安装、无离线、无推送 | SW 注册 + manifest 增强可通过 `webServer.tapIndex`（公开注入面，ui-theme 已用它注入 boot 主题）**纯插件注入** |
| 移动 UI | `ui-layout` 的 AppFrame 注册进 `'root'` slot（独占，**不可被插件替换**）；conversation 表面与 column 子槽可替换；`CENTER_MIN=640`、`SIDEBAR_AUTO_COLLAPSE=1024`；client 包无 `@media` 断点、无触控优化 | 完整移动布局**不可达**（官方不可改）→ 纯插件降级为**最终形态**：窄视口 CSS 覆盖 + 子槽替换 + `tapIndex` 注入，上限为"单栏沉浸"（M3） |
| 推送 | host 侧无 Web Push 基建；`turn/end` 是现成触发点；`packages/credentials` 现成（配置只存引用、`role('secret')` 不进响应） | 推送 host 半（VAPID + 订阅 + 触发）可纯插件实现 |
| Bot 通道 | `packages/sdk`（protocol / client / server，stdio JSON-RPC）+ `dsh --profile headless "task"` 一次性执行模式现成 | IM bot 可纯插件实现，零域名零入站（平台 long-polling） |

## 数据主权（本方案的核心特性）

dsh 是自托管架构，**所有用户数据收在单一根目录 `$DSH_HOME`（默认 `~/.dsh/`）**：会话数据为事件溯源模型，由本地后端（web profile 为 SQLite，另有 JSONL 可选）持久化；产物文件在工作区；配置与凭据在 `$DSH_HOME` 下（凭据走 `ctx.credentials` 引用，密钥不入配置）。

- **M1 + M2 默认路径：会话数据完全不上云**。手机经 Tailscale 加密 P2P 隧道（DERP 中继仅转发加密流量、不存储）访问本机 dsh；Tailscale 协调服务器只做设备发现与密钥交换；出网字节仅：Web Push 通知 payload（Web Push 标准加密，推送服务不可见内容，但通知文本明文显示于锁屏）、LLM API 调用（dsh 固有）、Tailscale 元数据。
- **M4 例外**：启用 Telegram bot 时，问答消息经 Telegram 服务器并存储于其侧（聊天记录）——可选通道，README 明示"开启即同意该数据路径"；不启用则数据全程本地。

## 方案

### M1 远程安全接入（纯部署 + 纯配置，零官方改动）

- **端点**：Tailscale mesh（手机 + 宿主机器同账号），`<host>.<tailnet>.ts.net` 私有域名 + 自动 HTTPS；与 WiFi 无关，4G/5G 可达，公网不可见。
- **认证**：网关前置。Tailscale Serve / Caddy basic-auth 在 dsh 进程外做 token 门禁；dsh 继续 bind `127.0.0.1` 只收本机回环转发，`--trusted-host <ts.net 域名>` 让 connection 的 DNS-rebinding fence 放行该权威。**无 token 请求在网关层即被拒，dsh 进程零改动。**
- **不做进程内登录页**：无 seam 且官方不可改，认证形态即网关 basic-auth（浏览器原生凭据弹窗）——单用户场景足够，README 写明取舍。
- **产物**：部署配方文档 + 一键脚本（装 Tailscale、生成 token、配反代、起 dsh）。

### M2 PWA 化（纯插件，两个包分工）

**包 A `@khorsheed/dsh-pwa` —— 安装壳（PWA 基础）**

职责：让 dsh 网页变成"可安装、可全屏、断网可开壳"的 App。解决**"怎么装、怎么像 App"**。

- host 半：
  - 静态资源：`sw.js` 与多尺寸 icons（192 / 512 / maskable PNG）经 `webServer.register` 提供（现有 manifest 只有 SVG icon，不足以触发安装）；
  - `webServer.tapIndex` 注入：manifest 增强（icons / `display: standalone` / theme-color）、SW 注册脚本、移动 viewport meta。
- client 半：
  - `beforeinstallprompt` 拦截 → 页面内"安装到主屏"提示条；
  - SW 生命周期：检测到新版本 → "刷新以更新"提示；
  - 离线壳：SW 缓存 app shell（HTML/JS/CSS），断网显示离线提示；**不缓存会话数据**——数据始终在 host，离线只是壳。

**包 B `@khorsheed/dsh-web-push` —— 推送桥（Web Push 通知）**

职责：把 host 侧的**会话事件变成手机系统通知**，点通知直达对应会话。解决**"装完之后怎么主动通知你"**。

- host 半：
  - VAPID 密钥对生成 / 加载，存 `ctx.credentials`（配置只存引用，密钥不进配置文件和 API 响应）；
  - 订阅端点：接收并持久化浏览器的 PushSubscription；
  - 触发：监听 session 事件（默认 `turn/end`），按配置模板构造标题 / 正文 / 深链 URL，用 web-push 加密发送到订阅 endpoint；
  - 配置：触发事件集、通知模板、深链格式。
- client 半：
  - 设置分区 UI：请求通知权限、注册 / 注销订阅、推送开关、状态展示（已授权 / 被拒 / 未决定）；
  - SW 内 `push` 事件处理：收到推送 → 弹系统通知；`notificationclick` → 打开 / 聚焦对应会话页。

**两包边界与 SW 所有权**：包 B **独立可用**（自带最小 SW，含 push / notificationclick 处理——不装包 A 也能在浏览器收推送）；包 A 专注缓存与安装。两者都注册 SW 时所有权在实现期对齐（如包 A 的 `sw.js` 经 `importScripts` 组合包 B 的 push 模块，或注册入口统一由 tapIndex 注入），README 写明"独立可用、共存协商"。**不装包 A 时包 B 推送可用；不装包 B 时包 A 安装 + 离线壳可用。**

**平台支持条件（iPhone 与 Android 不同）**：
- **Android（Chrome）**：任意网页可直接订阅 Web Push，无前置条件。
- **iPhone（iOS 16.4+，Safari）**：**必须先"添加到主屏"成为 Web App，再在其中请求通知权限**，普通 Safari 标签页不能收推送——与包 A 天然配套，iPhone 用户路径固定为「包 A 安装提示 → 添加到主屏 → Web App 内授权通知 → 收推送」，README 写明该路径。
- **iOS < 16.4**：不支持 Web Push，由 M4 bot 通道（IM 平台推送，与 iOS 版本无关）兜底。

- **依赖面**：`webServer.tapIndex` / `webServer.register`（公开）、session 事件（公开）、`ctx.credentials`（公开）、Push API（浏览器标准）——零官方改动。

**与 M1 的依赖关系（验收依赖，非实现依赖）**：M2 的插件开发在本机 `localhost`（浏览器视为 secure context）即可完成，**与 M1 并行**；但 SW / Web Push / beforeinstallprompt 只在 secure context 下工作（HTTPS 或 localhost），**手机经 `http://<LAN-IP>` 访问时 SW 不会注册、PWA 不可安装、推送不可用**（页面看似正常，极易误判）。因此 M2 的**真机端到端验收必须已有 M1 的 HTTPS 端点**（Tailscale `ts.net` 或同类）。

### M3 移动 UI 适配（纯插件；降级路径即最终形态）

官方 `ui-layout` 不可修改、也不提交 upstream 需求，**完整移动布局不可达**。本部件交付移动适配插件 `@khorsheed/dsh-mobile-ui`，以可插拔方式把三栏压成手机可用单栏，**上限为"单栏沉浸"**：

- **窄视口 CSS 覆盖**（插件自有样式表）：窄视口下隐藏 sidebar / details、center 全宽、触控目标放大、safe-area 适配。DOM 锚点按仓库纪律是 last resort，必须带 fallback——官方样式变更导致覆盖失效时**静默降回官方三栏**（degrade, don't explode），绝不破坏布局；
- **conversation 表面子槽替换**（官方公开槽）：移动端消息卡片触控优化（更大的点按区、长按操作入口）；
- **`tapIndex` 注入**：移动 viewport / meta（键盘弹起、双击缩放策略）。

**明示上限**：无法改 AppFrame 内部结构——抽屉式导航、底部输入栏等需要官方改动的形态不做；交付形态就是单栏沉浸，README 如实标注。若未来官方 ui-layout 自带移动断点，本插件 CSS 覆盖自然空转（兼容不冲突），届时可退役覆盖层。

### M4 IM Bot 补充通道（纯插件，可独立交付）

- **包 C `@khorsheed/dsh-telegram-bot`**：dsh SDK 驱动 headless profile；问 → 答（流式回传）；**服务器主动推送**（Telegram bot API 允许服务端发起消息——"问完锁屏、答案好了弹通知"的零安装实现）；回答附带深链回 Web UI 对应会话。
- 与 M2 互补：Bot = 轻问答快速通道，PWA = 完整 UI。可推广到微信 / 钉钉 / 飞书（按平台适配器拆分，v1 只做 Telegram）。

## 里程碑

| 里程碑 | 内容 | 官方依赖 | 周期 |
|---|---|---|---|
| M1 | 部署配方（Tailscale + 网关认证 + TLS）+ 实测验证 | 纯配置 | 0.5 周 |
| M2 | PWA 安装 + 推送通知端到端 | 纯插件 | 1–1.5 周 |
| M3 | 移动 UI 适配插件（单栏沉浸 + 降级 fallback） | 纯插件 | 1 周 |
| M4 | Telegram bot 问答 + 推送 + 深链 | 纯插件 | 1 周 |

## 实现记录

（随实施追加：Agent Note / PR / 包名。）

## 验收标准（done 判定，绑定可插拔交付）

1. **M1**：手机在非同一 WiFi（4G/5G）可访问完整 Web UI；无 token 请求在网关层被拒（实测 401/403）；dsh 进程零代码改动（仅配置）。→ done。
2. **M2**：Chrome/Safari 可将 dsh 安装为主屏 App、全屏运行；任务完成推送到达且点击深链回正确会话；**两包独立可装可卸——不装包 A 时包 B 推送仍工作（Android），反之亦然**；**iPhone（iOS 16.4+）实测：添加到主屏后推送可达，普通标签页不可达（README 写明路径）**。→ done。
3. **M3**：手机视口（实测 390px）下单栏沉浸可用；官方样式变更导致覆盖失效时静默降回三栏（单元 spec 覆盖 fallback 路径）；`dsh plugin add` / `remove` 可装可卸、热卸载干净。→ done（体验上限 = 单栏沉浸，README 如实说明）。
4. **M4**：bot 问 → 答端到端；主动推送到达；深链回会话正确。→ done。
5. 每包 `pnpm run build && pnpm run test` 绿；双语 README + Compatibility 段 + `dsh.compat`；Agent Note 三件套。

## 风险 / 放弃的东西

- **不做进程内登录页**：认证完全依赖网关前置（basic-auth / Tailscale 身份）——单用户场景的可接受取舍；若未来出现多用户需求，只能等官方提供 seam 或更换部署形态，提案届时重开。
- **移动 UI 上限为单栏沉浸**：无法改 AppFrame 内部结构，抽屉导航 / 底部输入栏等形态不做；CSS 覆盖依赖官方 DOM 结构，按 last-resort 纪律带 fallback，失效静默降回三栏，绝不破坏布局。
- **宿主机器必须保持开机在线**（Tailscale 免费版 100 设备 / 3 用户，单用户无虞）——这是"随时随地"的唯一前提，文档写明。
- **Web Push 依赖系统通知权限，且 iPhone 必须先"添加到主屏"（iOS 16.4+）才能收推送，iOS < 16.4 完全不支持**——用户可关权限、旧 iPhone 无解；M4 bot 通道（IM 平台推送）作为与 iOS 版本无关的兜底，两者不互斥。
- **放弃**：原生 App（Tauri / Capacitor）商店分发——单用户场景 ROI 低，且移动适配照样躲不掉，留待需求出现；不做离线全量数据（仅离线壳）；不做多用户 / 团队体系。
