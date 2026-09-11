# Agent Note：压缩上下文 + 侧边栏快捷键，与鼠标按键绑定

Status: implemented

[English](2026-09-11-ui-shortcuts-compact-and-sidebar.md) | 中文

## 问题

两个日常"打理对话"的手势在快捷键插件里都没有入口，其中一个连键盘入口都没有：

- 压缩模型上下文，只能靠在 composer 里手敲 `/compact`。
- 开关侧边栏，只能用侧边栏自己的收起按钮（窄窗口时是它的图标轨）。

产品负责人要求补齐两者，并特别问到侧边栏能不能挂在**鼠标中键**上。当时的绑定模型回答不了这个问题：`ShortcutPreference` 是 `{ kind: 'none' } | BoundKey`，没有第三条臂；设置里的录制器只听 `keydown`；分发也只有一对 keydown 监听。无论答案是什么，这两件事里必有一件要先改。

## 决策

**新增两个固定内置动作**，与既有三个一样通过公开的 `ctx.shortcuts` 注册：

| 动作 id | 默认键位 | 行为 |
| --- | --- | --- |
| `compact` | `Ctrl/Cmd+Shift+X` | 对当前会话调用 `ISession.command('/compact')` |
| `toggleSidebar` | `Ctrl/Cmd+B` | 调用 `ctx.layout.toggleSidebar()` |

两者都是 `global` 分层（capture 阶段、接管浏览器默认），并且都带 `available` 门禁：`compact` 需要当前会话，`toggleSidebar` 需要活着的 `ctx.layout`。门禁在鼠标路径上同样必要——它正是"不给一个空操作白占按键"的东西。

压缩走会话面的 command 动词，而不是某个压缩服务：`/compact` 是宿主自己的命令，所以准入（智能体忙碌、无可压缩历史）、`command/run`/`command/done` 耐久生命周期、以及渲染出的流程节点都与手敲命令完全一致——插件只加了一个键位，没有加第二条代码路径。

`ctx.layout` 是**探测**而非注入：`ctx.reflect.get('layout')` 不需要 `inject` 边就能读到 ui-layout 的服务，因此没有 shell 的组合里暂停/插队/新会话/压缩照常工作，只有这一个动作让位。探测的类型由包内最小的 `LayoutFace` 承载，所以本包依然不对 ui-layout 产生依赖（也没有 lockfile 边）。

**一条偏好现在可以是键盘键位，也可以是鼠标键。** `BoundMouse { kind: 'mouse', modifiers, button }` 与 `BoundKey` 一起并入 `ShortcutBinding`，耐久 schema 变成三臂联合。词汇表是 `SHORTCUT_MOUSE_BUTTONS = [1, 2]`——DOM `MouseEvent.button` 的 1（中键）与 2（右键）。主键刻意不在其中：一个全页左键动作会吃掉每一次普通点击，而且左键正是操作录制器本身的按键。浏览器的后退/前进侧键（3/4）出于另一个原因缺席——引擎会先把它们交给历史导航，页面拿不到可靠事件。

修饰键对鼠标手势的作用与对键盘完全一致，所以 `primary`+中键与裸中键是两个不同绑定。

**分发与键盘路径同构。** `dispatchMouse` 与 `dispatch` 共用 `matchAction` 和 `yield` 层的让位判定（`defaultPrevented`、打开的弹层、composer 之外的可编辑目标）；被认领的 `global` 手势随后 `preventDefault` 掉下按事件——自动滚屏（Windows）与主选区粘贴（Linux）就挂在那里。那些「稍后才发生」的默认由第二个互补监听接管：`auxclick`（中键点链接开新标签页）与 `contextmenu`（右键系统菜单）。该监听只抑制、绝不重跑动作，所以一次绑定只换来一个后果。

**录制。** 某个动作处于录制状态时，设置行在 keydown 监听旁再装一个 capture 阶段的 `mousedown` 监听：可绑定的鼠标键完成绑定并接管下按事件。主键被忽略，所以再次点击录制按钮仍走它自己的 `onClick` 取消。全局监听注册在设置行之前，因此它们在"完成绑定的那个事件"上就已经看到 `capturing` 标志，绝不会把正在录制的动作触发出去。

**展示。** 绑定鼠标键的键帽不是文字，而是一张设备示意图：`MouseGlyph` 画 16×22 的俯视图（轮廓、左右键分割、滚轮），把被绑定的那颗键填成主题强调色，行组件再把本语言的词放在它旁边（`gesture.middle` / `gesture.right`）——键帽回答的是"按设备上哪一颗"，而任何编号体系都做不到跨引擎一致（Source 的 `MOUSE2` 是右键、Ren'Py 的 `2` 是中键、DOM 的 `1` 才是中键）。因此 `bindingParts` 从"返回成品文案"改为"返回槽位"——`{kind:'modifier'} | {kind:'key'} | {kind:'mouse'}`，`formatBinding` 接受一个可选的逐槽文案函数：行组件传入自己的 translator，于是默认提示与文本形态用的就是键帽上那个词。示意图 `aria-hidden`，且不含任何 `id` 与裁剪路径（点亮的键帽用与机身圆角同几何的弧线绘制），所以同一页面里多张示意图不会在 fragment id 上撞车；旁边那个词仍然是按钮的可访问名。

## 考虑过的备选

