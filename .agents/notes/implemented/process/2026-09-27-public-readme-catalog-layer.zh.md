# Agent Note: 公开 README 分层为「只列已发布」的目录——主仓画能力地图,整合包做展示,数字交给生成文档

Status: implemented

## Problem

在公开 dsh-plugins、dsh-web-basic、dsh-web-dev 之前,三份 README 的陈述已经从自己脚下漂走了:

- **根 README 是安装手册,不是地图。** 开头还写着「32 个包、25 个自挂载」,而机器生成的 `docs/packages.md` 早已是 43 / 34;它宣布 local-agent「待发布」,而这个家族在 npm 上以 0.1.0-rc.7 上架已有数周;约 20 个包(quote、dsh-reader、mobile、capture、typesafe、capability-catalog、room、worktrees、两个家族元包……)从未出现。它那七节深潜长文与各包 README 重复,也正是全文件腐烂最快的部分。
- **dsh-web-dev 的 README 描述的是一个已不存在的整合包**:「21 个成员、13 个未上架 npm」对着真实的 23 个依赖、且全部已发布;四个截图占位符从文件写下那天起一直 pending。
- **dsh-web-basic 的 README 结构本来是对的**(定位 → 安装 → 成员表 → 逐插件截图展示),但缺一张首屏图,也没有指向兄弟整合包的入口。

所有者当面敲定了公开形态:dsh-plugins 读作系统化的能力 + preset 设计总览(PerryLink 主页的目录式风格);两个整合包仓读作「整合包提供什么能力、包含哪些插件、附截图」;只列已发布的包;不做量化徽章;web-dev 缺的截图用现有素材拼。

## Decision

**根 README 是目录,它的每一句要么是表格行,要么是链接。** 结构:定位段 → 三整合包对比表(把读者导去整合包的枢纽)→ 能力地图(33 个已发布包分十个类目表,每行链接包目录、一句「你得到什么」、随哪个整合包)→ agent preset 设计(三条规则:按会话授予的工具行、随授权自隐的 UI、纯增量声明——外加 dev / dsh-eval / dsh-writing 三张 preset 卡)→ 兼容性承诺 → 模型影响总表 → 精简的安装/卸载 → 开发。七节深潜长文是删除而非搬迁:每个包本来就有同等深度的双语 README(message-tools 86 行、ankh-guard 223 行、local-agent 187 行……),必须留下的聚合性陈述(模型影响总表、卸载通用规则、ankh-guard 重复行警告)原位保留。

**仓库能再生的数字,README 绝不手写。** 包总数、发布状态、宿主兼容矩阵一律指向 `docs/packages.md` 与 `docs/release-status.md`(机器生成且有门禁校验),不再复述会漂移的数字。唯一的刻意例外是整合包对比表里的成员数(10 / 23 / 26)——整合包 README 自身也带着它。

**未发布的在途工作在公开面不可见。** canvas、sidechat、datasets/eval/mission/lab、`@khorsheed/dsh-presets` 不出现在能力地图里。preset 一节按今天的真实交付方式描述三个 preset——由整合包 `install.sh` 安装的目录式 preset——`packages/presets` 只作为尚未上架的 0.1.7 线机制被点名,绝不附安装命令。

**整合包 README 是展示层。** web-basic 只加了首屏图(`file-preview1.png`,原本就有跟踪)和相关整合包表,其余不动。web-dev 围绕修正后的成员清单重写(23 个包分四层:9 个基础体验 + ankh-guard + 3 个体验增强 + 10 个开发能力),四个截图占位符用现有素材池填满:`web-dev-overview.png` ← room-1、`local-agent-delegation.png` ← 08-local-agent、`local-agent-member.png` ← local-agent-member、`worktrees-drawer.png` ← worktrees-tab、`room-members.png` ← room-2。按[截图托管 note](2026-09-27-readme-screenshot-hosting.md),图片以 `git add -f` 跟踪在 `profiles/web-dev/docs/screenshots/` 下,镜像同步才会把它们带进 dsh-web-dev;它们是 web-basic 素材池的字节副本,素材池仍是包 README 嵌入图的规范宿主。

