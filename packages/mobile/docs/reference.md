# @khorsheed/dsh-mobile 完整参考

> 面向部署者和开发者的完整说明：连接手机的两种公网入口、公网入口检查、与其他插件的协作、兼容与限制、架构与安全边界、移动面板。2026-10-26 前它是本包的 README；面向用户的简介见 [README](../README.md)。

[English](reference.en.md) | 中文

## 概览

官方 Web 客户端是桌面形态：侧栏吃掉半个屏幕、输入区密密麻麻、触控目标按鼠标设计。这个插件把同一套客户端重新呈现给窄屏触控设备——带分组和搜索的会话首页、可换行且够得着的输入工具栏、在手机上选电脑目录的面板。手机相机扫码、在浏览器里打开即可使用，还能「添加到主屏幕」；另有一个可选的 [iOS 薄壳](../../../apps/ios/README.zh.md)（需自行用 Xcode 编译安装）。一切都可以干净移除：卸载即精确还原官方桌面界面，绝不写入宿主或兄弟插件的状态。

## 特性

- **会话首页**——时间/工作区分组、可折叠的工作区分节和底部搜索。分组偏好只存在当前浏览器（`dsh.mobile.grouping`）；导航覆盖期间官方聊天与草稿保持挂载。
- **真正的移动布局，仅作用于当前客户端**——全宽右栏详情、移动设置、可换行且触控区域更大的输入工具栏（正文最低 17px，主要控件 16–17px）。官方正文渲染、输入框、模型/权限选择、附件与流式传输原样保留。
- **在手机上选电脑目录**——已有工作区、逐级浏览、返回上级、显示隐藏目录、校验完整路径。工作区接入和 Room 成员目录选择共用此面板；桌面客户端保留原生选择器。
- **扫码连接手机**——已认证的 Web 设置分区为部署的 HTTPS origin 现场生成官方登录链接，并在浏览器本地编码成二维码；手机相机扫码、在浏览器打开即登录。
- **一键公网入口（无需账号和域名）**——未配置静态地址时，设置页可一键启用 Cloudflare Quick Tunnel。隧道由一个独立的小守护进程持有，**宿主重启和 deploy 都不换域名**，已登录的手机不用重扫；电脑睡眠、重启或隧道掉线时自动换新域名重绑，宿主不重启。
- **带版本的原生桥接**——受认证的 `GET /api/mobile/handshake` 加 bridge version 1 消息通道，提供展示状态与可选原生设置/扫码入口。回前台经官方连接服务恢复，绝不重放发送命令；短暂切换且连接正常、初次正在连接时不重复重连，后台停留至少 5 秒仍刷新流式连接代际。
- **与生态共处，但不强依赖**——没有任何社区插件是启动依赖。消息动作栏保留 message-tools 原有的复制/编辑/撤回，触屏长按用于系统文字选择；加号面板打开 Room 原有邀请表单；TaskPilot 与 Local Agent 界面各归其主。

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

已登录的 Web 客户端通过公开 `settings.section` 槽位提供 **设置 → 连接手机**——桌面无需开启移动布局。

### 一键公网入口（Quick Tunnel，推荐无域名场景）

未配置静态地址时，「连接手机」提供**启用公网入口（临时域名）**。无需 Cloudflare 账号和域名，只要本机装了 cloudflared（`brew install cloudflared` 或官方发行包；未安装时设置页给出指引）。分配到的域名经宿主官方 `configEditor` **运行时热绑**进信任列表——不重启宿主、不放通配信任、探测不携带凭据。启用后页面直接出示二维码，手机浏览器（Safari/Chrome 均可）扫码即用。

- **宿主重启不换域名。** cloudflared 由插件拉起的独立守护进程持有，不随宿主进程退出。宿主重启后插件接管仍在运行的隧道，域名不变，已登录手机的 Cookie 继续有效。
- **何时换域名、需要重扫：** 电脑睡眠或重启、隧道掉线（Cloudflare 不承诺 Quick Tunnel 的在线时长）。插件自动换新域名并热绑，宿主不重启，唤醒后约一分钟内出新二维码。连续恢复受 10 分钟冷却节流，唤醒后的首次恢复不受限。
- **失败会一直自动重试**（退避至最长 1 小时），设置页显示失败的环节和原因，便于排查。
- **停用**会结束守护进程和隧道，并从信任列表剔除该域名。宿主停止或插件卸载后，守护进程在 10 分钟内自行退出。
- 状态文件在 `$DSH_HOME/state/`：`mobile-quick-tunnel.json`（启用状态与当前域名）和 `mobile-quick-tunnel.sidecar.json`（守护进程心跳）。

