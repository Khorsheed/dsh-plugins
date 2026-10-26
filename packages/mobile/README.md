# @khorsheed/dsh-mobile

[English](README.en.md) | 中文

离开电脑也能接着聊：手机扫个码，在浏览器里继续你的 DSH 会话。

DSH 的网页是照着电脑屏幕做的，用手机打开，侧栏占掉半屏，按钮小得点不中；想从外面连回家里那台电脑，还得自己折腾域名和转发。装上移动端，在电脑上打开「设置 → 连接手机」，点一下就有一个能从外网访问的地址；用手机相机扫二维码，浏览器里打开就是专门给手机排好的界面。活还是电脑在干，手机只负责看和说。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-library.png" width="640" alt="移动端会话首页:时间与工作区分组、底部搜索框与扫码入口">

## 能做什么

- **扫码就连上**：相机扫码 → 在浏览器打开 → 「添加到主屏幕」，之后像 App 一样点开。iOS App 是可选的，不装也能用。
- **不用自己买域名**：点「启用公网入口（临时域名）」，就有一个手机在外面也能访问的地址；不需要 Cloudflare 账号。
- **电脑重启也不用重扫**：DSH 重启或更新后地址不变，已经登录的手机照常能用。
- **睡醒很快恢复**：电脑睡眠后地址会变，它醒来后自己换上新地址，约一分钟内出新二维码，你重扫一次就好。
- **出错说得清**：连不上时它会一直自动重试，设置页写明卡在哪一步、为什么。
- **界面为手机重排**：会话首页按时间或工作区分组、能搜标题；输入框的按钮更大、够得着；在手机上也能选电脑上的目录。
- **跟其他插件合得来**：消息的复制 / 编辑 / 撤回、协作间邀请成员这些照常能用。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/mobile-conversation.png" width="640" alt="移动布局下的会话页:会话头部与成员 tab、消息流、底部输入工具栏">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-basic
```

移动端会跟着「基础体验」一起装好。装完在电脑上打开「设置 → 连接手机」，按页面上的步骤扫码。一键公网入口需要电脑上装了 cloudflared（例如 `brew install cloudflared`），没装时页面会告诉你怎么做。

## 已知限制

- 电脑要保持开机联网；电脑睡眠或重启后地址会变，手机得重扫一次。想要永远不变的地址，需要自己的域名（做法见「给开发者」里的完整参考）。
- 二维码等于这台电脑的登录凭据，别发给别人；隐藏二维码不会让已经登录的手机掉线。
- 还没有按设备管理登录和消息推送；真机验收仍在进行中。

## Compatibility

需要 DSH 0.2.0-rc.2 或更新版本（0.1.x 宿主请停留在本插件 0.1.4），真机验收完成前暂不标注已验证版本。

## 给开发者

- 自有域名 / 命名隧道的静态配置、公网入口守护进程的工作方式、各接口的安全边界、卸载会留下什么，见[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/mobile/docs/reference.md)；可选的 iOS 薄壳见 [apps/ios](https://github.com/Khorsheed/dsh-plugins/blob/main/apps/ios/README.zh.md)（需自行用 Xcode 编译安装）。
- 也可以单独安装：在「添加插件」里输入 `@khorsheed/dsh-mobile`，或 `dsh plugin --profile web add @khorsheed/dsh-mobile`，重启并刷新客户端后生效；`?mobile=1` / `?mobile=0` 可手动开关移动布局。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
