# Agent Note:ui-shortcuts 在官方 rc.2 快捷键服务驻留时改骑官方(三层同名撞车已解)

Status: implemented

## 问题

宿主 0.1.7-rc.2 自带快捷键系统——`shortcuts` 服务(`dsh-client-shortcuts`)加 `dsh-client-ui-shortcuts` 面板 bundle——ui-shortcuts 在三个互不相干的名字平面上与它撞车,各有一种死法:

1. **cordis 服务名。** 本包历来 `ctx.provide('shortcuts', registry)`。cordis 对重复 provide 直接抛错,rc.2 组合里两个提供者必须有一个不提供。
2. **loader 行 id。** patch 层把本包挂在 `ui-shortcuts` 行——官方 web-app bundle 给面板的正是这个行 id。loader 组配对同 id 行后层覆盖前层,我们的行把官方面板整个顶替(这也掩盖了撞车 3:面板没 apply,它的 locale 注册从未跑)。
3. **locale 命名空间。** 两个包都注册 `shortcuts` locale 命名空间,而 `locale.register` 对重复 (ns, locale) 直接抛错。行 id 修好、两个 bundle 都挂载之后,这个抛错浮现为客户端条目卡在 `loading`——apply 开始了,register effect 抛错,loader 始终无法落终态。

## 决策

本包在 apply 时探测 `ctx.get('shortcuts')` 是否为官方面(register 动词加 `catalog.getSnapshot`——catalog 标记用来区别于本包旧注册表),**走两条路径**:

- **rc.2+(官方驻留):只贡献,不提供。** 自有注册表、设置卡、键/鼠分发、偏好接线全部退场。本包按官方命令契约(label/aliases/defaults/regions/modals/resolve)只注册官方目录缺的两条命令——`ui-shortcuts.steerSend` 与 `ui-shortcuts.compact`。暂停、新建会话、右侧边栏开关由官方原生承载(`response.stop` Esc Esc、`session.new`、`sidebar.right.toggle`),改键由官方面板承接。每次 `register` 单独加护栏:官方注册表对键位政策违规直接抛错(web 不允许裸 `primary+Key`,web:linux 只收白名单,Linux 窗口管理器占用 primary+shift+X),政策变化必须只丢一条命令,不丢整个插件。
- **0.1.5 / rc.1(无官方服务):** 完整本地实现原样运行——注册表提供在 `shortcuts` 下、设置卡、键盘与鼠标绑定。

让共存成立的两处改名:patch 行 id 改为 `khorsheed-ui-shortcuts`(身份三角的例外:包名与 `PACKAGE_NAME` 保持 `ui-shortcuts`/`@khorsheed/dsh-ui-shortcuts`,只有 loader 行 id 动);locale 命名空间改为 `ui-shortcuts`(见 `src/client/locales.ts`)。

## 否决的方案

**保留自有注册表并在我们的 profile 里停用官方服务。** 否决:快捷键 UX 永远分叉(两个面板、两套绑定存储),未来每条官方命令都得维护影子副本。官方系统在键盘平面严格更好(按 profile 的默认键位、模态作用域、可搜索的改键面板)。

**整包退役。** 记录时仍在台面上,附一条证据提醒:官方 rc.2 目录**没有 compact 命令、也没有 steer-send 命令**(逐一看过官方全部 `shortcuts.register` 调用点——ui-layout、ui-workspace、ui-sidebar-*、ui-settings-general、ui-open-in-app;`/compact` 只是斜杠命令,steer 只是 composer 可配置的 ⌘Enter 互补行为)。退役本包会连这两个键盘手势一起退役。双路径构建即对冲:它已经实现「官方拥有系统」,同时保住这两条命令。

**不改名,用无类型重载把我们的词典挂进官方 `shortcuts` 命名空间。** 否决:抛错是刻意设计(一个命名空间一个属主),骑官方命名空间只会在官方某天加了同名 key 时炸掉。

## 后果

换来:rc.2 全量组合真实启动零 console 报错,两个 bundle 共存,我们的两条命令带本地化文案出现在官方面板且可在面板里改键,0.1.5/rc.1 行为不动(双基线 55 测试全绿)。

rc.2 路径上如实记下的损失:**鼠标键绑定在官方纯键盘协议里没有表示**(中键开关右栏活不下来),web 端插队发送默认从 `primary+S` 挪到 `primary+shift+S`(官方政策)。两条都进了 README 已知限制;若有人怀念鼠标手势,上游提案是它们的退役路径。

## 测试

`tests/official.client.spec.ts` 钉住官方路径:探测面、两条命令以合政策的默认键位注册、单命令护栏(注册表拒绝只丢一条命令、不炸启动)、无主会话时 resolve 让位、以及绝不尝试 `provide`。旧测试套件原样跑在 0.1.5 形态的 bench 上。rc.2 实证实例(31417 端口)活体验证:console 干净,⌘/ 打开官方面板列出 插队发送 ⇧⌘S 与 压缩上下文 ⇧⌘X,⇧⌘S 端到端提交了草稿(回合仅因实例缺 API key 失败,恰好证明分发真实发生)。

## 相关

- [客户端 bundle 内联 rc.1 图标画作](../bug-fix/2026-09-26-icon-artwork-self-owned.zh.md)——另一类 rc 线撞车(只存在于某条宿主线的导出);同一教训、不同平面:共享的名字就是契约,可能已被别人占用。