管理激活时，托管地址优先于 `publicOrigin`/`DSH_MOBILE_PUBLIC_ORIGIN`；停用后回落静态配置。想彻底免重扫，用自有域名 + 命名隧道（见下）。

### 静态配置（自有域名/命名隧道）

将手机可达的**无凭据 HTTPS origin** 配置为插件的 `publicOrigin` 选项，或在 **Host 进程**上设置 `DSH_MOBILE_PUBLIC_ORIGIN`（插件选项优先）。同一域名需加入 Host 的 `--trusted-host`。HTTPS 入口（命名隧道、反向代理或私网）直接转发到 loopback 上的 Host 端口即可。这些属于部署设置，不是手机偏好。

```sh
DSH_MOBILE_PUBLIC_ORIGIN=https://dsh.example.com dsh web --no-open --port 3181 --trusted-host dsh.example.com
```

1. 打开 Web「设置 → 连接手机」，核对展示的主机。
2. 点击**显示登录二维码**。
3. 用手机相机扫码，核对主机地址后在浏览器中打开；装了 iOS App 的话也可以在 App 里扫码。

`GET /api/mobile/connect` 仅返回配置状态。已认证、同源的 JSON `POST` 为部署者配置的 origin 调用官方 `connection.authenticatedUrl()` 取登录链接——浏览器输入不能覆盖目标地址。两个接口都经官方 Connection 注册，保留 Cookie 与 Host/Origin 校验，响应均为 `no-store`。二维码在浏览器本地编码：不调用第三方二维码服务、不记录凭据日志、不写浏览器存储。离开设置分区、页面隐藏或展示两分钟后会隐藏二维码并取消未完成的请求。地址缺失或无效、宿主能力不支持、目标域名未受信任时，只显示配置引导，不生成登录链接。

**隐藏不等于凭据过期。** 二维码携带的是宿主进程的官方登录 token，在该进程重启前有效——不是短时或一次性配对码。隐藏或重新生成二维码不会撤销已复制的链接，也不会登出手机。扫码登录后手机拿到的是宿主签发的 Cookie，绑定当前域名、有效期由宿主控制；域名不变时，它在宿主重启后依然有效。

跨物理网络需要 HTTPS/WSS 入口转发到 loopback Host 端口、有效官方认证、保持唤醒联网的电脑和网络可达的手机——仅启动 Host 不等于远程可用。

### 公网入口检查与重新扫码

连接手机页面在提供或生成二维码前，会匿名检查已配置的公网入口。不可达时返回明确状态，不签发登录链接。正在展示的二维码每 15 秒复查一次，入口失效或变化时收起。这是电脑侧连通性检查，不能保证手机所处网络同样可达。

- **托管模式（一键入口）**：隧道失效由插件自动换新域名重绑，宿主不重启；页面状态实时可见，恢复后手机重新扫码。宿主重启不算失效，域名保持不变。
- **静态模式**：检查只报告连接状态，不重建隧道、不部署插件、不重启宿主。公网入口失效时，由部署者手动恢复入口；需要变更宿主地址或信任域名的操作应先明确安排重启。电脑端地址可用后，重新打开「连接手机」，手机扫描新二维码即可。不会自动更新手机地址。

## 可选协作界面

message-tools、TaskPilot、Room 与 Local Agent 家族独立安装；移动端读取它们的公开能力，从不把它们作为启动依赖。复制/编辑/撤回使用原有消息动作栏；触屏长按用于系统文字选择，不再弹出第二套消息菜单。加号面板打开 **Room 原有邀请表单**，仅调整为移动端底部面板样式——代理发现、认证、随机命名、首个任务派发和移除确认都由 Room 负责，不存在第二套移动邀请/编辑 API。移动端在当前浏览器内临时适配公开的 `uiWorkspace.pickDirectory` 方法，让 Room 原表单原样消费面板返回的结果，卸载时恢复。Room 与 Local Agent 保留各自输入框，因此不承诺 Room 内展示全部普通会话的 TaskPilot 胶囊。已知 Room 版本首次异步填充缓存时可能未刷新输入框选举；移动端用一个始终让出的 chain 条目刷新公开槽位选举，不替换胜者。

