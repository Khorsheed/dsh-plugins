# Agent Note: capability-catalog frontmatter——统一的真 YAML 解析

Status: implemented

## 问题

`@khorsheed/dsh-capability-catalog` 里每个 SKILL.md frontmatter 读取器都用自己的行式正则各算各的。`scoped-delivery.ts` 带了四个（一个切分正则、`parsePresetScopeFrontmatter`、`parseMetadataFrontmatter`，以及 `frontmatterFlag`/`frontmatterScalar` 一对），`import.ts` 又带两个（自己的切分正则——连 CRLF 都不兼容——外加 name/description 和 `disable-model-invocation` 的行扫描）。这些扫描在任意缩进层级都命中，于是 `metadata:` 下嵌套的 `name:` 可以遮蔽真正的顶层 name，落在无关键之下的 `presetScope` 也照样声明范围；标志读取器只认 `true`/`false`，而宿主的 skill 加载器（skill-filesystem 的 `frontmatterBoolean`）还认 `1/0/yes/no/on/off`；折叠多行描述则会被读成字面量 `>`。

## 决策

`src/frontmatter.ts` 拥有唯一的一次解析：`splitFrontmatter`（一个兼容 CRLF 的切分器，同时供两条刻意保持文本编辑的路径使用——`withPresetScope` 与 `finalizeSkillText` 编辑的是行，不是解析）与 `parseSkillFrontmatter`——后者用 js-yaml 把整块解析一次（js-yaml 是仓库的 YAML 惯例，且已是随包发布的运行时依赖），返回定型后的 `SkillFrontmatter`:name、description、whenToUse、两个调用面布尔、presetScope、原样保留的 metadata 映射，以及正文。`managedSkillFrom`、`resolveSkillNameFromContent`、`inferModelInvocable` 都从它派生；四个行式读取器和两个正则随之删除，`parsePresetScopeFrontmatter` 也从包根导出面移除。

标量语义对齐宿主加载器：`frontmatterBoolean` 接受布尔、`1`/`0`（数字或字符串），以及不区分大小写的 `yes/no/on/off`——js-yaml 4 会把这些留作字符串（YAML 1.1 的布尔集合是 js-yaml 3 的行为，已实测验证），所以字符串分支承接它们——字符串字段则必须是非空字符串。与宿主的一处刻意分歧：变体之外的标志值读作**缺失**（采用默认值），而不是像宿主那样拒绝整个文件——catalog 是管理与投递面，不是登记加载器。

被钉住的降级语义在整块解析下保留：一个格式损坏的 `metadata:` 值通常会把整个 YAML 解析拖垮，所以解析失败时会把顶层 `metadata:` 段剥掉重试一次——skill 照常投递，只是没有 metadata。只尝试顶层剥离；因其他原因不可用的 YAML 块照样拒绝该文件。

`presetScope` 现在只在两个位置读取：规范位 `metadata.presetScope`（写入器写的就是它，`candidateFor` 叠加的也是它；两处同时存在时它优先），以及旧版顶层 `presetScope`（手改过的文件可能还带着）。嵌套在任何其他键之下的 `presetScope` 不再声明范围——任意缩进的宽容是行扫描的副产品，不是任何真实文件在用的形式。

## 考虑过的替代方案

**单独解析 metadata 块（沿用旧的隔离形态）。** 不采用：一次解析能回答的事不该用两次；「剥离后重试」的兜底恰好保住了被钉住的降级所针对的唯一失败模式（顶层 metadata 值损坏），而不必常驻第二个解析器。

**继续接受任意嵌套层级的 `presetScope`。** 不采用：没有任何写入器产出它，也没有任何 spec 点名它；「无关键之下的 scope 键也算数」正是这次迁移要消除的那类事故。此处记录这次刻意的语义收紧。

**像宿主一样对变体之外的标志值抛错。** 这个面上不采用：宿主加载器可以扫描时告警并忽略文件；catalog 若把一个受管 skill 丢弃就是静默断投。非法标志降级为默认值，skill 保持可见、可编辑。

**写入路径也整体走 YAML 往返。** 不采用：`withPresetScope`/`finalizeSkillText` 只改一个键，同时保留注释、引号和键序——整体重序列化会把整个块重写一遍，而任何读取者都不因此受益。

## 影响

行为变化逐条以 fail-first 钉住（spec 先对着行式旧实现跑红，迁移后转绿）：调用面标志接受宿主的完整变体集合；带引号的 name、CRLF 块、折叠描述都能解析；标量只读顶层；`presetScope` 只在两个位置读取。测试数从 262 增至 284（新增的 `frontmatter.spec.ts` 承载该模块的契约；原 `parsePresetScopeFrontmatter` 的 describe 移到其中并改指向 `parseSkillFrontmatter`）。导出面的损失（`parsePresetScopeFrontmatter`，以及 `isKebabId`/`splitFrontmatter` 在包内迁往 `./frontmatter.ts`）在仓库内无消费者。真 YAML 解析对块内垃圾更严格——frontmatter 不是映射的文件不再能被行扫描拼出身份——这与宿主加载器的立场一致。
