# 移动端接入（mobile-access）

- **分类**：plugin（交付形态为可插拔包 + 部署配方；内含两个依赖上游 seam 的部件，如实标注为 upstream 候选，不 hack 官方包）
- **状态**：planned
- **最后更新**：2026-08-19
- **查重结果**：已搜 `proposals/active/`、`proposals/closed/`、`.agents/notes/`（含 implemented/proposed/rejected）——无移动端 / 远程认证 / PWA / 推送 / IM bot 相关提案或 note。与 local-agent 家族的 device-code 网页登录（harness 自身认证，不涉 Web 网关，[note 先例](../.agents/notes/implemented/feature/2026-08-14-local-agent-family.md)）无意图重叠。
- **官方依赖**：需契约扩展（upstream 候选）+ 纯插件混合，逐部件标注见「方案」。原则：**凡能纯插件交付的部件以可插拔包交付才算 done；依赖上游 seam 的部件只到 verified，去 seam 化路径 = 提交 upstream 提案并等落地**。

## 目标

单用户自用场景（用户已确认）：**随时随地（不在同一 WiFi）访问完整 dsh Web UI**，保留全部现有插件能力（文件预览 / 产物 / 消息工具 / 会话等——它们全部跑在 `packages/client/*` 的 slot 系统上，换壳不换 UI），并具备主动推送通知（问完锁屏、答案好了弹通知）。

交付形态：一组独立可插拔包 + 部署配方（Tailscale / 网关认证 / TLS），**零官方代码改动**为总体纪律；无法纯插件达成的部件（进程内登录页、完整移动布局）以 seam 提案形式提交 upstream，不阻塞其余部件。

## 现状（官方契约实测）

| 面 | 实测事实 | 对方案的含义 |
|---|---|---|
| 认证 | `packages/host/webserver` 只有 route / upgrade / fallback / `tapIndex` 四类注册，**无中间件链**；`packages/client/connection` 的 `trustedHosts` 源码注释明言 *"a DNS-rebinding fence, explicitly not authentication"*；`PRIVILEGED_METHODS`（settings / credentials / agentPreset 等配置面方法）强制 loopback-only；全 host 包无 login / token / bearer 实现 | 进程内认证**无现成 seam**，纯插件只能在**网关前置**（dsh 进程外）做；进程内登录页需 upstream seam（M3） |
| 端点 | webserver 仅 bind `127.0.0.1` / `0.0.0.0`，无 TLS；CLI 已有 `--host` / `--port` / `--trusted-host` | 端点与 TLS 全部可落在进程外（反代 / Tailscale），dsh 保持 loopback + `--trusted-host` 即可 |
| PWA | `apps/web/public/manifest.webmanifest` 存在（`display: fullscreen`、SVG icon），**无 service worker** → 当前不可安装、无离线、无推送 | SW 注册 + manifest 增强可通过 `webServer.tapIndex`（公开注入面，ui-theme 已用它注入 boot 主题）**纯插件注入** |
| 移动 UI | `ui-layout` 的 AppFrame 注册进 `'root'` slot（独占，**不可被插件替换**）；conversation 表面与 column 子槽可替换；`CENTER_MIN=640`、`SIDEBAR_AUTO_COLLAPSE=1024`；client 包无 `@media` 断点、无触控优化 | 完整移动布局需 upstream seam（M3）；纯插件只能局部降级（CSS token 覆盖 + 子槽替换） |
| 推送 | host 侧无 Web Push 基建；`turn/end` 是现成触发点；`packages/credentials` 现成（配置只存引用、`role('secret')` 不进响应） | 推送 host 半（VAPID + 订阅 + 触发）可纯插件实现 |
| Bot 通道 | `packages/sdk`（protocol / client / server，stdio JSON-RPC）+ `dsh --profile headless "task"` 一次性执行模式现成 | IM bot 可纯插件实现，零域名零入站（平台 long-polling） |

## 方案

### M1 远程安全接入（纯部署 + 纯配置，零官方改动）

- **端点**：Tailscale mesh（手机 + 宿主机器同账号），`<host>.<tailnet>.ts.net` 私有域名 + 自动 HTTPS；与 WiFi 无关，4G/5G 可达，公网不可见。
- **认证**：网关前置。Tailscale Serve / Caddy basic-auth 在 dsh 进程外做 token 门禁；dsh 继续 bind `127.0.0.1` 只收本机回环转发，`--trusted-host <ts.net 域名>` 让 connection 的 DNS-rebinding fence 放行该权威。**无 token 请求在网关层即被拒，dsh 进程零改动。**
- **进程内登录页 + 会话 cookie**：属 M3 seam（`client-connection` 认证钩子），**不阻塞 M1**——单用户场景网关 basic-auth 已足够。
- **产物**：部署配方文档 + 一键脚本（装 Tailscale、生成 token、配反代、起 dsh）。

