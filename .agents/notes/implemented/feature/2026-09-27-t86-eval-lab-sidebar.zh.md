# Agent Note：评测实验室的附属材料进宿主右侧栏（T86）

Status: implemented

## Problem

用户走查 T84 时觉得实验室 tab 太挤。每页都把附属材料折在页内：plan.json、作者备注、通过的校验、回执、记录的附件、有效性校验、导出来源、每个作答文件。夹在这些折叠中间，页面的主线很难看清。用户提了两点：主要信息留在实验室 tab；附属材料搬进侧栏，最好用宿主自带的右侧栏，维护成本更低。设计稿是 `profiles/web-eval/docs/t85-lab-sidebar.md`，§六 的待定项由协调者在 T86 文案里拍板。

## Decision

- **一个面板，两种容器。** `InspectPane`（`packages/eval/src/client/InspectPane.tsx`）画一个带类型的 `InspectTarget` 栈（`inspect-target.ts`），头部的返回、标题、来源行和关闭都由它画。页表可以扩展：各实验室页用 `registerInspectPage` 注册自己的页，面板不去 import 它们。同一个面板既可以画在宿主右栏里，也可以画在页内 Sheet 里。
- **默认用宿主右栏。**
  - 页型 tab `eval-inspect`（id `@khorsheed/dsh-eval:inspect`）在延迟的 `ctx.inject(['sidebarRight','sidebarRightTabs'])` 里注册，受实验室 tab 的 preset 判据控制。
  - body 走 `sidebar.right.pane.tab` 槽，页签标题跟随栈顶页。
  - 没有右栏，或 `openTab` 抛错时，`openInspect` 答 false，实验室改开页内 Sheet。
- **0.1.7 刷新靠自己的记忆。**
  - 0.1.7 按会话持久化右栏布局，但不存 tab 的参数。body 因此把 `{tabId, revision, applied, stack, recent}` 存进 `dsh-eval.inspect.<sessionId>`；刷新后宿主还原出一个没有参数的 tab 时，按记忆重画栈。
  - 多记 `applied`（上次应用的目标键）是因为刷新后宿主的 revision 从头计，同一个数字可能重复出现。
- **四页入口。** 各页把折叠换成「一句结论 +「查看」」：
  - 设计页：plan.json、作者备注、校验、回执；
  - 运行记录：单条记录的回执与附件；
  - 结果对比：有效性校验与导出来源；
  - 作答：每个被折叠的作答文件。

  人工评估页在队列头右端新增「题目材料」入口。
- **留在 tab 的内容。** 并排看作答、运行记录时间线、「怎么读这张表」都留在 tab。运行日志、效率明细、终审原始输出暂不迁，仍在原位折叠，等用户走查后再定。

## Alternatives considered

- **只用页内 Sheet。** 各宿主都能用，但用户点名要宿主右栏；Sheet 也不能拖宽、停靠或按会话保存。现在留作兜底。
- **硬依赖 `@deepseek-ai/dsh-client-ui-sidebar-right`。** 那样没有右栏包的 profile 连实验室都加载不了。现在改用结构化的 `TabInfoLike` 读宿主的 tab 信息，服务按可选方式 inject。
- **现在就向上游提参数持久化。** 用户定等评测线真正用上 0.1.7 再说。这段空缺由本地记忆补上，提案记在设计稿 §七 的后续项里。
- **右栏打开时收起左侧会话栏。** §六 否掉了，因为要动宿主布局。改由实验室 tab 走窄版。

## Consequences

- **提交。** 分支 `feat/t86-lab-sidebar` 上有 `0aeab97e`、`488cf894`、`756554b3`、`1f124a75`。eval 包在冻结基线上 69 个文件、1192 条测试全绿。
- **0.1.5 验收。** 在 3183 临时实例上截 1440 和 400 两档，14 个场景全过，只有 400 宽的「返回」场景例外：那个宽度下宿主把侧栏全屏盖在 tab 上，栈只能由侧栏内部的下钻叠起来。浏览器 console 没有错误。
- **0.1.7 验收卡在 T82。** 冻结的 0.1.7-rc.1 CLI 能起，但所有会话都挂着 pack 自带的 `eval` preset。0.1.7 报 `Unknown agent preset: eval`，实验列表加载失败。按文案要求停在这里，0.1.7 的截图和刷新恢复验收留到 T82 之后补。
- **两条宿主线都组不出没有右栏的 profile。** 在 0.1.5 上关掉 `ui-sidebar-right` 后，官方 `dsh-client-ui-chat` 和 file-preview、taskpilot、local-files 三个社区包都在等 `sidebarRight`，eval 不在等待名单里。0.1.7 的 ui-chat 同样依赖 `sidebarRight`。所以 Sheet 兜底只能由单测验证（`tests/apply.client.spec.ts`）。
- **可见性文档。** `docs/plugin-visibility.md` 补记了 0.1.7 注册表新增的字段（`multiple`、`keepMounted`），以及按会话持久化布局、但不存参数这一点。
