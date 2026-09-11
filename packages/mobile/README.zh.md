# DSH Mobile

[English](README.md) | 中文

可独立卸载的 DeepSeek Harness 移动适配插件。Mac 继续持有会话、模型、skill、tool 和插件执行；可选的 [iOS 薄壳](../../apps/ios/README.zh.md) 嵌入同一套官方 Web 客户端。

## 功能

- 当前客户端独立的移动布局、会话抽屉、全宽右栏详情与移动设置。
- 保留官方正文、输入框、模型/权限选择、附件及流式传输。
- 通过公开目录流程槽输入已有的**电脑目录完整路径**来添加工作区。官方所有者负责校验和接入，不唤起 Mac 原生选择器。
- 受认证的 `GET /api/mobile/handshake`；带版本、仅报告状态的原生桥接。回前台调用官方连接服务重连，不重放发送命令。
- 无社区插件强依赖。message-tools、成员、预览保留各自所有者；移动组合仍需验收。

当前是开发基线，尚未发布或通过真机资格验收。相机/文件选择、分享/下载、后台恢复和社区组合尚未完成验收。不提供二维码配对、逐设备凭据撤销或 APNs。

## 安装与卸载

先在仓库 worktree 构建、打包：

```sh
pnpm --filter @khorsheed/dsh-mobile build
pnpm --filter @khorsheed/dsh-mobile test
pnpm exec tsx scripts/pack-dist.ts --package packages/mobile --scope @khorsheed --version 0.1.0 --out packages/mobile/.dev/dist
```

用 `dsh plugin --profile web add /path/to/package.tgz` 安装产物；用 `dsh plugin --profile web remove @khorsheed/dsh-mobile` 移除。插件自挂载，不手改 profile YAML。实测 rc1 实例的依赖变化需要受控重启 Host 并刷新客户端，未通过热卸载验收。开发使用独立 `DSH_HOME` 与端口；生产 3080 仍走仓库部署门禁。

窄屏触控设备或原生壳自动启用移动布局。`?mobile=1` 显式启用，`?mobile=0` 停用。移动设置中的选择仅保存在当前浏览器的 `dsh.mobile.display`。切到桌面布局后，可用 `?mobile=1` 恢复设置入口。官方登录交换会跳转 `/`，需要时在认证后再加参数。

卸载移除自有样式、布局标记、observer、监听、路由和槽贡献，不删除会话、取消 Host 任务、关闭共享连接、撤销官方 Cookie 或卸载 App/VPN。偏好可保留用于重装。浏览器热卸载与 tarball 验收分开记录于下方证据。

## 连接与认证

App 接受配置的 HTTPS 主机地址或官方启动 token 登录链接，只保存无凭据的 origin；WebKit 保存官方浏览器会话 Cookie。桥接仅接受同 origin 主框架、bridge version 1 的消息，只报告插件可用性，不授予文件或命令权限。

跨物理网络需要独立配置的 HTTPS/WSS 入口转发到 loopback Host 端口（生产为 3080）、有效官方认证、保持唤醒和联网的 Mac，以及网络可达的手机。仅启动 3080 不等于远程可用。App 不自动配置网络或凭据。Debug 模拟器构建仅允许 loopback HTTP，Release 要求 HTTPS。清除 App 本地数据与服务端设备撤销是不同操作。

## 可选的 Quick Tunnel 预览

网络接入属于部署配置，不是插件依赖。社区用户可以选择临时预览用的 Quick Tunnel、自建 HTTPS 反向隧道/服务器或私网连接。插件不嵌入个人域名、服务器或 Cloudflare 账号。稳定的托管中继属于独立服务，会有自己的运营成本。

[Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) 无需 Cloudflare 账号或自有域名即可生成临时 HTTPS 地址。它用于测试，不保证在线时间，允许 200 个并发请求，不支持 SSE。实测 rc1 的会话传输使用 WebSocket；这不代表需要 SSE 的其他插件已通过验收。

使用已安装 mobile tarball 的隔离 Host profile。从官方渠道安装 `cloudflared`，使用 Node 22+。在仓库根目录先启动隧道（分配地址时本地入口可以尚未启动）：

```sh
cloudflared tunnel --url http://127.0.0.1:3182 --protocol quic --no-autoupdate
```

最新隔离预览在 HTTP/2 边缘连接超时后改用 `--protocol quic`。协议选择取决于本地网络；仅看到隧道注册成功还不够，分享预览前需验证公网登录和完整 WebSocket 回复。测试进程应独立运行，避免依赖短生命周期的自动化会话。

将生成的主机名替换下方的 `YOUR-HOST.trycloudflare.com`，在第二个终端启动独立示例：

```sh
PUBLIC_ORIGIN=https://YOUR-HOST.trycloudflare.com HOST_PORT=3181 INGRESS_PORT=3182 node packages/mobile/examples/https-ingress.mjs
```

然后使用独立的 `DSH_HOME`、工作区和已配置模型启动隔离 Host，通过官方参数加入精确的公网 authority：

```sh
dsh web --no-open --port 3181 --trusted-host YOUR-HOST.trycloudflare.com
```

示例也随 tarball 的 `examples/` 分发。它仅绑定 loopback，保留公网 Host 与 Origin 交给官方认证，要求转发协议为 HTTPS，为上游 Cookie 补充 Secure，并透传 HTTP 流和 WebSocket 升级。它不读取 Host 私有密钥，不增加配对或逐设备撤销系统。仅在 HTTPS 隧道之后运行；本地请求头不构成用户已认证的证明，授权仍由 Host 负责。

手机登录时，仅将 Host 启动链接的 origin 替换为隧道 HTTPS origin，保留 `?token=...`，在 Safari 打开或粘贴到 iOS 壳。带凭据链接应私下保存。登录会跳转到干净的 `/`；如果设备没有自动启用移动布局，认证后再加 `?mobile=1`。

Mac 保持唤醒，三个服务持续运行。停止隧道进程可关闭这条公网访问路径；仅卸载 mobile 不会停止隧道或撤销官方会话。重新分配域名后，需要同步更新 `PUBLIC_ORIGIN`、`--trusted-host` 并重新登录。这次预览不代表长期蜂窝网络可达性已验证。参见 [Quick Tunnel 验收记录](../../docs/acceptance/mobile-quick-tunnel-2026-09-11.md)。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| 官方 `0.1.5-rc.1`、`183f08e9c6` | 本地浏览器/Host 验证，iOS 模拟器构建通过；完整真机/网络验收待完成。 |
| 其他 npm RC / Harness master | 未验证，采用前审计。 |

`dsh.compat.minHost` 为 `0.1.5-rc.1`，发布矩阵未完成前不声明 `verifiedHost`。启用布局前检查公开 frame/slot DOM 锚点；未知结构保留官方页面。结构变化可能降低移动可用性，但不改变 Host 执行。原生桥接版本变化需要判断 App 兼容性；兼容的 Web 更新不自动要求重发 IPA。

参见[验收证据](../../docs/acceptance/mobile-rc1-2026-09-11.md)与[提案](../../proposals/active/2026-08-19-mobile-access.md)。无需修改官方或兄弟插件源码。
