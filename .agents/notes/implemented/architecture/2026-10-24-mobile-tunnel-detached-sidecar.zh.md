# Agent Note: Quick Tunnel 交给 detached 守护进程持有，宿主重启不换域名

Status: implemented

## Problem

[自愈 Quick Tunnel](../feature/2026-10-22-mobile-quick-tunnel-supervisor.md) 把 cloudflared 作为宿主进程的子进程。每次宿主重启——3080 每次 deploy 都会重启，截至 2026-10-24 已超过 150 次——隧道都随之死掉，重启后的 supervisor 再开一条新隧道，拿到新的随机 `*.trycloudflare.com` 域名。浏览器 Cookie 由持久密钥签名、有效期以天计，但绑定请求的 authority，所以换域名就等于让所有手机登出：用户感受到的就是「每次重启手机连接都会失效」。

同一次事故还暴露了两处失败处理缺陷。连续 3 次启动失败后状态永久停在 `error`，一个暂时性原因（2026-10-24 的失败周期恰好和一次进行中的 `deploy:3080` 重叠）也要人工点击才能恢复。失败详情把所有非编码错误压成构造函数名，状态文件里只剩 `lastError: "Error"`，真实原因无从追查。

## Decision

cloudflared 现在由一个 detached、零依赖的守护进程 `lib/tunnel-sidecar.js` 持有，作为第二个 host 入口构建。supervisor 用 `process.execPath`、`detached: true`、`stdio: 'ignore'` 加 `unref()` 拉起它，它处在独立进程组里，不随宿主退出。

- **接管。** 守护进程每 10 秒写一次 `$DSH_HOME/state/mobile-quick-tunnel.sidecar.json`（pid、端口、域名、心跳）。每次启动时，supervisor 接管心跳不超过 30 秒、pid 存活且端口与当前监听一致的守护进程，只有不满足时才拉起新的。接管来的域名已在存储的 `trustedHosts` 列表里时，`bind()` 完全跳过 `configEditor.edit`，所以常规重启不写 profile，也不会重载 connection 行。
- **退出。** 守护进程在三种情况下连同 cloudflared 一起退出：收到 SIGTERM（显式停用）、cloudflared 退出、supervisor 的 lease（`mobile-quick-tunnel.sidecar.json.lease`，启用期间每个健康 tick 续租）10 分钟未续。`dispose()` 不再碰隧道：cordis 在重启和卸载时都会 dispose，插件分不清是哪一种，靠 lease 区分「宿主几秒后回来」和「宿主不在了」。心跳过期的记录绝不发 SIGTERM，pid 被复用也安全。
- **唤醒检测。** 健康 tick（20 秒）检查守护进程存活并探测 origin。两次 tick 间隔超过三个周期，说明定时器被睡眠冻结；此时一次探测失败就立即换域名，不受 10 分钟冷却限制。
- **不再停住。** 启动失败一直重试：前三次按冷却间隔，之后指数退避到 `maxRetryMs`（1 小时）。`bind` 或 `verify` 环节失败时保留守护进程，重试直接接管同一域名，不换域名。
- **可诊断的失败。** `failureDetail(stage, error)` 记录 `<环节>: <名称>: <消息>`，URL 与 token 形状的内容脱敏，上限 200 字符；环节是 `port`、`tunnel`、`edge`、`bind`、`verify` 之一。设置页在 error 状态下显示它。
- **启用状态懒加载。** 持久化状态等 `profileContext.home` 可解析后再读取，不再在 apply 时只读一次。

同一变更把 mobile 的最低宿主提到 0.2.0-rc.2，删除 0.1.x 路径：手工 HTTPS ingress 示例及其 Safari 流式兼容适配（0.2 宿主已在上游修好 WebKit JSON 校验，托管隧道也从未经过 ingress）、0.1.5 快照队列、列表 `current` 读取、统一前的输入框结构识别、open-in-app 图标匹配和 `[data-composer-stats]` CSS。设置页文案改为以手机相机和浏览器为主，iOS App 降为一行补充，因为社区用户不自行用 Xcode 编译就装不上。

## Alternatives considered

**依赖 `@khorsheed/dsh-ankh-guard`，让它的 watchdog 持有 cloudflared。** 否决。这违反 `check:plugins` 强制的插件间无依赖规则；ankh-guard 没有托管守护进程的能力（它监督宿主进程，并按 harness 检出的 git HEAD 把关重启）；它有 9000 多行、九个官方 peer，对只想用手机访问的社区用户太重。守护进程不到 110 行。

**用 launchd / systemd 管 cloudflared。** 作为社区默认方案否决：每个系统安装步骤不同，supervisor 仍然需要接管和 lease 逻辑才能知道哪条隧道是活的。守护进程跨平台，随包安装。

**默认用命名隧道或 Tailscale。** 两者都有固定域名，但需要 Cloudflare zone 或手机装 Tailscale。它们仍是文档里的静态路径；配置了静态地址时托管 supervisor 照旧退出管理。

**守护进程按端口是否开放决定退出。** 初稿在 127.0.0.1:port 持续关闭超过宽限期时退出。这漏掉了宿主继续运行时卸载插件的情况——端口一直开着，守护进程会永远活着。lease 同时覆盖宿主停止和插件卸载。

## Consequences

- 宿主重启或 deploy 不换域名，手机保持登录。换域名（以及重扫）只在睡眠、重启或边缘掉线后发生。
- 卸载后隧道最多再存活 10 分钟；README 提示需要立即关闭时先停用。
- `configEditor` 一旦把字面量 `trustedHosts` 列表写进 `profiles/web/cordis.patch.yml`，它就一直留着：`deploy:3080` 不改写这个文件，supervisor 也保留所有不归它管理的条目。所以从启动参数 `--trusted-host` 里删掉的域名，会一直留在这份字面量里，直到手动从 profile patch 中删除（2026-10-24 已配合 `deploy:3080 --clear-mobile-origin` 为 3080 清掉过期的静态域名）。
- mobile 不再能装在 0.1.x 宿主上；0.1.x 停留在 mobile 0.1.4。
- 测试经伪造的 `SidecarControl` 和真实状态文件驱动 supervisor（接管、端口变化、轮换、守护进程死亡、唤醒、无限重试且保留隧道、边缘失败、停用），另有两条真实进程测试用伪造的 cloudflared 脚本跑守护进程，覆盖 SIGTERM 和 lease 过期。3080 上的真实 cloudflared 验收仍待完成：自动模式分类器不允许在 agent 会话中开外部隧道。
