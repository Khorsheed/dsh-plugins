# Agent Note: 成员 UX 全链路的官方风格模型选择

Status: implemented

[English](2026-09-13-composer-model-polish.md) | 中文

## Problem

成员模型面落地后的后续缺口：设置卡的模型字段看起来像个纯文本框（没有下拉指示，占位文案也从不说明 CLI 默认到底是哪个）；codex 与 claude 的下拉在 prod 上是空的（作用域配置不命名任何模型——codex 连发现源都没有）；成员作曲器的 chip 在左下角，是个看不出可选择的有边框 pill；room 作曲器没有 room 主 agent 的模型选择（它的接管隐藏了官方作曲器栏，而官方 `conversation.input.model` 座位是单宿主的，无法重挂——已对 slots 运行时实证：声明独占、renderSlot 按 entry 授权）；room 成员卡与编辑对话框完全没有模型，用户不知道派出去的成员跑的是哪个模型。

## Decision

**设置卡（四个 provider）。**字段现在是 select 形态：常驻 chevron 打开一个测量翻转的选择菜单（选中填入草稿，保存才持久化；自由输入与 datalist 保留）；无候选时不渲染任何指示，保持纯输入（claude 全新安装的情形）。占位文案直接命名生效默认（`留空 = 跟随 CLI 配置：<model>` / dsh 为宿主默认），留空不再是个谜。

**codex 目录发现。**惰性一次性探测：对作用域 home 起 `codex app-server --stdio`（刻意不带 live 驱动的按成员 `-c` 覆盖——bridge token 无意义，模型绑定反而可能收窄答案），`initialize` → `model/list`，过滤 hidden 项，5 秒封顶，任何失败降级为 `[]`。按 home 缓存 5 分钟 TTL（失败也缓存），并发读取共享同一个在飞探测，`modelInfo` 同步读缓存、后台补探测——冷 CLI 启动绝不阻塞设置读取；设置卡每次打开重新拉取。claude 没有诚实的本地枚举面（CLI 没有 models 面，其选择器是网络动态发现）——保持自由输入 + 最近使用记忆，不造假目录。

**作曲器。**成员 chip 移到发送钮旁，样式对齐官方 ModelSelect 触发器（无边框 28px、13/20 w500、旋转 chevron）。room 作曲器在它的发送钮旁新增主 agent 模型选择器，建在公开的 `ctx.modelDirectories` 服务上——与官方座位同一个按会话目录，`select()` 写的就是官方作曲器写的那份耐久会话选择；官方两级菜单（模型/effort）直接移植（目录面暴露了 efforts）；服务缺席则不渲染。@成员 消息按设计不受影响（成员有自己的按成员通道）。

**room 成员。**成员卡在 provider 行后追加生效模型（`memberModel(childSessionId)`；`RoomMember.childSessionId` 在首次派发时入日志——从未派发的成员不显示），主 agent 卡显示目录选择；编辑对话框的模型字段从 broker 表面预填，保存时先写 broker（`setMemberModel` 拒绝则对话框保持打开并显示错误），再把值记入成员记录（null 清除），使从未启动的成员在首次派发时绑定它。

## Alternatives considered

**在 RoomComposer 里重挂官方 `conversation.input.model` 座位。**架构上不可能：slot 声明单宿主，`renderSlot` 按 entry 授权（ui-slots 注册表对第二声明者直接抛错）。上游路径（把作曲器栏的 renderSlot 传给链接管者，或导出 ModelSelect）仍然开放，哪天重复维护真的痛了可以走。

**把设置字段预填 CLI 默认作为真实值。**否决：留空是刻意的语义（跟随 CLI 自己的默认）；写入真值会钉死它并掩盖上游默认的变化。占位文案命名默认足以消除困惑且不改行为。

**刮取 claude 二进制内嵌的模型常量。**否决：打包 JS 里那张内部身份校验表不是受支持的面——那是换了层皮的内置目录。

## Consequences

家族里每个带模型的表面现在都用同一种视觉语言展示和切换模型。代价：RoomModelPicker 复制了官方 ModelSelect 的 UI（有界——两者坐在同一个目录服务上，语义不会漂移）；codex 探测每 5 分钟窗口最多一次短生命周期 app-server 进程；room 编辑对话框里 `setMemberModel` RPC 失败时降级为仅记日志持久化（已记录）。测试：四个设置卡合计 +24，codex +9（目录 8、broker 1），成员作曲器 +1，room +14（作曲器选择器 6、成员卡/编辑 8、服务 1）。
