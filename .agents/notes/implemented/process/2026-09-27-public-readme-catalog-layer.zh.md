# Agent Note: 公开 README 分层为「只列已发布」的目录——主仓画能力地图,整合包做展示,数字交给生成文档

Status: implemented

## Problem

在公开 dsh-plugins、dsh-basic、dsh-dev 之前,三份 README 的陈述已经从自己脚下漂走了:

- **根 README 是安装手册,不是地图。** 开头还写着「32 个包、25 个自挂载」,而机器生成的 `docs/packages.md` 早已是 43 / 34;它宣布 local-agent「待发布」,而这个家族在 npm 上以 0.1.0-rc.7 上架已有数周;约 20 个包(quote、dsh-reader、mobile、capture、typesafe、capability-catalog、room、worktrees、两个家族元包……)从未出现。它那七节深潜长文与各包 README 重复,也正是全文件腐烂最快的部分。
- **dsh-dev 的 README 描述的是一个已不存在的整合包**:「21 个成员、13 个未上架 npm」对着真实的 23 个依赖、且全部已发布;四个截图占位符从文件写下那天起一直 pending。
- **dsh-basic 的 README 结构本来是对的**(定位 → 安装 → 成员表 → 逐插件截图展示),但缺一张首屏图,也没有指向兄弟整合包的入口。

所有者当面敲定了公开形态:dsh-plugins 读作系统化的能力 + preset 设计总览(PerryLink 主页的目录式风格);两个整合包仓读作「整合包提供什么能力、包含哪些插件、附截图」;只列已发布的包;不做量化徽章;dev 缺的截图用现有素材拼。

## Decision

**根 README 是目录,它的每一句要么是表格行,要么是链接。** 结构:定位段 → 三整合包对比表(把读者导去整合包的枢纽)→ 能力地图(33 个已发布包分十个类目表,每行链接包目录、一句「你得到什么」、随哪个整合包)→ agent preset 设计(三条规则:按会话授予的工具行、随授权自隐的 UI、纯增量声明——外加 dev / dsh-eval / dsh-writing 三张 preset 卡)→ 兼容性承诺 → 模型影响总表 → 精简的安装/卸载 → 开发。七节深潜长文是删除而非搬迁:每个包本来就有同等深度的双语 README(message-tools 86 行、ankh-guard 223 行、local-agent 187 行……),必须留下的聚合性陈述(模型影响总表、卸载通用规则、ankh-guard 重复行警告)原位保留。

**仓库能再生的数字,README 绝不手写。** 包总数、发布状态、宿主兼容矩阵一律指向 `docs/packages.md` 与 `docs/release-status.md`(机器生成且有门禁校验),不再复述会漂移的数字。唯一的刻意例外是整合包对比表里的成员数(10 / 23 / 26)——整合包 README 自身也带着它。

**未发布的在途工作在公开面不可见。** canvas、sidechat、datasets/eval/mission/lab、`@khorsheed/dsh-presets` 不出现在能力地图里。preset 一节按今天的真实交付方式描述三个 preset——由整合包 `install.sh` 安装的目录式 preset——`packages/presets` 只作为尚未上架的 0.1.7 线机制被点名,绝不附安装命令。

**整合包 README 是展示层。** basic 只加了首屏图(`file-preview1.png`,原本就有跟踪)和相关整合包表,其余不动。dev 围绕修正后的成员清单重写(23 个包分四层:9 个基础体验 + ankh-guard + 3 个体验增强 + 10 个开发能力),四个截图占位符用现有素材池填满:`dev-overview.png` ← room-1、`local-agent-delegation.png` ← 08-local-agent、`local-agent-member.png` ← local-agent-member、`worktrees-drawer.png` ← worktrees-tab、`room-members.png` ← room-2。按[截图托管 note](2026-09-27-readme-screenshot-hosting.md),图片以 `git add -f` 跟踪在 `profiles/dev/docs/screenshots/` 下,镜像同步才会把它们带进 dsh-dev;它们是 basic 素材池的字节副本,素材池仍是包 README 嵌入图的规范宿主。

**安装指引跟随宿主 0.1.7-rc.2 的「添加插件」对话框,并明说它的边界。** 已对 harness 检出的 `packages/boot/plugin-manager` 核实:对话框与 `dsh plugin add` 共享同一 pnpm 后端;git URL 只装仓库根的包(没有 monorepo 子路径语法,没有 workspace 探测),根不是 `dsh.bundle` 插件的仓库——本 monorepo、整合包的 profile 模板仓——会被 `not-bundle` 拒绝并回滚;也不存在任何安装整个 profile 整合包的官方入口。因此 README 让整合包继续走 clone + `install.sh`(并显式注明「对话框装不了本仓」),单包安装与成员装卸则在宿主 ≥ 0.1.7-rc.2 时指向 **设置 → 插件 → 添加插件** 填包名的免命令行路径。

