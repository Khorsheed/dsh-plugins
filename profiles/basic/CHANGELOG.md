# 变更记录

## 2026-09-28 —— local-files 加入，成员 14 个

- 新成员：local-files（右栏本地文件浏览器：懒加载文件树 + 结构化预览，接管官方「文件」页签）——成员数 13 → 14；它没有 0.1.2 线版本，「不支持」清单随之点名
- README 刷新：file-preview 换新版五张截图；context-guard / inline-html-render 换带标注的新图；ui-shortcuts 注明 0.1.7-rc.2 起官方自带快捷键设置；成员区间修正（file-preview `^0.4.0`、ankh-guard `^0.4.0`）

## 2026-09-27 —— 产物预览合并为单包

- `file-preview` 与 `ui-file-preview` 合并为单个 `@khorsheed/dsh-file-preview`（0.4.0）：产物预览只需装一个包，成员数 14 → 13；旧宿主线的成对安装说明保留
- 已装用户：`@khorsheed/dsh-client-ui-file-preview` 可移除（npm 旧名已 deprecate，指向新包）

## 2026-09-27 —— 元包展示与兼容表格化

- 功能展示末尾新增「打包装：bundle-conversation-toolbox」一节（含详情页截图）：七件会话工具一次装齐，组件行仍可单独禁用
- 每个成员的兼容信息改为「宿主版本 × 安装规格」小表格，完整规格直接可复制
- 移除首屏总览图（一张图代表不了全部成员）

## 2026-09-27 —— quote 加入，成员 14 个

- 新成员：quote（选中任意文本浮出引用动作菜单）——成员数 13 → 14
- README 重排：正文聚焦「目标 → 插件列表（含可复制包名与版本兼容）→ 功能展示」，安装指南整体折叠到文末；单包安装推荐官方「添加插件」对话框，打包装可用元包 `@khorsheed/dsh-bundle-conversation-toolbox`

## 2026-09-27 —— 更名为 dsh-basic

- 整合包仓与 profile 名从 dsh-web-basic / web-basic 改为 **dsh-basic / basic**：clone 地址、脚本名（`restart-into-basic.sh`）、profile 目录（`$DSH_HOME/profiles/basic`）随之变化；GitHub 上的旧名字保留重定向
- 插件包名（`@khorsheed/dsh-*`）不变，已安装的成员不受影响

## 2026-09-27 —— 新增三名成员，成员区间对齐最新发布线

- 新成员：capability-catalog（能力目录）、inline-html-render（内联 HTML 卡片）、mobile（移动端呈现）——成员数 10 → 13
- 五个成员的依赖区间从 `^0.2.0` 升到最新线（ankh-guard / message-tools / file-preview / ui-file-preview / taskpilot → `^0.3.2`）：整合包整体安装与单包安装拿到同一代成员
- 整合包宿主地板抬到 `0.1.5-rc.1`：capability-catalog 与 mobile 没有更老的线。`0.1.2` 线宿主请停留在本次更新前的档案（`host-0.1.2-line` tag 随下一发布波提供），`0.1.x` 宿主继续用 `host-0.1.1-line`

## 2026-09-27 —— 十个成员随宿主 0.1.7-rc.2 基线重发

- 成员版本：ankh-guard 0.3.2、message-tools 0.3.2、taskpilot 0.3.2、context-guard 0.2.3、file-preview 0.3.2、ui-file-preview 0.3.2、message-timeline 0.2.3、session-title-edit 0.2.3、ui-shortcuts 0.2.3、whalesong 0.2.3。普通用户无需任何操作，随整合包更新即可
- 看得见的变化：后台任务胶囊不再把前台跑的命令闪一下又收走（只列模型真正发起的后台作业）；快捷键插件在 0.1.7-rc.2 宿主上并入官方快捷键系统——插队发送 / 压缩上下文两条命令进官方目录，改键在官方「快捷键」面板里做（rc.2 起官方协议不支持鼠标键绑定；0.1.5 ~ rc.1 宿主上的完整自有实现不受影响）
- 其余成员无功能变化，只是跟着新宿主基线重新验证了一遍（全量构建+测试双绿）

## 2026-09-10 —— 成员 0.2.0：适配宿主 0.1.2（先升宿主，再升插件）

- 10 个成员插件集体升到 0.2.0，适配宿主 0.1.2 线。这是一次不兼容升级：**请先把宿主升到 `0.1.2-rc.1` 或更新，再装 0.2.0 成员**；还在 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的宿主请继续用 0.1.x 成员（ankh-guard / file-preview 末版 0.1.1，其余末版 0.1.0），不要升级
- 「产物」预览里的「打开目录 / 在 IDE 打开」按钮在 0.1.2 宿主上暂时隐藏（宿主把这项能力改成了按需探测，恢复跟进中）；其余功能不变，另有一处提示音来源调整（阻塞提示改由官方会话服务驱动），听感不变

## 2026-08-24 —— 安装体验优化（人类/Agent 双指南）

- **人类/Agent 双安装指南**：有 agent 的用户一句话完成安装（"帮我装一下这个：<repo>")；无 agent 三条命令手动装。新增「给 Agent 的安装指南」：安装 → 离线自检 → 同端口交接 → 交付话术，安装成本从 ~17M token 降到 ~2M
- **同端口交接脚本** `scripts/restart-into-web-basic.sh`：走整合包自带 ankh-guard 的守卫通道（凭证 → restart 一次成型 → canary)，agent 在宿主内也能安全完成"停旧启新"；交接后实例即被 watchdog 监督，起不来自动回滚
- **依赖地板抬升**:ankh-guard / file-preview 最低 `^0.1.1`——整合包永远带上 skill 调用修复（0.1.0 的 skill 目录可见但调用即炸）
- 交付提示：交接后需硬刷页面（Cmd/Ctrl+Shift+R）加载新的 client bundle（产物 tab、任务胶囊等）

## 2026-08-22 —— 首个公开版本

dsh-web-basic 首个版本，包含 10 个成员插件：message-tools（消息编辑/撤回/恢复）、message-timeline（历史时间轴）、session-title-edit（标题内联编辑）、file-preview 对（产物预览）、taskpilot（后台任务胶囊）、context-guard（压缩提醒）、ui-shortcuts（自定义快捷键）、whalesong（状态氛围）、ankh-guard（运维守护）。

每个成员可单独卸载/加装，见 README「按你的方式调整」。