## Compatibility

- 宿主 0.2.x（`@deepseek-ai/dsh@0.2.0-rc.2` 起）：⚠️ 可用，带已声明的降级——`dsh.compat.minHost` 为 `0.2.0-rc.2`，**不再支持 0.1.x 宿主**（0.1.x 请停留在本插件 0.1.4）。对 0.2.1-rc.1 树全量构建+测试通过，但真机/网络验收矩阵完成前不声明 `verifiedHost`；移动布局与 iOS 壳仍在验收中；**不提供设备配对与推送**。
- 一键公网入口：需要本机 cloudflared；缺少时「连接手机」回退静态配置指引，不影响其余功能。iOS/Android 浏览器扫码后可「添加到主屏幕」：移动布局激活时注入免凭据 manifest 与 Apple meta（无 service worker，不声明离线）。

会话首页使用可选的官方 sessions/workspaces/uiWorkspace 服务，过滤已归档会话和子代理行、保留普通分叉会话；缺少服务时回退基础官方侧栏。启用布局前检查公开 frame/slot DOM 锚点；未知结构保留官方页面——结构变化可能降低移动可用性，但不改变 Host 执行。原生桥接版本变化需要判断 App 兼容性；兼容的 Web 更新不自动要求重发 IPA。无需修改官方或兄弟插件源码。

## 已知限制

- **Quick Tunnel 无在线承诺**——宿主重启不换域名，但电脑睡眠/重启或隧道掉线后会换新域名，手机必须重新扫码；需要永久地址请用自有域名 + 命名隧道。
- **开发基线**——相机/文件选择、分享/下载、后台恢复和社区插件组合尚未完成验收。iOS 扫码接收已有官方 HTTPS 登录链接并要求确认主机；相机实测验收仍待完成。
- **没有逐设备凭据**——一次性设备配对、逐设备撤销、Keychain 配对和 APNs 推送均未实现；隐藏二维码不撤销任何东西（见上）。
- **热卸载未通过验收**——依赖变化需要受控重启 Host 并刷新客户端。
- **偏好仅存在当前浏览器**——布局选择（`dsh.mobile.display`）与首页分组（`dsh.mobile.grouping`）绝不离开此浏览器，不写入宿主。
- **首页搜索是浅搜索**——只过滤会话标题和工作区路径，不搜消息正文。
- **回前台恢复有下限**——健康的短暂切换不重复重连，但已经停止的正文订阅不能仅靠重连 socket 恢复。

## 实现原理：架构与安全边界

**Host 面。** 三条路由挂在官方受认证的 Connection 注册表上，且仅在组合中存在 `connection` 时才挂载（`ctx.inject(['connection'])`）：`GET/POST /api/mobile/connect`（扫码登录签发——POST 额外要求同源 JSON 动作与 `ready` 状态的目标地址，导航或表单永远无法引出登录链接，provider 错误绝不回显）、`GET /api/mobile/directories`（只读目录名/路径，不超出操作者现有文件系统权限——不读文件内容、不创建目录；上限 1,000 行目录 / 10,000 个扫描条目并带截断标记）、`GET /api/mobile/handshake`（只读能力发现：桥接版本、能力清单、`devicePairing: false`、`pushNotifications: false`）。所有响应均为 `no-store`。

