# 🐳 dsh-whalesong

> 任务跑着,鲸鱼喷水。Whale song while tasks run.

[English](README.md) | 中文

dsh web GUI 的状态氛围插件:只要有会话在跑,侧边栏的鲸鱼就喷水、标签页图标跟着动;任务完成或卡住等你时,播一小段提示音。零官方文件补丁、零模型可见副作用——装上,页面就活了。

<img src="docs/screenshots/10-whalesong.png" width="480" alt="任务运行时侧边栏鲸鱼喷水">

## 特性

- **favicon 水位气泡(主指示器)**——有任务在跑时标签页图标是吐泡的鲸鱼动画;空闲时定格为与页面配色一致的静态鲸鱼(官方图标的 `prefers-color-scheme` 跟随操作系统,浅色页面+深色系统下会隐形)。
- **侧边栏水滴**——工作进行中,三滴 DeepSeek 蓝的水滴从侧边栏鲸鱼的喷水孔升起。
- **提示音**——完成与阻塞各有不同音调(WebAudio 合成,无音频资源)。尊重 `prefers-reduced-motion`:动画隐藏、提示音静默。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-whalesong
```

然后重启 web 实例。卸载即精确还原之前的组合:

```sh
dsh plugin --profile web remove @khorsheed/dsh-whalesong
```

## 配置

可选,写在 profile patch 层,一个轮询周期内热生效(无需刷新浏览器):

```yaml
- id: whalesong
  config:
    enabled: true   # false = 无遮罩、无提示音、不订阅会话
    volume: 1       # 0..1 音量;0 静音但保持启用
```

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- 首次用户手势前到达的提示音(autoplay 策略)直接丢弃,不排队。
- 无逐会话音色区分,除插件配置外无设置界面。
- 官方侧边栏 logo 永不替换(零补丁遮罩);无锚点 id 时遮罩回退到轨道角落的固定位置。
- 已打开页面上热禁用会保留既有 fiber 直到刷新;插件自身的 dispose 路径无残留。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

纯浏览器侧行为(基于会话列表)+ 一个极小的配置服务宿主半。宿主半持有解析后的配置,经插件自有路由 `GET /whalesong/config` 提供(官方 settings RPC 拒绝外部命名空间);浏览器半每 3 秒轮询并应用,路由抖动时保留最后已知配置。

```
src/index.ts            宿主半:Config + GET /whalesong/config 路由(挂载锚点)
src/invariant.ts        包 invariant 伴生
src/client/index.ts     cordis 客户端插件:inject ['sessions'],ctx.effect 管生命周期
src/client/config.ts    配置同步:fetch + 3 秒轮询
src/client/controller.ts  运行时控制器:幂等启用/禁用状态机 + 2.5 秒 reconcile 轮询
src/client/status.ts    会话列表快照纯 diff 出 whalesong 事件
src/client/favicon.ts   favicon 动画:SVG 帧 data-URL
src/client/whalesong-overlay.ts  锚定官方侧边栏 logo 的固定遮罩
src/client/sound.ts     WebAudio 振荡器提示音(首次手势解锁 autoplay)
src/client/whalesong.module.css  水滴关键帧 + 开关 + reduced-motion 规则
```

状态语义:`anyRunning` 只数 UI 列出的会话 id;低频 reconcile 轮询重新 diff 快照,丢失的通知也会在工作结束后一个周期内清除。启用后的首帧是基线:已在运行的会话显示鲸鱼但不响铃。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/whalesong`)。问题与贡献请移步该仓库。
