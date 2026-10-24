# Agent Note: Self-healing Quick Tunnel via runtime trust hot-rebind

Status: implemented

## Problem

3080 的 mobile 公网入口（Cloudflare Quick Tunnel）反复突然不可用：cloudflared 进程活着，但边缘注册和 DNS 已经消失，而每次恢复都必须换一个随机域名。重绑域名要改启动命令里的 `DSH_MOBILE_PUBLIC_ORIGIN` 和 `--trusted-host`——也就是重启宿主。为此建造的自动管理器（[公网入口恢复](2026-09-27-mobile-public-entry-recovery.md)）一天后即被移除（[移除记录](2026-09-28-remove-mobile-tunnel-manager.md)），因为把网络故障当作无人值守重启宿主的许可越过了明确边界。此后轮换全靠手工 runbook（[2026-09-30 手动重绑](../process/2026-09-30-mobile-quick-tunnel-rotation-manual-rebind.md)），手机入口经常一坏数天。没有域名的社区用户则根本没有可行路径。

## Decision

下文的进程归属、重启行为与失败处理已于 2026-10-24 被取代：cloudflared 改由 detached 守护进程持有，宿主重启不换域名，失败持续重试不再停住，最低宿主为 0.2.0——见[守护进程笔记](../architecture/2026-10-24-mobile-tunnel-detached-sidecar.md)。信任热绑的设计照旧。

mobile 插件现在可选地接管 Quick Tunnel 全生命周期，并**通过官方 `configEditor` 服务在运行时重绑域名**（宿主 ≥ 0.1.7）——零上游改动、零宿主重启、零通配信任：

- `GET/POST /api/mobile/tunnel` 与 connect 同级挂在官方受认证的 Connection 注册表后。GET 只读状态；POST 是同源 JSON 的显式启停动作，守卫与二维码签发完全一致。
- 启用后插件自持一个 cloudflared 子进程（`--protocol http2 --no-autoupdate`），从进程输出解析分配到的 `*.trycloudflare.com` 域名，等待边缘匿名探测（401/403/2xx——域名刚分配给本进程，围栏 403 同样证明转发），然后对 `connection` 行调用 `configEditor.edit`，把 `trustedHosts` 替换为「启动值与操作者条目 + 当前域名」。每次编辑只剔除 supervisor 自己管理的旧域名——启动参数里的静态回落域名在轮换和停用后都保留（首版按后缀剔除，恰好打掉了这个回落，已修并补回归测试）；bundle 行的 `!!js ctx.webStartup.trustedHosts` 表达式经 `webStartup` 服务求值；未触碰的配置键保留原表达式（`...current`）。绑后严格探测（401/2xx）通过才出示地址。
- 健康循环每 45 秒匿名复查；连续 3 次失败或子进程退出即换新域名重绑，恢复冷却 ≥10 分钟（域名翻腾 = 全部客户端 WebSocket 断连重连 + 手机重扫，故刻意节流）。连续 3 次启动失败进入 `error` 等人工处理。
- 启用状态与当前域名持久化在 `$DSH_HOME/state/mobile-quick-tunnel.json`；插件 apply 时若持久化为 `enabled: true` 立即重启隧道，因此公网入口跨宿主重启、跨 `deploy:3080` profile 重新生成都能自愈（edit 会把字面量列表持久化进 `profiles/web/cordis.patch.yml`；deploy 重新生成 profile 回到 bundle 表达式后，启动重绑在数秒内校正）。
- 出示地址经每请求 getter 读取，优先级：托管 > `publicOrigin` > `DSH_MOBILE_PUBLIC_ORIGIN`；静态配置的部署行为不变、界面不变。
- supervisor 不新增 peer 依赖：`configEditor`/`webServer`/`profileContext`/`webStartup` 做结构化探测，任一能力缺失（以及非 `http:` 监听、缺少 cloudflared 二进制）都降级为带原因码的 `unsupported` 状态——绝不导致启动失败。探测是**惰性**的（每次 status/enable/start 时重新求值）：组合启动期间严格 `ctx.get` 对"已提供但未 ACTIVE"的 fiber 返回 undefined，首版在 apply 时一次性探测把 `no-config-editor` 错误地烤死（由下方的实机复现抓获）。持久化的启用状态在启动窗口内重试（5 秒 × 24）而非放弃。「连接手机」设置分区呈现启停、实时 starting/recovering 状态与按原因的指引（例如安装 cloudflared）。
- supervisor 活在 apply 根级而非 `ctx.inject(['connection'])` 内：热绑会重应用 connection 行，销毁并重跑依赖它的 inject 回调——注册在回调内的东西会被自己的重绑销毁。

