# Agent Note: 为 iOS App 内置可辨认的图标

Status: implemented

## Problem

iOS 开发版没有资源目录或主图标，虽然移动界面已有视觉设计，桌面入口仍呈现为空白占位。

## Decision

在 AppIcon.appiconset 内置一张不透明的 1024px 蓝白 D／对话气泡图片，将资源目录加入 App 的 Resources 阶段，并在两种构建配置中指定 AppIcon。设备尺寸由 Xcode 生成，外部圆角由 iOS 处理。静态玻璃风格图片沿用移动端配色，不依赖运行时绘制或 Host 连接。通过精确的忽略例外跟踪这张成品 PNG，调试截图仍保持忽略。

## Alternatives considered

运行时或下载的标志不能充当已安装 App 的桌面图标。单独维护主题变体并非消除空白图标所必需，因此本版先提供一张通用图片。

## Consequences

更新图标必须重新构建并安装原生 App，仅部署 Host 无效。图片是 App 的识别资源，不代表原生液态玻璃渲染或已具备 App Store 发行条件。模拟器与签名真机构建已编译资源目录，生成的小尺寸图标已进行视觉检查。实际安装留到用户授权的维护窗口。
