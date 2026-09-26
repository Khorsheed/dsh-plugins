# @khorsheed/dsh-mobile

[English](README.en.md) | 中文

把 dsh 会话装进口袋——会话、模型、skill、工具仍由 Mac 跑，手机只拿走一个真正为它做的界面。

官方 Web 客户端是桌面形态：侧栏吃掉半个屏幕、输入区密密麻麻、触控目标按鼠标设计。这个插件把同一套客户端重新呈现给窄屏触控设备——带分组和搜索的会话首页、可换行且够得着的输入工具栏、在手机上选电脑目录的面板——再配上一个可选的 [iOS 薄壳](../../apps/ios/README.zh.md)：嵌入同一套官方 Web 客户端，扫码登录即用。一切都可以干净移除：卸载即精确还原官方桌面界面，绝不写入宿主或兄弟插件的状态。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/mobile-library.png" width="640" alt="移动端会话首页：时间与工作区分组、可折叠的工作区分节、底部搜索框">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/mobile-conversation.png" width="640" alt="移动布局下的会话页：可换行的输入工具栏，展开的加号菜单归并了附件、指令和权限入口">

## 特性

- **会话首页**——时间/工作区分组、可折叠的工作区分节和底部搜索。分组偏好只存在当前浏览器（`dsh.mobile.grouping`）；导航覆盖期间官方聊天与草稿保持挂载。
- **真正的移动布局，仅作用于当前客户端**——全宽右栏详情、移动设置、可换行且触控区域更大的输入工具栏（正文最低 17px，主要控件 16–17px）。官方正文渲染、输入框、模型/权限选择、附件与流式传输原样保留。
- **在手机上选电脑目录**——已有工作区、逐级浏览、返回上级、显示隐藏目录、校验完整路径。工作区接入和 Room 成员目录选择共用此面板；桌面客户端保留原生选择器。
- **扫码连接手机**——已认证的 Web 设置分区为部署的 HTTPS origin 现场生成官方登录链接，并在浏览器本地编码成二维码；iOS 壳扫码、确认主机即连上。
- **带版本的原生桥接**——受认证的 `GET /api/mobile/handshake` 加 bridge version 1 消息通道，提供展示状态与可选原生设置/扫码入口。回前台经官方连接服务恢复，绝不重放发送命令；短暂切换且连接正常、初次正在连接时不重复重连，后台停留至少 5 秒仍刷新流式连接代际。
- **与生态共处，但不强依赖**——没有任何社区插件是启动依赖。长按已识别的用户消息调用 message-tools 原有的复制/编辑/撤回；加号面板打开 Room 原有邀请表单；TaskPilot 与 Local Agent 界面各归其主。

