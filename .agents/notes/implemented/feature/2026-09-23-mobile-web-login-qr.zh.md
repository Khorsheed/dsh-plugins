# Agent Note: 为现有 iOS 扫码器补齐 Web 登录二维码

Status: implemented

## Problem

iOS 薄壳已有扫描官方 HTTPS 登录链接的能力，但桌面没有生成入口。临时隧道换域名后，手机仍指向旧 authority，手动复制启动链接容易出错。原 proposal 也仍将扫码描述为未实现。

## Decision

Mobile 通过公开槽位贡献跨会话的连接手机设置分区。GET 只返回部署配置状态；用户点击显示后，已认证的同源 JSON POST 调用公开 `connection.authenticatedUrl`。目标来自 `publicOrigin`，缺省读取 `DSH_MOBILE_PUBLIC_ORIGIN`；必须是无凭据、非 loopback 的 HTTPS origin，并通过现有 Host 信任检查。浏览器 payload 不能覆盖目标。不读取宿主私有字段或签名材料，不增加另一套会话格式或免认证凭据接口。

浏览器打包 qrcode-generator，在两种主题下本地绘制带留白区的黑白 SVG。凭据只存在组件/请求内存中，不经过第三方服务、存储或导航。分区卸载、页面隐藏或展示两分钟后会隐藏二维码并取消待完成请求。这只是隐藏，并非过期或撤销：官方进程 token 在宿主重启前仍有效，已有 Cookie 保留宿主规定的生命周期。

复用原生扫码器及主机确认步骤，无需重建 IPA。HTTPS 入口、信任域名和 public origin 仍由部署者管理；活跃连接归零的隧道须先恢复，扫码才能发挥作用。

## Alternatives considered

- 手动输入启动链接会重复当前恢复问题。
- 第三方二维码服务会额外泄露 bearer 凭据。
- 浏览器任意指定目标或自定义 Cookie 会引入第二套信任实现。
- 将二维码称为一次性或限时凭据不符合官方 token 契约；独立设备配对/撤销继续后置。

## Consequences

两端共享官方登录语义；配置或能力缺失时显示提示，不阻止启动。可选 settings peer 只在槽位存在时贡献入口，编码器增加小型打包依赖。本次不管理隧道、不续签 iOS 签名、不增加 APNs 或 Keychain 授权，也不等于完成全部真机/跨网验收。

## Testing

构建与 109 项包测试通过，覆盖目标/信任校验、POST Origin/Content-Type 检查、错误脱敏、路由卸载、主动生成、隐藏及请求取消竞态。物理相机权限/扫码与浏览器登录、渲染验证分开验收。mobile/iOS 双语 README 和 proposal 总账区分已交付基础登录与后置增强配对。