### M2 PWA 化（纯插件）

- **包 A `@khorsheed/dsh-pwa`**：
  - host 半：`webServer.tapIndex` 注入 SW 注册脚本 + manifest 增强（icons / `display: standalone` / theme-color）；
  - client 半：安装提示（beforeinstallprompt）、SW 生命周期、离线壳。
- **包 B `@khorsheed/dsh-web-push`**：
  - host 半：VAPID 密钥管理 + Web Push 订阅端点（凭据存 `ctx.credentials`）+ `turn/end` → 推送；
  - client 半：订阅 UI（设置分区）+ 权限引导 + 通知点击深链回会话。
- **依赖面**：`webServer.tapIndex`（公开）、session 事件（公开）、`ctx.credentials`（公开）——零官方改动。

### M3 移动 UI（需契约扩展，upstream 候选；先提交 seam 提案，不阻塞 M1/M2）

- **upstream 候选 A**：`client-connection` 增加**可插拔认证 seam**（authenticator 钩子：校验 header token / 会话 cookie），让进程内登录页成为可能。
- **upstream 候选 B**：`ui-layout` 增加**移动断点模式**（AppFrame 窄视口：CENTER_MIN 随视口收缩、全屏沉浸、底部输入栏、safe-area），或开放 `'root'` 布局替换槽。
- **纯插件降级路径**（seam 落地前可用，体验打折但可用）：移动主题层（CSS token 覆盖 + 插件自有样式）+ conversation 表面替换 + `tapIndex` 注入移动 viewport/meta，把三栏压成单栏沉浸。

### M4 IM Bot 补充通道（纯插件，可独立交付）

- **包 C `@khorsheed/dsh-telegram-bot`**：dsh SDK 驱动 headless profile；问 → 答（流式回传）；**服务器主动推送**（Telegram bot API 允许服务端发起消息——"问完锁屏、答案好了弹通知"的零安装实现）；回答附带深链回 Web UI 对应会话。
- 与 M2 互补：Bot = 轻问答快速通道，PWA = 完整 UI。可推广到微信 / 钉钉 / 飞书（按平台适配器拆分，v1 只做 Telegram）。

## 里程碑

| 里程碑 | 内容 | 官方依赖 | 周期 |
|---|---|---|---|
| M1 | 部署配方（Tailscale + 网关认证 + TLS）+ 实测验证 | 纯配置 | 0.5 周 |
| M2 | PWA 安装 + 推送通知端到端 | 纯插件 | 1–1.5 周 |
| M3 | seam 提案提交 upstream；降级路径先行落地 | 需契约扩展 | 1 周（提案）+ 持续 |
| M4 | Telegram bot 问答 + 推送 + 深链 | 纯插件 | 1 周 |

## 实现记录

（随实施追加：Agent Note / PR / 包名。M3 的 upstream 提案另立 seam 类提案并在本处链接。）

## 验收标准（done 判定，绑定可插拔交付）

1. **M1**：手机在非同一 WiFi（4G/5G）可访问完整 Web UI；无 token 请求在网关层被拒（实测 401/403）；dsh 进程零代码改动（仅配置）。→ done 候选。
2. **M2**：Chrome/Safari 可将 dsh 安装为主屏 App、全屏运行；任务完成推送到达且点击深链回正确会话；`dsh plugin add` / `remove` 可装可卸、热卸载干净。→ done。
3. **M3**：seam 落地后（upstream）进程内登录页 + 手机单栏全屏 → **verified**（依赖上游，不冒充 done）；seam 未落地时降级路径可用，README 如实标 `degraded`。**去 seam 化路径：上游提案被吸收后退役降级路径。**
4. **M4**：bot 问 → 答端到端；主动推送到达；深链回会话正确。→ done。
5. 每包 `pnpm run build && pnpm run test` 绿；双语 README + Compatibility 段 + `dsh.compat`；Agent Note 三件套。
6. 官方依赖诚实标注：凡依赖上游 seam 的能力，状态只到 `verified`，验收标准明确列出"等什么上游"。

## 风险 / 放弃的东西

- **进程内登录页依赖上游 seam，可能长期不落地**——网关前置（basic-auth / Tailscale 身份）兜底，单用户场景可接受；不做多用户 / 团队体系。
- **完整移动 UI 依赖 ui-layout seam**——降级路径的体验差距（三栏压单栏的交互损耗）须在 M3 降级版实测后决定是否值得等 seam。
- **宿主机器必须保持开机在线**（Tailscale 免费版 100 设备 / 3 用户，单用户无虞）——这是"随时随地"的唯一前提，文档写明。
- **Web Push 依赖系统通知权限**，用户可关；Bot 通道作为互补，两者不互斥。
- **放弃**：原生 App（Tauri / Capacitor）商店分发——单用户场景 ROI 低，且响应式改造照样躲不掉，留待需求出现；不做离线全量数据（仅离线壳）。