本次变更还包括：移动布局激活期间，客户端注入免凭据的 data-URI manifest 与 Apple meta（添加到主屏幕，无 service worker），社区用户完全不需要下载 iOS App——手机浏览器就是默认客户端。

为何不再违反 2026-09-28 的移除决定：被移除管理器的失败模式是*网络状态触发无人值守的宿主重启*。新机制从不重启宿主——configEditor seam 在进程内应用带校验的配置编辑（经 hmr 串行化、失败回滚、await 返回即生效）——且启用是经认证操作员的显式动作，不是环境默认。

## Alternatives considered

**复活 deploy 门控的轮换管理器（2026-09-27 设计）。** 与当初移除它的理由相同：经 `deploy:3080` 恢复就是重启宿主，调整重试冷却不改变这一点。

**人人用命名隧道。** 彻底消除轮换，但需要 Cloudflare 账号和域名 zone——社区明确可能两者都没有。作为静态路径支持；配置了静态地址时 supervisor 自动袖手。

**用 launchd 监督 cloudflared 并保留重启。** 进程监督只覆盖进程死亡，覆盖不了"活着但注册死了"这个主要故障，且每次恢复仍要重启宿主重绑信任。运行时 seam 才是让监督有意义的前提。

**让隧道走随包 ingress（以获得 `MOBILE_SAFARI_COMPAT`）。** 因 v1 范围而拒绝：supervisor 让 cloudflared 直连宿主端口（与现网拓扑一致）。Safari 恢复进行中回复的限制如实标注为托管路径同样适用；按宿主产物重钉适配指纹与 ingress 编排留作后续。

## Consequences

- 一键公网入口的代价是每次轮换全部客户端 WebSocket 瞬断重连（无需重新登录；Cookie 按 authority 绑定，每个新域名本就需要一次 token 交换，重扫自然完成）。Quick Tunnel 仍不承诺在线时长——恢复自动，但每次轮换手机必须重扫；只有命名隧道能免除这个仪式。
- `configEditor.edit` 会把字面量 `trustedHosts` 持久化进 `profiles/web/cordis.patch.yml`，在下一次 deploy 或启动重绑前掩盖 bundle 表达式。使用 deploy 管理 profile 的部署（3080）必须知道运行时会写这个文件——已写入 [docs/ops.md](../../../docs/ops.md)；卸载后残留的死域名授权是无害的（域名不可猜且已死），下次绑定时剔除。
- iOS 壳保持可选增强；无 App Store 的社区路径是"相机扫码 → 浏览器使用 → 添加到主屏幕"。0.2.x 宿主上的真实 WebKit 恢复验收仍是待办手工项。
- 测试覆盖信任列表轮换（剔除/保留/去重）、enable→ready、崩溃与探测失败恢复、冷却节流、error 停驻、停用剔除、持久化驱动的自动启动、启动窗口内服务迟到的激活、端点守卫与设置页各状态。生产切换前还在一个临时 web profile 实例上用真实 cloudflared 跑通了全链：启用 → 边缘 401 → 登录链接签发 → 杀隧道后自动轮换（约 13 秒新域名就绪，宿主未重启）→ 停用剔除（授权移除，边缘 530）。