**注入 `layout`（`inject: ['layout']`）。** 否决：cordis 的注入会让整个插件在服务就位前处于 pending——没有 ui-layout 的组合会丢掉**全部**快捷键，而不只是这一个。"degrade, don't explode" 正是为这种情形写的，探测也是仓内其他可选服务包用的同一手法。

**声明 `@deepseek-ai/dsh-client-ui-layout` 可选 peer 依赖并导入它的 Context merge。** 否决：它只为一次探测换来更好的类型，代价是一条 lockfile 边——那是 mainline 掌管的共享状态；包内最小 face 已经够用，也让本包保持零依赖。

**压缩直接调 `ctx.remote.commands.execute()`。** 否决：`ISession.command(line)` 才是会话寻址命令通道的公开文档动词，而插件本来就用 `ctx.sessions` 解析会话；绕到 Remote 只会多一条注入边，并重复 facade 已经拥有的寻址。

**把中键作为侧边栏的出厂默认。** 被产品负责人否决。macOS 触控板默认没有中键，用起来别扭；而一个全局中键会把页面上每一个链接的"新标签页打开"都抢走——对一个要发布的插件来说是坏默认。默认给键盘键位，鼠标在设置里一次点击即得，这正是这次鼠标绑定工作要让它成为可能的。

**压缩用 Ctrl/Cmd+Shift+C 或 Ctrl/Cmd+Shift+K**（首字母助记）。否决：DevTools 的 inspect 与 Firefox 的 Web Console 在浏览器层占着这两个组合键且不可靠拦截——用户会同时得到动作**和**浏览器的面板。压缩因此落在一个无浏览器默认的键位上，且可重绑。

**绑定浏览器后退/前进侧键（3/4）。** 否决：历史导航在引擎层就认领了它们，页面不能指望收到事件；那会让词汇表宣称一个永远不会触发、且是静默的绑定。

**允许主键并加保护。** 否决：没有任何保护能让"全页左键动作"变得安全，录制器也无法区分"录制左键"和"操作录制器"。

**给动作加 `middleClick: boolean` 标志，而不是通用的鼠标绑定类型。** 否决：这会在注册表、设置行与耐久格式里为单个动作开特例，而录制器仍然需要鼠标捕获；通用类型只多一个联合成员，却让每个动作（包括别人贡献的）都能绑鼠标键。

**用 `MOUSE3` 这类文字 token 取代设备示意图。** 否决：编号是各引擎方言（Source 的 `MOUSE1`–`MOUSE5`、Ren'Py 的 `mousedown_1`–`5` 把滚轮放在 4/5、DOM 的 0/1/2），无需查表的只能是图形；而六字符 token 会把这个图形本来要解决的宽度问题原样带回来。

**保留英文文案 `Middle Click`。** 否决：它是中文卡片里唯一会被当散文渲染的标签（和「插队发送」并排），约 90px 宽、是整行里最宽的键帽。现在这个词由 locale 拥有；`Ctrl/Cmd`、`Esc` 这类修饰键/按键图例则刻意保持英文键帽图例，与改动前一致。

**纯图形的键帽。** 否决，哪怕它最紧凑：按钮的可访问名来自其文本内容，去掉词就必须补 `aria-label` 或视觉隐藏文本才还有名字，而测试套件里的 `getByRole('button', { name })` 正好钉住这条契约。将来要做，得先把那层文本一起交出来。

## 影响

- 耐久 `ui-shortcuts` 小节现在是三臂 dict。存量文档（`kind: 'none'` / `kind: 'key'`）照常读取，无需迁移。**降级是不对称的那一侧**：旧版插件按两臂联合校验，因此带 `kind: 'mouse'` 条目的小节会被旧 schema 拒绝——清掉该条目（或把动作改录回键盘）是回去的路。这是本包第一次动到"降级读不了"的耐久格式。
- 设置卡片渲染五行，录制提示文案开始提及鼠标。
- 文案契约换了形状：`bindingParts` 产出槽位而非字符串，`formatBinding` 接受可选文案函数。只有鼠标词由 locale 拥有——修饰键与按键图例仍是它们一直以来的英文键帽图例，所以中文卡片读作 `Ctrl/Cmd` + `[示意图] 中键`，而不是被翻译的修饰键。
- 无障碍靠词而不是图：示意图 `aria-hidden`，按钮的可访问名就是它可见的文本。将来做纯图形变体，必须同一次改动里补上 `aria-label`（或隐藏文本），否则名字会消失。
- 绑定鼠标键就是全局手势，代价真实：绑定生效期间上面列出的浏览器默认全部被抑制。两份 README 的「已知限制」都写明了，并给出退路（改回键盘键位）。
- 无新依赖、无 peer 依赖变更、无 lockfile 变更，`minHost`/`verifiedHost` 不变，也不需要任何宿主改动——两个动作本来就能通过公开动词到达。
- 验证：本包测试套件（44 个用例）覆盖鼠标词汇（录制、匹配、显示、相等性）、耐久 schema 对 `button: 1|2` 的接受与对 `0`、`3` 及未知修饰键的拒绝、经 `ISession.command` 的分发、有/无 layout 服务的两条探测路径、鼠标分发与其 `auxclick`/`contextmenu` 抑制、鼠标手势的 `yield` 层、以及录制期间的全局停摆。两份 README 的动作表与已知限制与实际行为一致。