**安装指引跟随宿主 0.1.7-rc.2 的「添加插件」对话框,并明说它的边界。** 已对 harness 检出的 `packages/boot/plugin-manager` 核实:对话框与 `dsh plugin add` 共享同一 pnpm 后端;git URL 只装仓库根的包(没有 monorepo 子路径语法,没有 workspace 探测),根不是 `dsh.bundle` 插件的仓库——本 monorepo、整合包的 profile 模板仓——会被 `not-bundle` 拒绝并回滚;也不存在任何安装整个 profile 整合包的官方入口。因此 README 让整合包继续走 clone + `install.sh`(并显式注明「对话框装不了本仓」),单包安装与成员装卸则在宿主 ≥ 0.1.7-rc.2 时指向 **设置 → 插件 → 添加插件** 填包名的免命令行路径。

## Alternatives considered

**在根 README 保留深潜长文。** 否决:它们与各包 README 是同一内容的两处屋檐,而文件的腐烂(32 对 43 的包数、待发布对已上架的家族)恰恰集中在转述别处事实的散文里。目录形态让每行只有一个可写事实。

**把孵化中的包单列一节标注出现。** 所有者选择不出现:公开 README 只列今天 `dsh plugin add` 装得到的东西,清单随每个发布波刷新。preset 设计仍独占一节,因为 preset 随整合包交付,而不是以那个未上架的 bundle 交付。

**为 web-dev 专门截一轮新图。** 所有者决定暂缓:web-basic 素材池里已有 web-dev 每个招牌能力的准确截图(room、worktrees、local-agent 设置卡片、成员通道),占位符直接用副本填。今后随时可以专门重截替换——文件名是稳定的。

**量化徽章(npm 下载量、star 数)。** 所有者否决:需要维护的数字换不来任何目录行没有说出的东西。

**把每个整合包做成元包,好让 0.1.7-rc.2 的「添加插件」对话框能装。** 所有者否决:元包形态下成员变成 bundle 的传递 npm 依赖,单个成员的卸载就此丢失——`dsh plugin remove` 与插件管理页只操作 profile 的直接依赖,成员行最多能禁用、永远不能卸载。而逐成员可卸正是整合包的核心承诺(「整合包是起点,不是绑定」),对话框的单包形态交付不了它。整合包因此保持 profile 形态、走脚本安装;宿主上游日后若长出 profile 类型的安装入口,整合包即改用之,README 再补一键安装路径。

## Consequences

- 根 README 的事实面收敛为:一句计数(43/33,转述自生成文档)、成员数对比表、行内容为包目录链接的类目表。其余一切可再生的内容都是链接。
- `profiles/web-dev/docs/screenshots/` 新建并跟踪五张图;下一次 `sync-mirror profile web-dev` 会带过去。web-basic 素材池原样不动,仍是 npm 嵌入图的宿主。
- 两份整合包 README 的配对记录已重录(`verify-translation-pairing --write`);根 README 这一对按设计没有 sidecar(配对 glob 只覆盖 `packages/`、`profiles/`、`.agents/`、`docs/`)。
- **本次改动之外的已知后续:** 整合包的依赖区间落后于当前发布线——web-basic 钉 `^0.2.0` 而成员已发到 0.3.x;web-dev 钉 `^0.1.x`,而 local-agent 家族在 npm 上只有 `0.1.0-rc.7` 预发布,裸 `^0.1.0` 并不容纳它。在宣布 dsh-web-dev 可装之前,区间(或家族发布线)需要一轮刷新;README 现在陈述的是 npm 已发布状态,让这句陈述端到端成立是发版工作,不是文案。

## Testing

纯文档改动:暂存集上 `pnpm check:hygiene` 通过;两份整合包配对的 `verify-translation-pairing` 已重录并全绿;三份 README 引用的每张图都在对应 profile 的 `docs/screenshots/` 下有跟踪文件。