当前是开发基线，尚未发布或通过真机资格验收——见已知限制。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-mobile
```

插件自挂载自身行——不要手改 profile YAML。重启 web 实例并刷新客户端后生效。

```sh
dsh plugin --profile web remove @khorsheed/dsh-mobile
```

卸载移除自有样式、布局标记、observer、监听、路由和槽位贡献；不删除会话、不取消宿主任务、不关闭共享连接、不撤销官方 Cookie、不卸载 App/VPN。偏好可保留用于重装。

窄屏触控设备（`max-width: 760px` 且粗指针）或原生壳自动启用移动布局。`?mobile=1` 显式启用，`?mobile=0` 停用。移动设置中的选择仅保存在当前浏览器的 `dsh.mobile.display`；切到桌面布局后，可用 `?mobile=1` 恢复设置入口。官方登录交换会跳转 `/`，需要时在认证后再加参数。

## 从 Web 设置连接手机

已登录的 Web 客户端通过公开 `settings.section` 槽位提供 **设置 → 连接手机**——桌面无需开启移动布局。将手机可达的**无凭据 HTTPS origin** 配置为插件的 `publicOrigin` 选项，或在 **Host 进程**上设置 `DSH_MOBILE_PUBLIC_ORIGIN`（插件选项优先）。同一域名需加入 Host 的 `--trusted-host`，ingress 的 `PUBLIC_ORIGIN` 也必须一致。这些属于部署设置，不是手机偏好。

```sh
DSH_MOBILE_PUBLIC_ORIGIN=https://YOUR-HOST.trycloudflare.com dsh web --no-open --port 3181 --trusted-host YOUR-HOST.trycloudflare.com
```

1. 打开 Web「设置 → 连接手机」，核对展示的主机。
2. 点击**显示登录二维码**。
3. 在 iOS App 进入**连接设置 → 扫码连接电脑**，扫描后确认主机。

`GET /api/mobile/connect` 仅返回配置状态。已认证、同源的 JSON `POST` 为部署者配置的 origin 调用官方 `connection.authenticatedUrl()` 取登录链接——浏览器输入不能覆盖目标地址。两个接口都经官方 Connection 注册，保留 Cookie 与 Host/Origin 校验，响应均为 `no-store`。二维码在浏览器本地编码：不调用第三方二维码服务、不记录凭据日志、不写浏览器存储。离开设置分区、页面隐藏或展示两分钟后会隐藏二维码并取消未完成的请求。地址缺失或无效、宿主能力不支持、目标域名未受信任时，只显示配置引导，不生成登录链接。

**隐藏不等于凭据过期。** 二维码携带的是宿主进程的官方登录 token，在该进程重启前有效——不是短时或一次性配对码。隐藏或重新生成二维码不会撤销已复制的链接，也不会登出手机；已有 Cookie 的有效期仍由宿主控制。

跨物理网络需要独立配置的 HTTPS/WSS 入口转发到 loopback Host 端口、有效官方认证、保持唤醒联网的 Mac 和网络可达的手机——仅启动 Host 不等于远程可用，App 也不会替你配置网络或凭据。Debug 模拟器构建仅允许 loopback HTTP，Release 要求 HTTPS。

## 可选：Quick Tunnel 预览

网络接入属于部署配置，不是插件依赖——自建 HTTPS 反向隧道/服务器或私网连接均可；插件不嵌入任何域名、服务器或 Cloudflare 账号。临时预览可用 [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)：无需账号或自有域名即可生成临时 HTTPS 地址，但不保证在线时间、限 200 并发、不支持 SSE（实测会话传输走 WebSocket）。

```sh
cloudflared tunnel --url http://127.0.0.1:3182 --protocol quic --no-autoupdate
PUBLIC_ORIGIN=https://YOUR-HOST.trycloudflare.com HOST_PORT=3181 INGRESS_PORT=3182 node packages/mobile/examples/https-ingress.mjs
dsh web --no-open --port 3181 --trusted-host YOUR-HOST.trycloudflare.com   # 独立 DSH_HOME、工作区、模型
```

随包分发的 `examples/https-ingress.mjs` 只绑定 loopback，保留公网 Host/Origin 交给官方认证，要求转发协议为 HTTPS，为上游 Cookie 补充 `Secure`，并透传 HTTP 流与 WebSocket 升级。它不读取 Host 私钥，也不增加配对或逐设备撤销系统——仅在 HTTPS 隧道之后运行，授权始终由 Host 负责。手机登录时，仅将 Host 启动链接的 origin 替换为隧道 origin，保留 `?token=...`；带凭据链接请私下保存。新建隧道会分配新域名：同步更新 ingress origin、Host trusted-host 和 mobile 公网 origin 后重新登录——旧 Cookie 绑定旧 authority。停止隧道进程即关闭这条公网路径；仅卸载插件不会。参见 [Quick Tunnel 验收记录](../../docs/acceptance/mobile-quick-tunnel-2026-09-11.md)。

## 可选协作界面

message-tools、TaskPilot、Room 与 Local Agent 家族独立安装；移动端读取它们的公开能力，从不把它们作为启动依赖。长按已识别的用户消息调用原有复制/编辑/撤回；无法识别的渲染器保留原控件。加号面板打开 **Room 原有邀请表单**，仅调整为移动端底部面板样式——代理发现、认证、随机命名、首个任务派发和移除确认都由 Room 负责，不存在第二套移动邀请/编辑 API。移动端在当前浏览器内临时适配公开的 `uiWorkspace.pickDirectory` 方法，让 Room 原表单原样消费面板返回的结果，卸载时恢复。Room 与 Local Agent 保留各自输入框，因此不承诺 Room 内展示全部普通会话的 TaskPilot 胶囊。已知 Room 版本首次异步填充缓存时可能未刷新输入框选举；移动端用一个始终让出的 chain 条目刷新公开槽位选举，不替换胜者。参见[协作验收](../../docs/acceptance/mobile-collaboration-2026-09-12.md)。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：⚠️ 可用，带已声明的降级——`dsh.compat.minHost` 为 `0.1.5-rc.1`。本地浏览器/Host 验证与 iOS 模拟器构建在 `0.1.5-rc.1`（`183f08e9c6`）上通过，但移动布局与 iOS 壳仍在验收中；**Safari 在 0.1.5-rc.1 上恢复进行中回复需要选择启用的随包 ingress 适配层**（`MOBILE_SAFARI_COMPAT=1`，见「实现原理」）；**不提供设备配对与推送**。更旧的宿主：低于 `minHost` 自行承担风险——均不受支持。
- 源码线（deepseek-harness master）：对固定的 `0.1.7-rc.1` 类型面构建+测试通过（2026-09-26），但按 `dsh.compat` 的声明，真机/网络验收矩阵完成前不声明 `verifiedHost`——在其他宿主上采用前请先审计。

会话首页使用可选的官方 sessions/workspaces/uiWorkspace 服务，过滤已归档会话和子代理行、保留普通分叉会话；缺少服务时回退基础官方侧栏。启用布局前检查公开 frame/slot DOM 锚点；未知结构保留官方页面——结构变化可能降低移动可用性，但不改变 Host 执行。原生桥接版本变化需要判断 App 兼容性；兼容的 Web 更新不自动要求重发 IPA。参见[导航/扫码验收](../../docs/acceptance/mobile-navigation-2026-09-11.md)、[rc1 验收证据](../../docs/acceptance/mobile-rc1-2026-09-11.md)与[提案](../../proposals/active/2026-08-19-mobile-access.md)。无需修改官方或兄弟插件源码。

## 已知限制

- **开发基线**——相机/文件选择、分享/下载、后台恢复和社区插件组合尚未完成验收。iOS 扫码接收已有官方 HTTPS 登录链接并要求确认主机；相机实测验收仍待完成。
- **没有逐设备凭据**——一次性设备配对、逐设备撤销、Keychain 配对和 APNs 推送均未实现；隐藏二维码不撤销任何东西（见上）。
- **热卸载未通过验收**——依赖变化需要受控重启 Host 并刷新客户端。
- **偏好仅存在当前浏览器**——布局选择（`dsh.mobile.display`）与首页分组（`dsh.mobile.grouping`）绝不离开此浏览器，不写入宿主。
- **首页搜索是浅搜索**——只过滤会话标题和工作区路径，不搜消息正文。
- **回前台恢复有下限**——健康的短暂切换不重复重连，但已经停止的正文订阅不能仅靠重连 socket 恢复。

## 实现原理

<details>
<summary>架构、安全边界与 Safari 适配层（点击展开）</summary>

**Host 面。** 三条路由挂在官方受认证的 Connection 注册表上，且仅在组合中存在 `connection` 时才挂载（`ctx.inject(['connection'])`）：`GET/POST /api/mobile/connect`（扫码登录签发——POST 额外要求同源 JSON 动作与 `ready` 状态的目标地址，导航或表单永远无法引出登录链接，provider 错误绝不回显）、`GET /api/mobile/directories`（只读目录名/路径，不超出操作者现有文件系统权限——不读文件内容、不创建目录；上限 1,000 行目录 / 10,000 个扫描条目并带截断标记）、`GET /api/mobile/handshake`（只读能力发现：桥接版本、能力清单、`devicePairing: false`、`pushNotifications: false`）。所有响应均为 `no-store`。

**Client 面。** 一个浏览器持有的 `MobilePresentation` 切换文档元素上的 `data-dsh-mobile`，持有样式表、observer 与监听器，且仅在官方 frame 锚点（`[data-slot="root"]` 且含 main/sidebar）符合预期结构时启用——否则保留官方页面。槽位贡献全部经 `slots.inject`（绝不裸 register）：`settings.section`/`mobile-connect`、`shell.overlay`/`mobile-directory` 与 `/mobile-navigation`、`conversation.input.dock` + `conversation.session.header.actions`/`mobile-send-focus`（本机消息确认提交后收起同一个空白编辑器；提交失败和后续草稿保留焦点）、`conversation.session.header.actions`/`mobile-room-queue`、`conversation.hero.brand.mark` 的欢迎内容、`conversation.input.left`/`mobile-input-tools`（加号菜单归并官方附件/指令/权限入口），以及移动模式激活期间对两个公开 `directoryFlow` 槽位的 priority −100 遮蔽。Room 输入框选举刷新使用一个始终让出的 `conversation.composer` 条目，绝不替换胜者。词典随包提供 `en`/`zh`。

**原生桥接（version 1）。** 壳声明 `window.__DSH_MOBILE_SHELL__`；客户端上报 `ready`/`unloaded` 及布局与锚点诊断，仅接受同 origin 主框架的 `chrome`、`settings`、`scan` 消息。新增原生动作需壳声明能力，旧壳保留回退控件。桥接不授予文件或命令权限。

**Safari 流式同步兼容层。** 宿主 `0.1.5-rc.1` 的 JSON 校验会在 Safari 还原进行中回复时误拒绝普通对象。随包 ingress 接受 `MOBILE_SAFARI_COMPAT=1`，作为选择启用的交付层适配——不修改宿主源码：只检查 WebKit 对 `/plugins/` JavaScript 的 GET 请求，由完整已知校验函数的 SHA-256 指纹决定是否替换，未知代码和已修复代码原样透传。认证、RPC 请求体、WebSocket 帧和宿主执行保持不变；直连局域网或其他 ingress 不会获得此适配。有界 JavaScript 向支持 gzip 的客户端压缩输出（超过 16 MiB、非 JS、认证失败、identity 编码不匹配的响应原样透传）；适配后的资源带校正后的字节长度、无旧 ETag/digest，保持 `private/no-store`。升级宿主时检查 `x-dsh-mobile-compat` 响应头与 ingress 不含请求内容的兼容日志，不自动扩大指纹范围；上游修复通过真实 WebKit 前后台/重连验收后移除该开关。正式部署从已安装 tarball 的 `examples/` 启动 ingress，不用开发检出。

**卸载。** dispose 只移除自有资源——样式、`data-dsh-mobile` 布局标记、observer、监听、路由和槽位贡献——并恢复被适配的 `pickDirectory` 方法。会话、宿主任务、共享连接、官方 Cookie 和 App/VPN 全部原样保留。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/mobile`）。问题与贡献请移步该仓库。
