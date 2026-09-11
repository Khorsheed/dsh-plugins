# Agent Note: Standalone mobile plugin with a thin iOS shell

Status: proposed

[English](2026-09-11-mobile-plugin-ios-shell.md) | 中文

## Problem

原 mobile-access 提案早于当前浏览器认证与 slot 契约，并排除了原生 App；用户现在要求基于官方 0.1.5-rc.1 的 iOS 客户端，可独立装卸且不修改宿主或兄弟插件。用 Swift 重写官方客户端会重复消息语义、流式状态和每个插件的适配工作。把 localhost 端口持续运行当成远程可用，也会掩盖网络与认证条件。

## Proposal

原位更新 [mobile-access 能力提案](../../../../proposals/active/2026-08-19-mobile-access.md)，不另建同意图提案，已开始实施，能力提案标记 in-progress。拟用单个自挂载 `@khorsheed/dsh-mobile` 包承载 Host 与浏览器两部分，配独立签名的 iOS 壳。官方 Web 会话和输入框处于同一运行时；原生负责主机连接与系统能力。初版实现已位于 `packages/mobile/` 与 `apps/ios/`，完整提案尚未通过验收。

插件必须只依赖官方 web profile 就能运行。兄弟集成可选，通过公开能力或保留原渲染器完成。禁止宿主分叉、替换包、读取私有密钥、改兄弟包、全局切 profile 或重复消息引擎。移动展示属于当前客户端，每个注册与 effect 有所有者和 disposer；卸载保留会话与其他插件。外部 VPN、网关、官方登录生命周期分开，并明确移除/撤销方式。

### Evidence and unresolved seams

源码审计基于 rc1 commit `183f08e9c6`。BrowserAuth 已能用进程启动 token 换取绑定 authority 的签名 Cookie；该 token 不是一次性配对码。Gateway 已有多路 WebSocket 与重连恢复。root slot 允许 priority shadowing，但子槽声明和渲染权限仍独占。外壳替换与可撤销设备网关都未通过移动探针。M0 须证明公开组合和清理契约，再承诺完整布局或设备配对。

### Remote access and versioning

独立配置 HTTPS/WSS 转发到 loopback Host 服务（生产为 3080）。手机使用蜂窝网络也可经已配置的 tailnet 访问另一网络的 Mac，条件是双方联网、Mac 唤醒、宿主和接入服务运行、凭据有效。后台挂起后要前台重同步，不保证 iOS socket 永久存活。APNs 后续增量交付。

先用 HTTPS 上的官方浏览器认证。后续独立网关可以增加短时一次性配对和可撤销设备凭据，但必须保留上游认证，不依赖私有内部实现。若无法独立实现，明确保留基础登录并把增强配对标为不可用。卸载插件不等于撤销官方 Cookie 或移除 VPN。

Host/插件/移动 Web 按组合验收，以版本化的窄原生桥接使兼容升级无需发布新 IPA。每个 RC 仍需审计和移动回归。运行时探测、支持声明与实际交付分开记录。

## Alternatives considered

- 全 Swift 客户端会重复官方输入框、消息投影、流恢复与插件 UI 契约。
- 官方 Electron 内置后端并绑定发布版本，其所有权模型不适合控制远程 Mac 的手机。
- PWA/Web Push/IM bot 可以是未来通道，但用户当前优先 iOS，不属于首期交付。
- 全局禁用官方布局或修改兄弟插件可能接近设计，却违反双端共存和独立移除。

## Acceptance criteria

- 干净 rc1 profile 可添加、使用、停用、卸载、重装 mobile，无社区强依赖或宿主/兄弟修改。
- 桌面与手机共存；卸载清理自有效果，不破坏会话、共享连接和主机任务；需要刷新时明确告知并保留草稿。
- 真机关闭 Wi-Fi，完成认证后的流式、附件、停止与切网恢复；未认证的受保护请求和 WS 升级被拒。
- 消息工具/成员/预览可选集成经受缺席与卸载，响应丢失不盲目重放写操作。
- M0 记录布局与认证限制，只宣传已验证功能；若交付增强配对，验证过期、重放拒绝和即时设备撤销。
- 发布前记录版本组合、卸载边界与后置通知能力。

### Implementation boundary (2026-09-11)

保留官方 root，不声明他人子槽。自有 style 元素与经过检查的 rc1 frame/slot 锚点完成移动布局；未知结构回退官方页面。仅在当前客户端启用移动模式时，以 priority -100 覆盖两个公开目录流程槽，通过官方所有者回调接入电脑路径。恢复桌面或 dispose 移除注册；这个流程不调用 Host 原生 chooser。

