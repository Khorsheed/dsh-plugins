# DSH Mobile for iOS

[English](README.md) | 中文

SwiftUI 连接页加 WKWebView，支持 iOS 17+。[mobile 插件](../../packages/mobile/README.zh.md)负责移动 Web 展示；本工程不包含 Host 运行时、模型密钥或 npm 安装器。

## 构建

在 Xcode 打开 `DSHMobile.xcodeproj`，选择 DSHMobile scheme 与 iPhone 模拟器。仓库根目录命令：

```sh
xcodebuild -project apps/ios/DSHMobile.xcodeproj -scheme DSHMobile -configuration Debug -sdk iphonesimulator -derivedDataPath apps/ios/.build CODE_SIGNING_ALLOWED=NO build
mkdir -p apps/ios/.build
xcrun swiftc apps/ios/DSHMobile/HostAddress.swift apps/ios/Tests/main.swift -o apps/ios/.build/host-address-tests
apps/ios/.build/host-address-tests
```

实体手机需要配置自己的 Apple 开发团队与签名。Release 仅接受 HTTPS；Debug 允许 localhost HTTP 供模拟器测试。`DSH_MOBILE_TEST_URL` 是仅 Debug 使用的隔离测试主机启动环境变量，不提交带认证 URL 或启动设置。模拟器能访问 Mac loopback；实体手机不能用 Mac 的 `127.0.0.1` 地址。

## 真机开发

在 Xcode 选择自己的开发团队，或为真机构建传入 `DEVELOPMENT_TEAM=YOUR_TEAM_ID`。个人团队/设备标识不写入工程。签名开发产物放在忽略的 `apps/ios/.build-device`；通过 `xcrun devicectl device install app --device DEVICE_ID PATH_TO_APP` 安装。

若 iOS 提示免费开发签名 App 名额已满，需要设备所有者决定移除哪个已有测试 App，并先保留数据；不能自动卸载无关 App。安装成功但拒绝启动时，先检查签名描述文件及设备是否包含，再检查 iPhone「设置 → 通用 → VPN 与设备管理」里的开发者信任。当前测试描述文件在签发七天后到期；这属于开发安装，不是发行包。

Debug 连接设置展示 mobile 插件的布局状态及不含内容的 DOM 锚点数量，用于定位插件已加载却仍显示桌面布局的问题。诊断不包含登录 token 或会话正文；Release 不展示这些诊断。

## App 图标

内置 `DSHMobile/Assets.xcassets/AppIcon.appiconset` 在 Debug 和 Release 中提供不透明的 1024px 蓝白 D／对话气泡图标。Xcode 生成设备所需尺寸，iOS 应用外部圆角。这是静态玻璃风格图片，不依赖网络，也不跟随 Host 主题改变。成品 PNG 作为 App 构建输入明确纳入版本管理。

## 连接

在 Host 安装插件后，输入使用可达 HTTPS authority 的官方登录链接。WebKit 通过官方浏览器认证交换 token。UserDefaults 只保存干净的 origin。App 在本地保存浏览器 Cookie，未实现设备配对、Keychain 设备凭据或服务端撤销。

连接页可切换主机、断开连接、清除本 App Cookie/缓存。清除不删除 Host 会话或撤销其他设备。用户点击的外部链接在配置的 WebView 之外打开。原生消息处理器校验主框架、同 origin 与桥接版本，处理 `ready`、`unloaded`、导航实际挂载的 `chrome` 状态，以及按能力声明开放的 `settings`/`scan` 请求。只有移动导航挂载后才隐藏回退连接栏，导航卸载时恢复。回前台通知 mobile 插件调用官方重连，不重复写命令。

蜂窝访问需要另行部署 HTTPS/WSS 转发并保留上游 Host/Origin 校验。Mac 必须保持唤醒和联网。本工程不代办网络配置、入口 Cookie Secure 加固、设备签名或蜂窝验收。

## 扫码登录与原生设置

原生分组设置包含当前主机、连接操作和仅作用于此设备的外观偏好。扫码使用 VisionKit 与相机权限，页面关闭或 App 进入后台时停止，沿用相同的 HTTPS 根地址/登录链接校验，在明确点击连接前仅预览干净的主机地址。扫码得到的完整登录链接只保留在内存，不存入偏好或输出日志。无效二维码、拒绝权限、相机不可用或不支持的设备均保留手动输入。主页面 HTTP 401 显示可恢复的登录错误。此功能接收已有官方登录链接，不签发设备配对凭据、不配置隧道；物理相机、权限及扫码到登录的验收待完成。

原生导航有 30 秒加载时限，超时提供“重新载入”和“连接设置”。对尚未提交导航或停留在空白页的 WebView，重新载入会明确请求配置的登录链接；已提交的同源页面则保留当前导航并刷新。HTTP 401 被拒绝后，后续 WebKit 策略取消错误不会覆盖“登录已失效”的说明。Debug 导航诊断只记录生命周期、同源匹配标志和状态码/错误码，不记录登录链接或 Cookie。

## 当前限制

已验证模拟器构建/安装/启动，以及 iPhone Air（iOS 26.5.2）上的签名安装/启动；也已通过设备开发服务验证真机导航和只读截图；完整触控自动化仍未验证。真机键盘/安全区、附件、后台/切网恢复、文件导出/分享与社区插件组合仍待验收。没有 APNs 或后台长连接保证。Xcode 工程已配置 App 图标，但未配置发行签名，是开发构建，尚不能直接作为 App Store 成品。

[真机记录](../../docs/acceptance/mobile-device-2026-09-11.md)与[初始验收记录](../../docs/acceptance/mobile-rc1-2026-09-11.md)区分浏览器证据、原生构建证据与未验证流程。

原生设置 Form 增加布局选择（自动/移动/桌面），通过 `dsh-mobile-display` 发送已知模式；浏览器插件负责持久化，并通过既有带版本 ready 桥回报模式。SwiftUI 负责原生安全区，插件在本壳内移除重复底部 inset。Debug 渲染诊断包含输入区、frame、上下文行的数值边界，用于真机布局检查。
