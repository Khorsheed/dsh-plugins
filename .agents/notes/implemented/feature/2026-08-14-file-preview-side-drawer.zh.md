# Agent Note: 文件预览侧边抽屉

Status: implemented

[English](2026-08-14-file-preview-side-drawer.md) | 中文

## 问题

Web GUI 中的会话产物只能以工具调用卡片的形式呈现；预览一个阅读、写入或编辑过的文件意味着用外部编辑器打开它。客户端没有文件系统通道——对象层只暴露会话快照与 workspaces 的 `openPath`（OS 级打开）动词——因此浏览器侧抽屉无法自行读取文件内容，而且客户端分页、压缩后的会话窗口也不是"本次会话触碰过哪些文件"的权威来源。宿主会话日志才是权威来源，但此前没有任何机制以只读方式把它暴露给 UI，会话里的文件链接也只能打开 OS。

## 决策

交付一对双半插件。宿主半 [`@deepseek-ai/dsh-file-preview`](../../../../packages/fs/file-preview/README.md) 是一个只读的 `filePreview` Remote 服务，含两个方法：`list(agent)` 把 agent 会话中 `read`/`write`/`edit`（三者都用 `file_path` 参数键）工具的 `tool/call` 事件——以及这些工具已完结的 `tool/code-dispatch` 事件，因此只通过嵌套派发变更文件的 Code Mode 会话也被覆盖——折叠成首次出现序、去重的文件列表，并把每次 write/edit 的 `tool/result` 演示元数据里的 diff 按事件序追加到条目的 `diffs`（各带 seq/turn/step，`lastDiff` 保留为最后一次改动供只需最新值的调用方使用；纯日志折叠，不访问文件系统）；`read(agent, path, signal)` 以会话 cwd 为基准解析路径，通过 `ctx.fs` 提供当前文本内容，受 `maxReadBytes` 截断，并分类为 text/image/binary/missing/too-large/error。图片读取返回浏览器可加载的 URL，由专门的宿主路由（`/file-preview-image/<sessionId>/<path>`）提供字节；该路由仅在组合了可选的 `webServer` 与 `agents` 服务时注册（结构化的 `ImageRouteHost` 面让本包不依赖 webserver 包），无 web 宿主的场景下图片读取返回 `binary`。浏览器半 [`@deepseek-ai/dsh-client-ui-file-preview`](../../../../packages/client/ui-file-preview/README.md) 是纯增量插件，只依赖官方扩展点、不修改任何核心包。它通过 `ctx.remote.$mount` 挂载自己的 Remote——由于插件既挂载 `filePreview` 命名空间又消费它，命名空间**不**声明为 inject（那会让加载器死锁：fiber 等待服务，而该服务只有本 apply 的 `$mount` 才能提供；属性代理也看不到 `$mount` 派生的同级命名空间 fiber），因此挂载被 await 之后，用 `ctx.get('remote.filePreview')` 从全局服务 store 读回命名空间——通过 `conversationEvents` 注册回合文件折叠，并注册三个表面：会话 `conversation.view` 视图环的 `'file-preview'` 条目（与对话、轨迹并列，沿用 trajectory 注册先例），带会话作用域 store，只列会话产物（写入/编辑的文件，与对话区口径一致），最近活动优先，并预览所选文件——默认展示当前内容（预览区带内容搜索框，高亮匹配并逐个跳转），另有"改动"tab 可步进查看每一次记录的 diff，图片内联渲染；`conversation.chat.turnTail` 链里的每回合变更卡片；以及一个仅内容的抽屉（`shell.overlay`），不带文件列表预览单个路径。抽屉打开时在文档上标记 `data-file-preview-drawer-open`，由本插件自己的 CSS 把会话的滚动区与聊天框按抽屉宽度向左推，聊天内容不被盖住。两个表面共享同一个预览面板，在每次 tab 激活/抽屉打开时拉取 `list`，在选择时拉取 `read`；选择移动或表面卸载时丢弃过期的在途请求。每个表面都独立于页面滚动（沿用有界高度的 composer-overlay 先例），diff 行通过本插件自己的 CSS 软换行（共享的 `DiffBlock` 保持不动）。

文件链接只走官方扩展点——插件不修改任何核心包。每个已完成回合的文件变更渲染为 `conversation.chat.turnTail` 链中的一张"N 个文件已修改"卡片——该链每回合只选举一个条目（按 priority 升序取第一个 `select` 非空者），插件条目抢占官方产出文件行，两者不会共存；见[改道笔记](2026-08-15-file-preview-official-open-rerouting.md)——由插件自己的 `ConversationNodeDefinition`（`kind: 'filePreviewMutations'`）从 write/edit 的 `file_path` 参数客户端折叠，并带来自 diff 调用视图的逐文件行数增减。点击卡片中的文件行就地打开插件的抽屉（抽屉不需要会话句柄），抽屉头部还带"在文件夹中打开"/"在 IDE 打开"宿主手势（loopback + `canOpenPath` 门禁）。官方正文 mention 由同一笔记的捕获阶段拦截器改道进抽屉；正文里任意的文件路径维持宿主 OS 打开——核心没有供第三方拦截任意链接的钩子。控制器按会话 id 挂接各会话的 store、接管抽屉的 store，并在视图尚未挂载时暂存待处理路径。

该服务只读且受信任：它能读取 `ctx.fs` 允许会话访问的一切，因此组合它就等于授予对会话文件系统视图的预览权限——它不是安全边界，也不产生任何会话事件（model-visible ⟺ logged 不受影响）。

## 备选方案

**客户端扫描会话快照。** 已否决：客户端窗口分页且可能被压缩（并非完整日志），而且即便拿到完整列表，内容读取仍被阻塞——客户端没有文件通道，从浏览器再造一条会重复宿主的 `fs` 接缝。

**为文件列表建会话投影单元。** v1 已否决：投影用于客户端需要渲染并随推送更新的整值，而抽屉按用户手势刷新；`list` RPC 让宿主计算保持为普通方法，不引入缓存/持久化机制。若将来出现实时推送需求，仍可再加投影。

**接管 `details` 列。** 已否决：该列被 ui-conversation 的工具详情面板占用；文件视图改用增量式 `conversation.view` 视图环，不替换任何现有界面。

**用 patch 改写会话包以路由文件打开。** 已否决：patch 只能替换配置行，不能改写其他包已编译的代码；路由改为由核心持有的可选服务接缝，让插件保持可独立分发。

## 影响

视图仅文本预览（二进制与超大文件渲染分类提示），只显示当前会话的文件，且只读。列表是时间点折叠；没有新文件推送通道。核心缺少接缝的会话，文件链接仍按原样打开 OS。覆盖：宿主折叠/读取路径与视图的列表/预览/diff 生命周期有单元与组件测试，另有一个无密钥的 Loader 组合 e2e（`examples/headless-agent/tests/fixtures/file-preview`）以 `fs-local` 启动真实服务。
