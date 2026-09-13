# DSH Mobile

[English](README.md) | 中文

可独立卸载的 DeepSeek Harness 移动适配插件。Mac 继续持有会话、模型、skill、tool 和插件执行；可选的 [iOS 薄壳](../../apps/ios/README.zh.md) 嵌入同一套官方 Web 客户端。

## 功能

- 会话首页支持时间/工作区分组、工作区折叠和底部搜索。分组偏好仅保存在当前浏览器；导航覆盖期间仍挂载官方聊天与草稿。
- 当前客户端独立的移动布局、全宽右栏详情、移动设置，以及可换行、扩大触控区域的输入工具栏。
- 保留官方正文、输入框、模型/权限选择、附件及流式传输。
- 通过移动端面板选择**电脑目录**：已有工作区、逐级浏览、返回上级、显示隐藏目录及校验完整路径。工作区接入和 Room 成员目录选择共用此面板；桌面客户端保留原生选择器。
- 受认证的 `GET /api/mobile/handshake`；带版本的原生桥接提供展示状态与可选原生设置/扫码入口。回前台通过官方连接服务恢复，不重放发送命令。短暂切换且连接正常、初次正在连接时不重复重连；后台停留至少 5 秒仍刷新流式连接代际。
- 无社区插件强依赖。message-tools、成员、预览保留各自所有者；移动组合仍需验收。

当前是开发基线，尚未发布或通过真机资格验收。相机/文件选择、分享/下载、后台恢复和社区组合尚未完成验收。iOS 扫码接收已有官方 HTTPS 登录链接，并要求确认主机；相机实测验收仍待完成。不提供一次性设备配对、逐设备凭据撤销或 APNs。

## 安装与卸载

先在仓库 worktree 构建、打包：

```sh
pnpm --filter @khorsheed/dsh-mobile build
pnpm --filter @khorsheed/dsh-mobile test
pnpm exec tsx scripts/pack-dist.ts --package packages/mobile --scope @khorsheed --version 0.1.0 --out packages/mobile/.dev/dist
```

用 `dsh plugin --profile web add /path/to/package.tgz` 安装产物；用 `dsh plugin --profile web remove @khorsheed/dsh-mobile` 移除。插件自挂载，不手改 profile YAML。实测 rc1 实例的依赖变化需要受控重启 Host 并刷新客户端，未通过热卸载验收。开发使用独立 `DSH_HOME` 与端口；生产 3080 仍走仓库部署门禁。

窄屏触控设备或原生壳自动启用移动布局。`?mobile=1` 显式启用，`?mobile=0` 停用。移动设置中的选择仅保存在当前浏览器的 `dsh.mobile.display`，首页分组使用 `dsh.mobile.grouping`。切到桌面布局后，可用 `?mobile=1` 恢复设置入口。官方登录交换会跳转 `/`，需要时在认证后再加参数。

卸载移除自有样式、布局标记、observer、监听、路由和槽贡献，不删除会话、取消 Host 任务、关闭共享连接、撤销官方 Cookie 或卸载 App/VPN。偏好可保留用于重装。浏览器热卸载与 tarball 验收分开记录于下方证据。

## 连接与认证

App 接受配置的 HTTPS 主机地址或官方启动 token 登录链接，只保存无凭据的 origin；WebKit 保存官方浏览器会话 Cookie。桥接仅接受同 origin 主框架、bridge version 1 的消息，支持 `ready`、`unloaded`、`chrome`、`settings` 和 `scan`；新增原生动作需壳声明能力，旧壳保留回退控件。不授予文件或命令权限。

跨物理网络需要独立配置的 HTTPS/WSS 入口转发到 loopback Host 端口（生产为 3080）、有效官方认证、保持唤醒和联网的 Mac，以及网络可达的手机。仅启动 3080 不等于远程可用。App 不自动配置网络或凭据。Debug 模拟器构建仅允许 loopback HTTP，Release 要求 HTTPS。清除 App 本地数据与服务端设备撤销是不同操作。

## 可选的 Quick Tunnel 预览