**Quick Tunnel supervisor（可选）。** 第四条路由 `GET/POST /api/mobile/tunnel` 与 connect 同级挂在官方认证注册表后：GET 只读状态；POST 为同源 JSON 的显式启停动作。启用时插件以 detached 方式拉起随包的零依赖守护进程 `lib/tunnel-sidecar.js`，由它持有 cloudflared、解析分配到的域名，并每 10 秒写心跳状态文件。宿主重启后 supervisor 读心跳文件，同端口且进程存活就直接接管，不开新隧道；域名已在信任列表里时也不再写 profile。守护进程在三种情况下连同 cloudflared 一起退出：收到 SIGTERM（停用）、cloudflared 退出、supervisor 续租的 lease 文件 10 分钟未更新（宿主停止或插件卸载）。新域名经边缘匿名探测（接受 401/403/2xx——域名刚分配给本进程，403 同样证明边缘转发）通过后，经官方 `configEditor.edit` 把 connection 行 `trustedHosts` 替换为「启动值与操作者条目 + 当前域名」——只剔除 supervisor 自己管理的旧域名，启动参数里的静态回落域名在轮换和停用后始终保留；`!!js` 启动表达式经 `webStartup` 求值，未触碰的 key 保留原表达式；绑后严格探测（401/2xx）验证信任落地才出示地址。健康循环每 20 秒检查守护进程存活并匿名探测，连续 3 次失败或进程消失即换新域名，恢复冷却 10 分钟；两次检查间隔异常大视为刚从睡眠唤醒，一次失败即立即恢复。启动失败一直重试，3 次后退避至最长 1 小时；写信任列表失败时保留隧道，下次重试直接接管。失败详情记录为「环节: 错误」（URL 与 token 形状的内容一律脱敏），写入状态文件并 `console.error` 到宿主日志。supervisor 本体活在 apply 根级而非 `ctx.inject(['connection'])` 内，否则会被自己触发的重绑销毁。supervisor 不新增 peer 依赖：对 configEditor/webServer/profileContext/webStartup 仅做结构化探测且惰性复评（组合启动期严格 `ctx.get` 对未 ACTIVE 的 fiber 返回 undefined，一次性探测会把"不支持"烤死），持久化的启用状态也等 profile 目录可解析后再读取；缺失即 `unsupported`，绝不因能力缺失导致启动失败。

**Client 面。** 一个浏览器持有的 `MobilePresentation` 切换文档元素上的 `data-dsh-mobile`，持有样式表、observer 与监听器，且仅在官方 frame 锚点（`[data-slot="root"]` 且含 main/sidebar）符合预期结构时启用——否则保留官方页面。槽位贡献全部经 `slots.inject`（绝不裸 register）：`settings.section`/`mobile-connect`、`shell.overlay`/`mobile-directory` 与 `/mobile-navigation`、`conversation.input.dock` + `conversation.session.header.actions`/`mobile-send-focus`（本机消息确认提交后收起同一个空白编辑器；提交失败和后续草稿保留焦点）、`conversation.session.header.actions`/`mobile-room-queue`、`conversation.hero.brand.mark` 的欢迎内容、`conversation.input.left`/`mobile-input-tools`（加号菜单归并官方附件/指令/权限入口），以及移动模式激活期间对两个公开 `directoryFlow` 槽位的 priority −100 遮蔽。Room 输入框选举刷新使用一个始终让出的 `conversation.composer` 条目，绝不替换胜者。词典随包提供 `en`/`zh`。移动布局激活期间注入免凭据的 data-URI manifest（Chrome/Android）与 Apple meta（iOS）支持「添加到主屏幕」——start_url 仅含 origin + pathname，无 service worker，桌面不注入，卸载即移除。

**原生桥接（version 1）。** 壳声明 `window.__DSH_MOBILE_SHELL__`；客户端上报 `ready`/`unloaded` 及布局与锚点诊断，仅接受同 origin 主框架的 `chrome`、`settings`、`scan` 消息。新增原生动作需壳声明能力，旧壳保留回退控件。桥接不授予文件或命令权限。

**卸载。** dispose 只移除自有资源——样式、`data-dsh-mobile` 布局标记、observer、监听、路由和槽位贡献——并恢复被适配的 `pickDirectory` 方法。会话、宿主任务、共享连接、官方 Cookie 和 App/VPN 全部原样保留。一键入口的守护进程不随 dispose 结束（否则宿主重启就会换域名），而是在 lease 停止续租 10 分钟后自行退出；要立即关闭公网入口，请在卸载前先点「停用公网入口」。

## 移动面板

聊天顶部的新建会话旁提供面板入口。移动面板使用全宽内容、可左右滑动的多标签、添加和关闭操作，保留宿主原有内容与桌面分栏记录；可选 sidebar 能力或 DOM 锚点不匹配时保留官方界面。文件类插件可复用共享主从布局，画布继续由原组件处理连线和编辑。

仓库内组件预览：在 `packages/mobile` 下运行 `pnpm exec tsx examples/panels/serve.ts`，打开 `http://127.0.0.1:8875/`。它使用真实导航、DockLayout、AdaptiveSplit 和 LinkView，但数据为内存样例；不是生产实例或手机验收。预览源码不进入 npm 包。iPhone 键盘、安全区、前后台恢复仍需真机检查；终端快捷键栏未实现。
