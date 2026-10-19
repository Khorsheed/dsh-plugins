# Agent Note：图书馆——按领域划分模块（服务分层、一个工具一个文件、站页视图独立）

Status: implemented

## 问题

三个文件大到改一个领域就得通读其他领域：`src/service.ts`（约 2200 行，项目、资源、路线、拍照页、卡片、考卷、作答、绑定、事件和纯规则都在一个类里）、`src/tool-definition.ts`（约 1100 行，十个工具挤在一个闭包里）、`src/client/views/book.tsx`（约 1100 行，教材页、站页和整个章节考 tab）。下一步的考点掌握与学科配置接缝三处都要动，用户也预期以后学科会变多。

## 决定

机械拆分、不改行为，在任何功能改动之前单独提交：

- **服务分层。** `LibraryService` 仍是唯一的公共类（`src/service.ts` 重新导出它，所有导入路径不变），在 `src/service/` 里由一串逐层继承的类组成：`core`（存储、监听、销毁、`mutate`、事件、拒收）→ `shelf`（项目、资源、seq）→ `cards` → `roadmap`（草稿、采用、讲义、读完）→ `pages` → `assess`（考卷、作答）→ `bindings`（绑定、摘要、事件、统计）= `LibraryService`。每层可调用其下各层；跨层用到的成员从 `private` 改为 `protected`。纯规则（形状校验、解锁、证据闸）移到 `service/rules.ts`。
- **一个工具一个文件。** `src/tools/<名词>.ts` 导出接收共享 kit 的工厂函数；`src/tools/kit.ts` 放传输辅助函数、参数 schema 和 `createToolKit`（绑定默认值、项目 / 资源解析、自动绑定）。`src/tool-definition.ts` 只按工作流顺序组装十个工具，并保留 `LIBRARY_TOOL_NAMES`。
- **站页视图独立。** `views/book.tsx` 保留教材页（草稿卡、路线、不学的章节、考卷列表）；`views/station.tsx` 放站页及导读 / 我的记录 / 讲义 tab；`views/station-quiz.tsx` 放章节考与验收 tab。

## 考虑过的方案

- **按学科或按领域拆成多个 npm 包**：否决——随学科变化的部分很小（判题、划线类型、复习方式、教练提示片段、公式渲染），应放在包内的学科配置接缝后面；多拆包只会增加依赖、打包和部署规则，没有收益。将来需要独立界面的学科，可以由伴随插件向核心提供一份配置（仓库允许的伴随 → 核心单向依赖）。
- **用组合（服务委托给各领域对象）代替继承链**：这一步否决——那要重写每个方法体；继承链可以原样搬运方法体，正是不改行为的拆分所需要的。将来某层需要独立测试时仍可改成组合。

## 后果

- 调用方的导入路径不变（`./service.ts`；`./tool-definition.ts` 继续重新导出 `splitTocText` / `chaptersLocator`；`QuizRows` 仍从 `views/book.tsx` 导入）；`LibraryPane` 改从 `views/station.tsx` 导入 `NodeView`。
- `tsconfig.host.json` / `tsconfig.client.json` 的 `files` 是显式列表，已加入新文件。

## 测试

163/163 不变且全绿；host 与 client 类型检查无误；`check:panels` 无问题。侧栏 fixture 的今日页与章节考页在拆分前后截图逐像素一致。