网络接入属于部署配置，不是插件依赖。社区用户可以选择临时预览用的 Quick Tunnel、自建 HTTPS 反向隧道/服务器或私网连接。插件不嵌入个人域名、服务器或 Cloudflare 账号。稳定的托管中继属于独立服务，会有自己的运营成本。

[Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) 无需 Cloudflare 账号或自有域名即可生成临时 HTTPS 地址。它用于测试，不保证在线时间，允许 200 个并发请求，不支持 SSE。实测 rc1 的会话传输使用 WebSocket；这不代表需要 SSE 的其他插件已通过验收。

使用已安装 mobile tarball 的隔离 Host profile。从官方渠道安装 `cloudflared`，使用 Node 22+。在仓库根目录先启动隧道（分配地址时本地入口可以尚未启动）：

```sh
cloudflared tunnel --url http://127.0.0.1:3182 --protocol quic --no-autoupdate
```

协议选择取决于本地网络。已注册的 QUIC 隧道若在实际请求上卡住，可以尝试 `--protocol http2`；其他网络上的 HTTP/2 也可能失败，两者都不是普遍适用的默认选择。仅看到隧道注册成功或本地入口健康还不够，分享预览前需验证公网登录、会话列表和完整 WebSocket 回复。新建 Quick Tunnel 会分配另一个域名：通过受保护的启动切换同步更新 ingress origin 与 Host trusted-host，再让 App 重新连接。测试进程应独立运行，避免依赖短生命周期的自动化会话。

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

桌面模式在重载后仍保留“返回移动布局”按钮。移动端进入会话时阻止输入框自动聚焦，等待明确的输入手势；rc1 DOM 锚点变化时回退官方聚焦行为。普通会话标题去重，保留祖先/lineage 导航。这些 Web 层修复无需重新安装原生 App。

新版移动界面保留输入区统计和官方消息动作，隐藏未选中的轨迹入口，通过公开品牌槽位提供欢迎内容。rc1 已有会话工作区/preset 为只读标签，新建会话才提供官方选择器。原生设置通过校验后的 `dsh-mobile-display` 事件调整布局。未知标题区结构保留原始标题及祖先导航。

输入框加号菜单归并已有附件、指令和权限入口，当前权限名称与可选项仍由官方提供。校验后的 rc1 按钮锚点保留原回调和确认流程，结构未知时恢复官方控件。工作区/模式显示在移动标题下方；隐藏已识别的桌面标题控件，保留未知插件贡献。

## 可选协作界面

message-tools、TaskPilot、Room 和 Local Agent 家族独立安装。移动端读取公开能力，不把它们作为启动依赖。长按已识别的用户消息，调用原有复制/编辑/撤回；助手消息使用自己的回合动作。确认、禁用状态及修改语义仍由原组件负责。无法识别的渲染器保留原控件。

加号面板打开 **Room 原有邀请表单**，仅调整为移动端底部面板样式。成员快捷面板读取名册、打开已有子会话；设置按钮进入 Room 原成员页与编辑表单。代理发现、认证、随机命名、首个任务派发、目录接入、仅修改字段的补丁、移除确认及业务错误都由 Room 负责，不再维护第二套移动邀请/编辑 API。移动端在当前浏览器内临时适配公开的 `uiWorkspace.pickDirectory` 方法，由面板返回所选路径，Room 原表单继续消费该结果。卸载时恢复方法；未知的只读服务外观保留原行为。首个任务留空表示待命；填写后沿用 Room 的派发行为。无法识别快捷入口时保留原成员页作为回退。

Room 与 Local Agent 保留各自输入框。Room 排队面板使用官方会话 API 和 `row.text` 可编辑判据，按请求 ID 去重已接收/待确认消息，并在消息消失或不可修改时退出编辑。目标、任务与 TaskPilot 保留原组件所有权。Room 在两端都会用自己的输入框替换普通 dock，因此移动端不承诺 Room 内展示全部普通会话 TaskPilot 胶囊。

移动阅读正文最低 17px，主要控件 16–17px，辅助信息约 14px；从宿主字体变量派生，不写入宿主字号偏好。邀请/编辑控件点击高度至少 44px，面板跟随键盘打开后的可见视口。

