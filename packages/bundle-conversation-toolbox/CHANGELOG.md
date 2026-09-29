# 变更记录

## 0.1.2（2026-09-30）

无功能变更。随宿主 0.2.0 兼容波重发：成员包的 `@deepseek-ai/dsh-*` peer 区间已加宽以覆盖宿主 0.2.0，bundle 重写后的成员依赖钉随之指向各成员新版本（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。

## 0.1.1（2026-09-27）

适配宿主 0.1.7-rc.2 线（verifiedHost 前移至 0.1.7-rc.2）。纯组合元包，无自有运行时代码；成员随本波集体重发：message-tools 0.3.2、taskpilot 0.3.2、context-guard 0.2.3、session-title-edit 0.2.3、message-timeline 0.2.3、quote 0.1.1、inline-html-render 0.1.14（成员各自的变化见各自 CHANGELOG）。

- README 删除一张从未存在的引用截图（bundle 卡面），全部图片引用可解析

## 0.1.0（2026-09-26）

首个公开发布。
