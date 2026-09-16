# 变更记录

## 0.1.0-rc.1（未发布）

文件列表浏览器首发线（自 worktrees 拆出后的独立包）。

- 内容搜索不再劫持视图：命中经 CSS Custom Highlight API 画在渲染后的 markdown / JSON 树 / CSV 表 / 代码视图上（`::highlight()` 外包 `:global()`，否则 lightningcss 会像类名一样改写标识符导致静默不上色）；只有渲染态确实看不见的查询（如搜 `**`、命中落在折叠的 JSON 节点里）才回落到原始命中行视图。计数在绘制态按可见出现次数（绘制上限 2000 个 Range），HTML 沙箱预览与不支持该 API 的宿主行为不变。

- 唯一入口：右栏 page-type tab（kind 级 extension 压 builtin 接管官方 `files` 类型，guide 页单张「文件列表」卡片，官方「工作区文件」卡片卸载即恢复）；minHost `0.1.5-rc.1`
- 默认根目录 = 本会话工作区（与官方文件树同一数据源：会话行 `cwd` 响应式读取，晚到补入）；手动切换目录按会话记忆（localStorage `dsh-local-files-root:<sessionId>`），重开/重载恢复；工具行「退回原始工作区」一键回根（已在工作区时隐藏，自绘文件夹回退图标）
- 「打开目录 / 在 IDE 打开」走官方 open-in-app 路由（`GET /open-in-app/apps` 探测 + `POST /open-in-app/open`，仅目录；探测失败静默隐藏）
- 2026-09-10 退役：`conversation.view` 会话 tab（入口收敛到右栏；随之移除 ui-conversation 依赖与 composer-overlay 底部留白）
