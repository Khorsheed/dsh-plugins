# Agent Note: 邀请对话框的模型列表跟随 harness 的「可用模型」短名单

Status: implemented

## Problem

房间的邀请成员对话框显示端点全量可服务目录（端点列出的所有模型），而成员配置对话框显示「可用模型」短名单（models.json)。同一处选择在两个面上不一致；用户把短名单理解为可用集合，邀请列表无视它读起来就是个 bug。

成员对话框的范围化在各 provider 的 broker(`scopeServedDirectory` 的成员分支）。邀请选择器的目录是 broker 的无成员调用——它与设置卡的添加模型对话框共享，后者需要全量目录来构建短名单，所以无成员面不能直接改。

## Decision

选择器的目录 face 把可服务目录按短名单范围化（`scopeDirectoryToList`,`client/model-directory-scope.ts`)，在 face 的 read/follow 里应用（`client/index.ts`)：短名单顺序在前；名单里端点已不再供应的值保留为裸行（成员对话框的同一约定）；无短名单（或空名单）维持可服务目录原样。选择器组件本身不动——face 是它唯一的数据源，而 `renderHarnessModelPicker` 的唯一消费方就是房间的邀请对话框。

设置卡的添加模型对话框保持全量目录（它走另一个 face 读无成员目录）——先在全量里挑出短名单，之后处处跟随短名单。

## Alternatives considered

- **host 侧范围化**(`modelDirectory` Remote 加 surface 参数，各 provider 的 broker 执行）。成员对话框本就在 broker 里做，架构上更一致——但要动 gateway 契约加每个 provider 的 broker，而这个转换用两个已暴露的 Remote(`modelDirectory` + `modelList`）在客户端就能完成。face 层范围化是十五行、零契约变更。
- **在选择器组件内做。** 体量相同，但该文件正在被在途分支（room-members-extension 栈）重写（加 effort)——做在 face 层把那条分支的合并面压到最小：只有 face 的 read/follow 动了。

## Consequences

- 邀请外部成员时看到的就是短名单（首项成为对话框默认值，与卡片一致）；没有短名单时行为照旧。
- 短名单里端点停止供应的值仍可被邀请（裸行）——刻意的（成员对话框同样显示）；用它邀请的成员会在启动时被端点自己的报错拦下。
- 给在途 effort 工作（room-members-extension 栈）的合并说明：短名单范围化在 face 构建处（`client/index.ts`）与新文件 `model-directory-scope.ts`；他们的选择器 effort 参数与本次改动无交叠。

## Testing

`pnpm --filter @khorsheed/dsh-local-agent test`(38 个文件，400 个测试），含新增 `tests/model-directory-scope.spec.ts`：覆盖名单序、resolvedModel 别名匹配、未供应值的裸行、null/空名单直通。