原生壳保存干净的 origin 与 WebKit 浏览器 Cookie，不把启动 token 写入偏好。Release 强制 HTTPS，Debug 仅为模拟器允许 loopback HTTP。桥接校验主框架、同 origin 和版本；在可用性之外新增可选原生设置/扫码能力及导航实际挂载状态；回前台触发官方重连，不重放写命令。已实现扫描现有 HTTPS 登录链接；一次性设备配对凭据、分享和推送尚未实现。

[验收记录](../../../../docs/acceptance/mobile-rc1-2026-09-11.md)覆盖本地流式、保留草稿的重连、认证握手、tarball 重装、10 项插件测试与 20 项原生 URL 检查。实测 rc1 进程未对标准依赖移除执行热卸载，要求受控重启 Host 并刷新客户端。单元 disposer 覆盖不等于完整 Host HMR 实证。模拟器已编译/安装/启动，但原生画面自动化受 macOS 权限阻挡。本次实现未编辑主工作区、官方或兄弟源码，未部署生产。

可选部署示例 `packages/mobile/examples/https-ingress.mjs` 支持无需域名或账号的临时 Quick Tunnel，保留官方 Host/Origin 认证，在 HTTPS 边界补充 Secure Cookie 并转发 WebSocket；它不是 Cordis 依赖或设备网关。社区分发不绑定任何个人服务器或主机名。停止隧道与卸载插件是独立动作。[公网入口证据](../../../../docs/acceptance/mobile-quick-tunnel-2026-09-11.md) 记录认证 HTTP/WS、28 帧公网模拟回复与重连历史恢复；手机及公网流式 UI 验收仍待完成。续测在 HTTP/2 连接故障后改用 QUIC，测试进程独立于短生命周期工具会话运行。

### Mobile library and physical-device probe (2026-09-11)

mobile 自有会话首页位于现有 shell overlay，使用可选的官方 Session/Workspace store 投影最近会话，在本地筛选标题/工作区路径，将选择/新建交给 `uiWorkspace`。普通分叉会话保留，已归档行及 subagent 来源子会话遵循官方可见性规则。不声明他人的子槽，不复制会话传输；缺少可选服务时恢复基础移动导航。官方聊天持续挂载；首页打开时暂时将主内容区设为 inert，关闭或卸载时恢复。输入控件保留原所有者，增加换行和触控区域。

用户指定移除一个已有免费签名测试 App 并完成开发者信任后，签名开发 App 已在 iPhone Air / iOS 26.5.2 安装和启动。个人团队/设备标识不进入跟踪文件。用户最初反馈桥接 ready 但仍为旧桌面展示，因此不将 ready 等同于布局成功。同 origin 桥接诊断现在报告显示模式、已检查的 frame 支持、可选导航可用性及不含正文的锚点数量；Debug 展示/记录这些事实，Release 不展示。[真机验收记录](../../../../docs/acceptance/mobile-device-2026-09-11.md)将诊断状态与用户确认的视觉及交互结果分开。

首次真机截图暴露了桥接 ready 掩盖的渲染失败：将官方工作区 feed 的原型方法直接传入 React，导致方法丢失 receiver。现使用稳定回调通过各 feed 调用方法；回归测试使用依赖 receiver 的 feed，覆盖归档更新与订阅释放。修复部署后真机 DOM 诊断为无槽位错误、toolbar/library 各 1，视觉验收仍单列。临时 console 错误转发在定位后移除；保留的诊断只含布局及元素元数据。

### Approved navigation revision (2026-09-11)

用时间/工作区视图及底部搜索替换宣传式首页。工作区保留完整目录身份，按组内最近会话排序，时间分组尊重本地日历边界；搜索时展开折叠组中的匹配行。仅持久化分组偏好。原生扫码按可选桥接能力声明，浏览器和旧壳保留原有入口。原生 Form 设置集中主机/外观控件；独立于插件 `ready` 的实际挂载 `chrome` 状态控制回退连接栏收起。

二维码识别校验已有官方 HTTPS 登录链接，只预览干净的主机地址，明确确认前不能加载或切换主机。相机拒绝/不可用及无效二维码保留手动输入。不引入 Host 私钥、设备配对授权或隧道修改。官方输入、消息和插件动作保留原所有者；受限的 rc1 菜单锚点将输入/hero 区域非 portal 菜单适配为底部面板，其他弹层继续使用官方实现。

继续只部署隔离 3181。3080 接入是单独的整合步骤：那里尚未安装 mobile，需要同时评估 tarball 安装、trusted-host 配置、认证和门禁重启。见[导航验收](../../../../docs/acceptance/mobile-navigation-2026-09-11.md)。

## Risks

槽位所有权可能限制设计还原，私有接口和 DOM 锚点可能随 RC 失效。设备撤销需要真实网关授权模型，不能给官方 Cookie 改名代替。主机休眠、网络或认证故障会中断访问。即使移动行为是插件，原生 App 与接入设施仍独立安装。已有本地运行时及模拟器构建证据，真机验收待完成。
