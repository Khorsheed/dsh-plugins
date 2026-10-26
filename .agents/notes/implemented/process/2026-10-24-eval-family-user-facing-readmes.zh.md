# Agent Note: 评测家族的 README 面向用户，设计参考移到 docs/

Status: implemented

## Problem

`@khorsheed/dsh-eval`（约 635 行）、`@khorsheed/dsh-datasets`（约 258 行）、`@khorsheed/dsh-lab`（约 194 行）的 README 长成了内部设计文档：标题带任务编号（`I3·T20`、`T73`、`I5·T35a`……），eval 的 H1 是裸的 `dsh-eval`，开头都是一段密集的机制说明。三个包以 0.2.0 首次上 npm，README 就是包页面，第一次来的读者看到的是设计日志，而不是「这是什么、怎么装」。

## Decision

每份 README 按已发布 README 的统一写法（`packages/client-message-tools/README.md`）：H1 = npm 包名、语言切换行、一句话价值、一段场景（在一套题上对比本机 agent harness）、截图、特性 bullet、安装（先给 `dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite`，再给单独安装）、Compatibility、已知限制、折叠的实现原理（链到深度文档）、开发页脚。每种语言约 95 行。

深度内容原样移出（只去掉标题里的任务编号、调整链接层级），放进带各自 i18n sidecar 的双语对：

- `packages/eval/docs/reference(.en).md`——契约、run 循环、容器路径、就绪检查、provision、判定、实验对象、服务面、按实例挂载接缝、报告、模型工具、发起 run、CLI、哈希规则、兼容性的降级与缺席项全文，以及开发历程（原「状态」）；
- `packages/eval/docs/ui(.en).md`——实验室 tab 与各阶段页、作答视图、会话卡片、视觉与文案收口、全局面板；
- `packages/datasets/docs/reference(.en).md` 与 `packages/lab/docs/reference(.en).md`——各自 README 原来的全部正文。

兼容性事实不变。npm 线与源码线两条结论在每份 README 里逐字保留；lab 整节保留；eval 与 datasets 的降级项长清单移到参考文档，README 链过去，并照旧写明该清单与 `dsh.compat` 同步。任务编号只从标题里去掉，正文里作为引用保留。截图先用 dsh-basic 镜像 raw URL 下的占位（`eval-*.png`、`datasets-*.png`、`lab-*.png`），等人截好放进 `profiles/basic/docs/screenshots/`。

## Alternatives considered

**保留原 README，只在顶部加一段摘要。** 不选：npm 渲染整份文件，六百行的页面顶上加摘要仍然像内部日志；带编号的标题还留在 npm 页的目录里。

**把设计细节当过期历史删掉。** 不选：run 循环、provision、判定这几节是「不变量为什么成立」唯一的书面记录；放进 docs/ 双语对，README 一跳就到。

**docs 链接改用 GitHub 绝对 URL。** 本次不做：仓库里所有包 README 都用相对链接，而 `docs/` 不在包的 `files` 里，所以在 npm 上这些相对链接打不开。把统一写法改成镜像绝对 URL 是全仓库的决定，在此记为待定。

## Consequences

- npm 页的第一屏就回答了这个包做什么、怎么装；设计参考在 GitHub 上一跳可达。
- 在 npm 上，指向 `docs/`（以及 `../../docs/…`）的链接打不开，直到统一写法改为绝对 URL 或 `docs/` 随包发布。
- 源码注释里「见 README 的「工作区接入接缝」」（datasets `src/index.ts`）、「lab README «失败恢复循环»」（eval `src/run/unit-lifecycle.ts`）一类说法，现在指向的章节在各包的 `docs/reference.md` 里；本次不动源码，所以保持原样。
- 截图占位在文件截好并用 `git add -f` 提交之前显示为破图。