**basic 的正文以「复制包名单装」为主导,整包安装折叠到最后。** 所有者从真实用法出发的决定:多数安装是用户挑中某个插件、把包名贴进宿主对话框,所以正文三段式——为什么有这个整合包(日常高频体验插件;自用同时开放;明确以「被官方逐个原生替代」为终态)、带可复制包名的成员表 + 一张宿主线 → 发布线的兼容表(五个成员的 0.3.x 最新线要求宿主 ≥ 0.1.5-rc.1,0.1.2 线宿主装 `@^0.2.0`,0.1.x 装 `@^0.1.0`)、逐插件功能展示(每节给包名与兼容行,不再附安装命令)。全部安装机械细节——选线、整合包脚本、同端口交接、单包 CLI——收进文末一个折叠的「给 Agent 的安装指南」,agent 与手动用户共用。

**basic 扩到 13 个成员,依赖区间对齐到 README 承诺的线。** capability-catalog、inline-html-render、mobile 与稍后的 quote 加入;由于 capability-catalog 与 mobile 根本没有 0.1.5 之前的线,整合包地板随之抬到宿主 0.1.5-rc.1——这也同时把落后区间的矛盾推向唯一自洽的方向解决:五个先前钉 `^0.2.0` 而最新线已到 0.3.x 的成员改钉 `^0.3.2`(整合包自己 2026-09-27 的 changelog 本来就把这些版本说成「随整合包更新即可获得」)。0.1.2 线宿主留在本次更新前的档案(`host-0.1.2-line` tag 随下一发布波补打),0.1.x 宿主继续用 `host-0.1.1-line`。同一轮里整合包更名为 **dsh-basic**(profile `basic`),逐插件兼容行折叠成「宿主版本 × 安装规格」两列表;web-dev 更名为 **dsh-dev**(profile `dev`),并加入 quote 与 mobile 与 basic 对齐。

**同日,四散的预览/工具面合并成三个包。** ui-file-preview 并入 file-preview 0.4.0(host+client 单包,行 id 统一为 `file-preview`;退役行 id `ui-file-preview` 写进了包 changelog);worktrees-tool 并入 worktrees 0.3.0 成为 `./tool` 子路径行——canvas 的 `./agent` 模式——preset 行 id `worktrees-tool` 不变,会话状态不受影响;ui-content-preview 变成 private 源码面库(它从来不是运行时插件)。npm 发布名从 33 收缩到 30;三个退役名字的 `npm deprecate` 是所有者发布波里的动作。[worktrees-tool 拆分 note](../../feature/2026-09-11-worktrees-tool-split.md)保留,作为「工具行按会话授予」这一性质的决策记录——合并保住了这个性质,只是包边界挪了位置。

## Alternatives considered

**在根 README 保留深潜长文。** 否决:它们与各包 README 是同一内容的两处屋檐,而文件的腐烂(32 对 43 的包数、待发布对已上架的家族)恰恰集中在转述别处事实的散文里。目录形态让每行只有一个可写事实。

**把孵化中的包单列一节标注出现。** 所有者选择不出现:公开 README 只列今天 `dsh plugin add` 装得到的东西,清单随每个发布波刷新。preset 设计仍独占一节,因为 preset 随整合包交付,而不是以那个未上架的 bundle 交付。

**为 dev 专门截一轮新图。** 所有者决定暂缓:basic 素材池里已有 dev 每个招牌能力的准确截图(room、worktrees、local-agent 设置卡片、成员通道),占位符直接用副本填。今后随时可以专门重截替换——文件名是稳定的。

**量化徽章(npm 下载量、star 数)。** 所有者否决:需要维护的数字换不来任何目录行没有说出的东西。

**把每个整合包做成元包,好让 0.1.7-rc.2 的「添加插件」对话框能装。** 所有者否决:元包形态下成员变成 bundle 的传递 npm 依赖,单个成员的卸载就此丢失——`dsh plugin remove` 与插件管理页只操作 profile 的直接依赖,成员行最多能禁用、永远不能卸载。而逐成员可卸正是整合包的核心承诺(「整合包是起点,不是绑定」),对话框的单包形态交付不了它。整合包因此保持 profile 形态、走脚本安装;宿主上游日后若长出 profile 类型的安装入口,整合包即改用之,README 再补一键安装路径。

## Consequences