会话列表统一保留工作区，并显示群聊和普通会话的成员数。仅为可见行查询可选 Room 元数据；失败保留未知状态，不显示错误的成员数。当前 Room 版本首次异步填充缓存时可能未刷新输入框选择；移动端通过始终让出的 chain 条目刷新公开槽位选择，不替换胜出的组件。待处理交互仍优先。

本机消息确认提交后，收起同一个空白编辑器的键盘；提交失败和后续草稿保留焦点。上下文圆环留在发送按钮旁。玻璃质感表面跟随宿主浅暗色，文字保持不透明，并提供降低透明度时的回退。参见[协作验收](../../docs/acceptance/mobile-collaboration-2026-09-12.md)。


## Safari 流式同步兼容层

宿主 `0.1.5-rc.1` 的 JSON 校验会在 Safari 还原进行中回复时误拒绝普通对象。针对该已知缺陷，随包分发的 HTTPS ingress 支持 `MOBILE_SAFARI_COMPAT=1`。使用此环境变量重启 ingress，兼容层生效后重新加载客户端。已经停止的正文订阅不能仅靠重新连接 socket 恢复。

这是默认关闭的交付层适配，不修改宿主源码：只检查 WebKit 对 `/plugins/` JavaScript 的 GET 请求。完整已知校验函数的 SHA-256 指纹决定是否替换；未知代码和已经修好的代码保持原样。补丁使用当前引擎的原生构造函数格式比较，不修改 `Function.prototype.toString`。认证、RPC 请求体、WebSocket 帧和宿主执行保持不变。直接连接局域网或使用其他 ingress 不会获得此兼容层。

有界 JavaScript 完成检查后，向支持 gzip 的客户端压缩输出，包括未修改的 bundle，避免多兆字节的未压缩脚本拖慢手机隧道加载。响应保持 private/no-store；修改后的脚本重算字节长度并移除旧 ETag/digest。超过 16 MiB、非 JS、认证失败、上游忽略 identity 编码要求而返回压缩内容的响应原样透传。升级宿主时检查 `x-dsh-mobile-compat` 与 ingress 不含请求内容的兼容日志，不自动扩大指纹范围。上游修复通过真实 WebKit 前后台和重连验收后移除开关。正式部署从已安装 tarball 的 `examples/` 启动 ingress，避免使用开发检出。

只读配套接口 `GET /api/mobile/directories` 复用官方 Connection 认证和 Host/Origin 检查。在已认证操作者现有文件系统权限内返回目录名称与路径，包括可进入的符号链接；不读取文件内容，不创建目录。每次最多返回 1,000 个目录、扫描 10,000 个条目，并提示截断。原生选择器宿主无需切换共享后端即可支持手机浏览。接口缺失或连接中断时显示错误和重试；此功能要求使用提供 HTTP 服务的连接方式。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| 官方 `0.1.5-rc.1`、`183f08e9c6` | 本地浏览器/Host 验证，iOS 模拟器构建通过；完整真机/网络验收待完成。 |
| 其他 npm RC / Harness master | 未验证，采用前审计。 |

`dsh.compat.minHost` 为 `0.1.5-rc.1`，发布矩阵未完成前不声明 `verifiedHost`。会话首页使用可选的官方 sessions/workspaces/uiWorkspace 服务，过滤已归档会话和子代理，保留普通分叉会话；缺少服务时回退基础官方侧栏。这里搜索的是标题和工作区路径，不是消息正文。启用布局前检查公开 frame/slot DOM 锚点；未知结构保留官方页面。结构变化可能降低移动可用性，但不改变 Host 执行。原生桥接版本变化需要判断 App 兼容性；兼容的 Web 更新不自动要求重发 IPA。

参见[导航/扫码验收](../../docs/acceptance/mobile-navigation-2026-09-11.md)、[验收证据](../../docs/acceptance/mobile-rc1-2026-09-11.md)与[提案](../../proposals/active/2026-08-19-mobile-access.md)。无需修改官方或兄弟插件源码。
