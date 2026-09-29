# 变更记录

## 0.2.4（2026-09-30）

- **设置面直接调用 schemastery 的类型化 `.volatile()`**：0.2.0 开发线解析到 schemastery 3.18.4，其 `Schema` 已声明 `volatile()`——手写的 `VolatileCapable` 强转探测不再类型重叠（TS2352）。运行期双线行为不变：探测在 0.1.5 的 schemastery 3.18.2（无 `volatile` 方法）上仍回落到普通字段
- 加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0

## 0.2.3（2026-09-27）

适配宿主 0.1.7-rc.2:官方自带快捷键系统(`dsh-client-shortcuts` + 面板 bundle)与本包在三个名字平面上撞车,改为按组合环境分双臂运行。

- **rc.2+(官方服务驻留):只贡献,不提供。** `ctx.provide('shortcuts')` 退场(cordis 对重复 provide 抛错),自有注册表/设置卡/键鼠分发全部不装;改为向官方目录贡献官方缺的两条命令——插队发送 `ui-shortcuts.steerSend` 与压缩上下文 `ui-shortcuts.compact`。暂停(Esc Esc)、新建会话(⌥⌘N)、右侧边栏(⇧⌘B)由官方原生承载,改键由官方快捷键面板承接
- **0.1.5 / rc.1(无官方服务):** 完整本地实现原样运行,行为不变
- **行 id 改名** `ui-shortcuts` → `khorsheed-ui-shortcuts`:官方面板行 id 同为 `ui-shortcuts`,loader 同 id 行后层覆盖前层,原名会把官方面板顶替掉
- **locale 命名空间改名** `shortcuts` → `ui-shortcuts`:官方面板已占 `shortcuts`,`locale.register` 对重复 (ns, locale) 抛错(症状是客户端条目卡在 loading)
- 键位政策适配官方注册表:web 不允许裸 `primary+Key`(插队发送 web 端默认改为 `Ctrl/Cmd+Shift+S`),web:linux 只收白名单(不预置),Linux 窗口管理器占用 `primary+shift+X`(compact 在两个 linux profile 不预置);单命令注册护栏——政策拒绝只丢该命令,不炸整包
- **rc.2 路径已知损失:鼠标键绑定无表示**(官方绑定协议纯键盘),中键开关右栏在 rc.2+ 不可用;0.1.5/rc.1 不受影响
- 验证:双基线 build+test 全绿(55 测试,新增 `tests/official.client.spec.ts` 6 用例),rc.2 npm 工具链 42 包全量组合真实启动实证——console 零报错,⌘/ 官方面板列出两条贡献命令且可改键,⇧⌘S 端到端提交草稿

## 0.2.2（2026-09-26）

适配宿主 rc.1 线并实证 0.1.5/0.1.7 双线可用（0.1.5-rc.1 全量 boot 实证，2026-09-25）。

- 设置面双线：rc.1 走 entry Config（dict 根 volatile 探测）+ `configForms`，0.1.5 留 `settings.register` + `settingsScope`；`settings.plugins.tab` 双臂注册；会话面迁移（宿主移除 `ISessions.open/current`）
- 图标自持化：rc.1 图标图样由 `sync-icon-artwork` 生成器摊平进包内 `src/client/icons.tsx`（双线渲染同一份图样）
- 插件清单展示元数据（`locale/*.json`）：rc.1 宿主插件页的卡面标题/描述中文化
- 新增「压缩上下文」动作（默认 `Ctrl/Cmd+Shift+X`）：对当前会话调用公开的 `ISession.command('/compact')`，与 composer 斜杠菜单走同一条宿主命令通道
- 新增「开关右侧边栏」动作（原「开关侧边栏」的**目标已修正**：`ctx.layout.toggleSidebar()` 是左导航栏，产品要的是右栏），**默认绑定鼠标中键**：调用 ui-sidebar-right 的公开服务 `ctx.sidebarRight.toggleExpanded()`；该服务是**探测**而非注入（`ctx.reflect.get('sidebarRight')`），没有右栏的组合里其余快捷键照常工作
- **修复**（随 0.2.2 首发即修的回归）：右栏开关第一版拿服务自身的 `active()` 当挂载探针，而「从未打开过的右栏」没有活动 tab —— 正是这个手势本来要展开的状态，结果中键毫无反应。现在门禁只要求「有右栏服务 + 有当前会话」，写入口在挂载前的抛错由兜底吞掉，并补了回归用例
- 动作 id 仍是 `toggleSidebar`（耐久键不改名），所以已录制的绑定（含中键）在新版本里继续按右栏生效
- 上述默认意味着开箱即接管中键的浏览器默认行为——自动滚屏（Windows）、主选区粘贴（Linux）、**中键点链接不再开新标签页**；不想让出这些手势或使用触控板，可在设置里一次点击改绑键盘组合键（如 `Ctrl/Cmd+B`）
- **键位模型扩展**：一条偏好现在可以是键盘键位或鼠标键（`kind: 'mouse'`，DOM `MouseEvent.button`，只收 1=中键 / 2=右键；主键与浏览器后退/前进侧键刻意不可绑）。设置卡片在录制状态下可直接按下中键/右键完成绑定
- `global` 鼠标动作在 `mousedown` 执行并接管该键的浏览器默认：自动滚屏（Windows）与主选区粘贴（Linux）挂在下按事件上，链接新标签页（`auxclick`）与右键系统菜单（`contextmenu`）在后续事件上
- 鼠标绑定的显示：键帽内画鼠标俯视图并**点亮所绑的那颗键**，旁边是本语言的「中键 / 右键」（新增 `gesture.middle`/`gesture.right` 文案），不再出现硬编码英文 `Middle Click`；示意图 `aria-hidden`，可访问名由旁边的词承担

## 0.2.1（2026-09-11）

- 无功能变更：开发基线随仓内 pin 对齐官方 `0.1.5-rc.1` / cordis `4.0.2`（消除 4.0.1/4.0.2 双实例图分裂）；peer 依赖范围与 minHost（`0.1.2-rc.1`）不变

## 0.2.0（2026-09-10）

适配宿主 0.1.2 线。

- **BREAKING**：minHost 前移至 `0.1.2-rc.1`；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 线（末版 `0.1.0`）
- 导入面迁移：client bundle 不再引用宿主已删除的 `dsh-client-runtime`；设置注册改用裸命名空间（`settingsNamespace()` 已随宿主移除），ui-primitives 组件补齐强制 labels

## 0.1.0（2026-08-22）

首个公开发布。

- `Esc` 暂停当前回合，与 composer 的 Stop 按钮同一操作，页面任意位置可用
- `Ctrl/Cmd+S` 插队发送当前草稿，绑定时抑制浏览器保存手势
- `Ctrl/Cmd+O` 新建会话，绑定时抑制浏览器打开文件手势
- 键位可重绑：设置 → 插件 → 快捷键 中点击键帽即可录制、解绑或恢复默认，偏好持久保存
- Escape 分层：让位于已消费按键、打开的弹层与可编辑目标，不误伤行内重命名与搜索框