- 根 README 的事实面收敛为:一句计数(43/33,转述自生成文档)、成员数对比表、行内容为包目录链接的类目表。其余一切可再生的内容都是链接。
- `profiles/dev/docs/screenshots/` 新建并跟踪五张图;下一次 `sync-mirror profile dev` 会带过去。basic 素材池原样不动,仍是 npm 嵌入图的宿主。
- 两份整合包 README 的配对记录已重录(`verify-translation-pairing --write`);根 README 这一对按设计没有 sidecar(配对 glob 只覆盖 `packages/`、`profiles/`、`.agents/`、`docs/`)。
- ~~**本次改动之外的已知后续:**~~ **同日已解决**:两个整合包的依赖区间都已对齐到成员最新发布线(具体钉法次日又随合并波次移动过——file-preview `^0.4.0`、worktrees `^0.3.0`、ankh-guard `^0.4.0`——现在由 `check:profiles` 规则 7 机械看守,本文不再枚举)。dev 的 README 也已改成与 basic 相同的列表优先形态(可复制包名的插件列表 → 带元包详情页截图的功能展示 → preset → 折叠后置的安装指南),家族安装路径写明 `@khorsheed/dsh-bundle-local-agent`——已对官方 `dsh-experimental-agent-team-profile` 核实过同一薄元包形态(bundle 依赖把成员传递带入;每个组件行仍可单独禁用)。

- **3080 事故,当夜闭环**:dev preset 的崩坏来自合并边界的版本错位——preset 行指向一个解析不了的模块时,行连 fiber 都拿不到(会话 resume 时报 `never started`,见宿主 agent-preset-registry 的 `auditRows`);boot preflight 看不到它,因为 preset 是按会话组合的,行级崩坏会拖垮整个 preset 而不只是该行。从 prod 退役一个包需要流程不会替你做的三步:`dsh plugin remove`(清依赖与 bundles 名册)、删掉 profile `pnpm-workspace.yaml` 里的孤儿 overrides、同步目录式 preset——然后一次前滚部署(worktrees 0.3.0 + file-preview 0.4.0 + 新打的 presets,canary PASS)。一个搭进去一轮的小教训:BSD sed 没有 `\|` 交替——静默空操作的清理比不清理更糟。

- **事故的流程性收尾(2026-09-28),四层闸**:① ankh-guard 0.4.0 的 preflight 新增——回读干跑 boot 里 preset 注册表的 `broken` 诊断,任何坏 preset 直接 FAIL(preset 行挂在 standing scope 上,boot 干净从不等于 preset 可用,现在闸门知道了);② `scripts/retired-packages.ts` 成为唯一退役登记处,`check:profiles` 三条新规则在仓内组合上强制它——5b:子路径行要求基础包导出该条目(事故的精确签名)、6:退役名不得再进入任何组合、7:caret 区间必须容纳工作区版本(一上线就抓到合并波次留下的五处 pack 区间错位);③ deploy-3080 在开工前扫描生产 profile,发现退役名残留就打印清理配方,并按阶段打印耗时;④ docs/ops.md 补上「卡在中途」处置手册——含调用方预算纪律(后台任务默认 600s 超时会把它杀在全新安装中途,profile 半写;修复 = 原命令重跑)与 preset 错位的两条处置路径(前滚部署包,或把 preset 正本回滚)。首次重新部署又拦出第五个潜伏缺陷:scoped `GEN_TYPERT_ONLY` 生成把未选中 sibling 解析到未注册的 lib/types,选中包的 face 触及 sibling 的合并声明(room → local-agent 的 SessionEventMap 增强)即报「declaration outside this face」——scoped 批次现在沿声明的依赖/peer 边自动扩展,输出与全量生成逐字节一致。随后 room 0.2.0 + presets 0.1.1 + ankh-guard 0.4.0 经 reconfigure 路径干净上线(双份 preflight 含新审计,canary PASS),退役的 room-tool 已从生产 profile 三清。
- **根 README 同日再构(2026-09-28)**:整合包节改为四模式表(basic/dev/eval/writing,各配模式定位与 GitHub 列——eval/writing 标「打磨中待上线」,basic/dev 配两张带标注的模式全景图 `docs/screenshots/{basic,dev}-mode.png`);能力地图节序调整为对话控制→文件与产物→任务与氛围→体验与效率→开发协作→本地多 Agent,两个元包从独立「一键元包」节移进对应家族节后(conversation-toolbox 跟任务与氛围、local-agent 跟本地多 Agent);本地多 Agent 补「与官方版本的差异」段(主 Agent 可邀请自定义任意 Harness 并按体感分工);ui-shortcuts 标注官方 0.1.7-rc.2 内置快捷键后预计逐步退役;typesafe 对标注实验性(接入 TypeSafe System One 旗舰 Jev);兼容性承诺收敛为两档表(0.1.7-rc.1~rc.2 / 0.1.5-rc.1 起);安装/卸载/开发合并折叠为文末「给 Agent 的安装及开发指南」(`<a id="install-dev-guide">` 锚点供正文引用)。

## Testing

纯文档改动:暂存集上 `pnpm check:hygiene` 通过;两份整合包配对的 `verify-translation-pairing` 已重录并全绿;三份 README 引用的每张图都在对应 profile 的 `docs/screenshots/` 下有跟踪文件。
