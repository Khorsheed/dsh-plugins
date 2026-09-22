# Agent Note: 从粘贴的 npx skills add 命令安装技能

Status: implemented

## 问题

新增技能弹窗的「命令」页接受一段仓库描述，而每个已发布的技能都会给用户一条可粘贴的命令：`npx skills add typesafe-ai/skills --skill typesafe-ai`。粘贴后报错 `fatal: unable to access 'https://github.com/typesafe-ai/skills --skill typesafe-ai/': URL rejected: Malformed input to a URL function`。

`repoSpecToClone` 只剥掉 `npx skills add ` 前缀和结尾的 `-g`，然后把任何以 `http` 开头的字符串原样当作克隆 URL 返回。参数因此留在 URL 里，`url.split('/').pop()` 又把同一段文本变成了目标目录名，于是 git 收到两个畸形参数。同一条路径上还有两处缺口：仓库含多个技能时，安装的是位置最浅的那个 `SKILL.md`，命令指定的技能被静默忽略；克隆直接落在受管技能根目录里，失败的安装会留下一个技能监听器能扫到的目录。

## 决策

`parseRepoSpec` 对描述做分词并消费每一个参数，对齐 `skills` CLI 自己的 `add` 解析器（vercel-labs/skills）：`--skill`/`-s` 的值保留，`--agent`/`--subagent`/`--metadata` 连同其值一起丢弃，布尔参数（`-g`、`--global`、`-y`、`--list`、`--all`、`--full-depth`、`--json`、`--copy`）丢弃，其余任何形如参数的 token 也丢弃——任何参数都不可能再进入克隆 URL。第一个非参数 token 作为仓库来源。

克隆路径改为克隆到操作系统临时目录而非受管根目录，用 `collectSkills` 收集全部技能包（深度 ≤ 4），再用 `selectSkills` 决定安装集合——按目录名或 frontmatter 名字大小写不敏感匹配，`*` 选中全部，与 CLI 一致。`request.skills`（选择器）优先于命令里的 `--skill` 值。仓库含多个技能且没有指定选择时，像本地目录路径那样报错并列出可选项，而不是装最浅的那个。所有目标先统一校验再写入，因此一次跨越「新技能 + 已存在技能」的选择不会只装一半；临时目录在 `finally` 中清理。

被取代的 `findSkillMd` 辅助函数和弹窗里只提 `-g` 的占位文案一并更新。

## 考虑过的替代方案

**保留只看 URL 的解析器，遇到含参数的描述直接拒绝。** 不采用：README 里那条命令正是用户手上的东西，拒绝它等于对生态真正在发布的命令继续报错。

**完整实现 CLI。** 不采用：dsh 只有一个受管根和一个安装目标，agent 选择与多来源在这里没有意义；这些参数是被消费掉以便忽略，而不是被实现。

**多技能场景继续装最浅的 `SKILL.md`。** 不采用：那会静默安装用户没要的技能。命令形式现在能携带消歧所需的选择（`--skill <名字>`），报错因此可操作，并与目录路径已有的文案一致。

**继续克隆进受管根目录。** 不采用：git 失败或半途的克隆会被技能监听器看到；仓库名与已安装技能重名时，还会在发现冲突之前就被克隆前的清理删掉。

## 影响

整条粘贴 `npx skills add <仓库> --skill <名字>` 会安装指定的技能。既有描述（`owner/repo`、git URL、`-g`、本地目录）行为不变，唯一例外是「多技能仓库且未指定 `--skill`」从「装其中一个」变为「报错并列出可选项」。安装后的文件夹仍以技能 frontmatter 的名字命名，而不是 `--skill` 的值。克隆不再在受管根目录留下副本，已安装的技能也不会再被同名仓库的清理动作抹掉。

`import.spec.ts` 覆盖了解析器，并借助 `PATH` 上的 stub `git` 端到端驱动克隆路径——其中包括断言克隆 URL 不含任何参数——因此这条回归在无网络条件下也被覆盖。
