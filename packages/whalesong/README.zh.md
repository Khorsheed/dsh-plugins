# 🐳 dsh-whalesong

> 任务跑着,鲸鱼喷水。Whale song while tasks run.

[English](README.md) | 中文

Whalesong 是 dsh Web GUI 的可选状态氛围组合包:只要有会话在运行,侧栏鲸鱼就会喷水、标签页 favicon 会动起来;任务完成或阻塞等待你时,会播放短提示音。
全部行为都发生在浏览器端、只读会话列表,宿主半只负责提供服务配置——对官方文件零补丁、对模型零可见影响、不替换任何官方 UI 槽位。

## 安装

一条命令,无需 checkout、无需手动配置:

```sh
dsh plugin --profile web add @khorsheed/dsh-whalesong
```

然后重启 web 实例。
组合包是纯增量的:只挂载自己的入口行,执行 `dsh plugin --profile web remove @khorsheed/dsh-whalesong` 即可精确还原原组合。

## 功能

- **favicon 水线气泡(主指示)**:任一会话运行期间,标签页图标变成鲸鱼在水线下浮动、三颗气泡上升(SVG 帧,无 canvas);空闲时标签页保持一只**按页面主题着色的静态鲸鱼**(浅色页面黑鱼、深色页面白鱼),不再恢复官方原图——官方图的 `prefers-color-scheme` 跟随系统,浅色页面 + 深色系统会渲染出看不见的白鱼。只有拉取官方图失败才回退到原图标;瞬时失败会在下一次激活沿或主题切换时重试。
- **侧栏水滴**:三颗 DeepSeek 蓝水滴从侧栏鲸鱼喷气孔上升(DOM 叠加层锚定官方 logo;找不到锚点时兜底定位到折叠栏角落)。
- **提示音**:完成 = 三连上升滑音(380→520→700→990 Hz);阻塞 = 440→660 Hz 上扬重复两次(WebAudio 合成,无音频资源文件)。`prefers-reduced-motion` 下动画隐藏且提示音静音。

## 配置

cordis 插件配置写在 profile patch 层(或更晚的 `--patch` overlay),一个轮询周期内热生效,无需刷新浏览器:

```yaml
- id: whalesong
  config:
    enabled: true   # false = no overlay, no chimes, no session subscription
    volume: 1       # 0..1 loudness; gain = 0.1 × volume; 0 mutes without disabling
```

宿主半持有解析后的配置,并通过插件自有路由 `GET /whalesong/config` 提供给浏览器(官方 settings RPC 对外部插件命名空间有白名单拦截,所以用 cordis Config + 自有路由)。
浏览器半每 3 秒轮询一次并应用变化;路由不稳定时保持最后一次已知配置。

## 架构

```
src/index.ts            host half: Config + GET /whalesong/config route (mount anchor)
src/invariant.ts        package invariant companion (no runtime checks: no second authority exists)
src/client/index.ts     cordis client plugin: inject ['sessions'], ctx.effect owns lifecycle
src/client/config.ts    config sync: fetch + 3 s poll; no-fetch surfaces keep the default
src/client/controller.ts  runtime controller: idempotent enabled/disabled state machine + 2.5 s reconcile poll
src/client/status.ts    pure diff of session-list snapshots into whalesong events
src/client/favicon.ts   favicon 动画:SVG 帧 data-URL;空闲时保持按页面主题着色的静态鲸鱼
src/client/whalesong-overlay.ts  fixed overlay anchored to the official sidebar logo
src/client/sound.ts     WebAudio oscillator chimes (autoplay-unlock on first gesture)
src/client/whalesong.module.css  droplet keyframes + on/off + reduced-motion rules
```

状态口径:`anyRunning` 只统计 UI 列表里的会话 id(addressed 子 agent 行可能从子 catalog 残留 running 位,曾致叠加层卡死),另加低频对账轮询兜底通知丢失,任务结束后一个间隔内必然复原。
启用后的首帧是基线:已在运行的会话显示鲸歌但不会播音。

## Model Experience

None, as the plugin only renders browser-side status ambience from the session list and registers nothing model-facing.

#### KV Cache effect

None.

## 兼容性

- npm 发布线(`@deepseek-ai/dsh@0.1.0-rc.7`):✅ 完整——运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery)。
- 源码线(deepseek-harness master):✅

## 已知局限与延期工作

- 首次用户手势(autoplay 策略)之前到达的提示音被丢弃,不排队。
- 不按会话区分音色;除插件配置外没有设置 UI。
- 不替换官方侧栏 logo 本体(single 槽,零补丁叠加);找不到锚点的侧栏上,叠加层兜底定位到固定角落。
- 已打开页面上热停(`entry.update({disabled})`)后,该页面既有 fiber 需刷新才卸载(hot-first 语义);插件自身 dispose 路径零残留。
