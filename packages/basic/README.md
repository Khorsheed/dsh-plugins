# @khorsheed/dsh-basic

[English](README.en.md) | 中文

日常使用的 dsh 体验,一个包装齐:消息工具、会话产物、文件列表、上下文守卫、移动端……清单里只多一张「基础体验」卡片,不用在十四个插件之间逐包挑选。

## 特性

- **一次装齐一族**——消息工具、消息时间轴、标题编辑、引用、内联卡片、上下文守卫、后台任务、会话产物、文件列表、能力目录、移动端、进度提醒、重启守卫、上下文透镜,一条安装全部就位。灵感空间（`@khorsheed/dsh-reader`）2026-10-19 起随学习模式与写作模式安装，不在本合集里；它的渲染抓取（`@khorsheed/dsh-capture`）2026-10-20 起也一起移过去了。侧边对话（`@khorsheed/dsh-sidechat`）同日移出（未随合集发布）；快捷键（`@khorsheed/dsh-ui-shortcuts`）退役——宿主 0.1.7-rc.2 起官方内置快捷键设置。
- **清单里只有一张卡**——locale 卡面元数据把整族归成一张「基础体验」卡;详情页里仍是逐行成员,带行级启停开关。
- **纯组合,零运行时**——本包不注册任何服务/工具/槽位/命令;patch 逐字复用成员的规范行,装我不双挂(机制见文末实现原理)。

## 成员

| 成员包 | 行 id | 能力 |
| --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` | 编辑或撤回已发送的消息,撤回内容真正离开模型上下文 |
| `@khorsheed/dsh-message-timeline` | `message-timeline` | 对话左缘的消息时间轴,一点跳回任意一条你说过的消息 |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` | 在聊天标题旁就地重命名当前会话 |
| `@khorsheed/dsh-quote` | `quote` | 选中文本浮出动作菜单:引用到会话/侧边对话、复制 |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` | 在对话正文内联渲染可交互的沙箱 HTML 卡片 |
| `@khorsheed/dsh-context-guard` | `context-guard` | 上下文占用越过设定比例时在输入框提醒一键压缩 |
| `@khorsheed/dsh-taskpilot` | `taskpilot` | 在聊天框上方查看后台任务和子 agent,可随时停止 |
| `@khorsheed/dsh-file-preview` | `file-preview` | 预览 agent 写过、改过的文件,步进每一次改动 |
| `@khorsheed/dsh-local-files` | `local-files` | 浏览任意本地目录,预览 HTML、Markdown、JSON、CSV 和图片 |
| `@khorsheed/dsh-capability-catalog` | `capability-catalog` | 列出实例中所有技能与工具,标注各自的注册渠道 |
| `@khorsheed/dsh-mobile` | `mobile` | 移动布局、会话首页和 iOS 客户端桥接 |
| `@khorsheed/dsh-whalesong` | `whalesong` | 任务运行时鲸鱼喷水动画,完成或阻塞时播放提示音 |
| `@khorsheed/dsh-ankh-guard` | `ankh-guard` | 先证明构建与测试通过,才放行自我修改的重启 |
| `@khorsheed/dsh-context-lens` | `context-lens` | 按 turn 查看每次模型请求的完整组成:system 分段归因、工具定义、token 与耗时分布 |

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-basic`(或从市场索引里选它),确认后重启实例——装这一个,十四个成员随依赖一起到达,行由本包的 patch 统一挂载。

命令行等价:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-basic
```

卸载即整族移除;想保留家族、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.5-rc.1`):✅ 完整——纯组合,地板取成员最高者(minHost `0.1.5-rc.1`;部分成员地板更低)。地板之上各成员的个别行为差异见各成员自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.2.1-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **卸载是整族的**——remove 本包会把全部成员一起移除,没有「从 bundle 里退掉单个成员」的操作;单行停用请用 bundle 详情页的行级开关。
- **不带模式 preset**——本包是基础体验集合,不携带任何 `@deepseek-ai/dsh-agent-preset` 行;模式(开发/写作/学习/剪辑/游戏开发)由对应的 `@khorsheed/dsh-<mode>` 模式包提供。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**纯组合元包。** `cordis.patch.yml` 的每一行都来自对应成员包自己的 `cordis.patch.yml`,id 与 name 原样。仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点:行只允许落在「成员规范行全集」白名单内,成员必须是真实自挂载包,每个成员必须至少贡献一行。

**装我 = 装一族,不双挂。** 成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。机制依据:`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员作为传递依赖到达,它们自己的 patch 不被应用,任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载(仓规不破);两者同装时的行重叠由官方 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`FAMILY_MEMBERS`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/basic`)。问题与贡献请移步该仓库。
