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

## 连接

在 Host 安装插件后，输入使用可达私网 HTTPS authority 的官方登录链接。WebKit 通过官方浏览器认证交换 token。UserDefaults 只保存干净的 origin。App 在本地保存浏览器 Cookie，未实现设备配对、Keychain 设备凭据或服务端撤销。

连接页可切换主机、断开连接、清除本 App Cookie/缓存。清除不删除 Host 会话或撤销其他设备。用户点击的外部链接在配置的 WebView 之外打开。原生消息处理器校验主框架、同 origin 与桥接版本，只处理 `ready` 和 `unloaded`。回前台通知 mobile 插件调用官方重连，不重复写命令。

蜂窝访问需要另行部署私网 HTTPS/WSS 转发并保留上游 Host/Origin 校验。Mac 必须保持唤醒和联网。本工程不代办网络配置、入口 Cookie Secure 加固、设备签名或蜂窝验收。

## 当前限制

已验证模拟器构建/安装/启动；原生画面自动化被 macOS 电脑控制权限阻挡。真机键盘/安全区、附件、后台/切网恢复、文件导出/分享与社区插件组合仍待验收。没有 APNs 或后台长连接保证。Xcode 工程未配置发布图标和发行签名，是开发构建，尚不能直接作为 App Store 成品。

[验收记录](../../docs/acceptance/mobile-rc1-2026-09-11.md)区分浏览器证据、原生构建证据与未验证流程。
