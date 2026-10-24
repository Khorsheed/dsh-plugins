# Agent Note: 安装集合——基础体验加一个模式套件,以数据表达

Status: implemented

## 问题

模式套件是能力 bundle:每个装一个模式及其 preset 授予工具的那组家族,都不含基础体验。普通用户因此要装两次(basic 加一个模式),还得知道这一点。家族 bundle 提案([2026-09-24-family-bundles-and-collections](../../../../proposals/active/2026-09-24-family-bundles-and-collections.md))早已把两条轴分开——bundle 是能力单元,集合是场景——集合层留作波 3。把 basic 的成员并进每个模式套件能让每个套件一次装齐,代价是十二行抄进六个 patch,能力轴也会变模糊。

## 决定

集合是数据,不是包。仓根的 `collections.json` 列出每个集合的 id、中英文标题与 bundle 名:每个模式一个(`@khorsheed/dsh-basic` 加该模式套件)、只有 basic 的 `basic`、以及 `full`(basic 加全部六个套件,即 3080 的形态)。

一条命令装一个集合:`dsh plugin add` 把参数原样交给 pnpm,所以 `dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite` 今天就能用,不用改宿主,也不用元包。

`scripts/check-collections.ts` 管集合层:

- `pnpm check:collections`(也是 `gate` 的一步)检查形状(id 唯一、两种标题、bundle 不重复)、成员(每个名字都是仓内 `family`/`mode` bundle;每个模式套件至少在一个集合里)、宿主区间(各 bundle 的 `engines.dsh` 有交集,集合不会装出没有宿主能启动的组合),以及生成的 README 文字是最新的;
- `pnpm map:collections` 把安装命令写进标记之间:README.md / README.en.md 里一张表(`collections:`),每个模式套件 README 两种语言里一段「推荐连同基础体验一起装」(`collection:`)——这也是各套件镜像仓展示的内容。

集合与自选安装重叠无害:共享行合并为一条(Loader 按 id 建表),check:plugins 的跨 bundle 行一致性检查保证共享行逐字相同。

## 备选

**每个模式套件也列入 basic 的成员。** 每个模式一次装齐,但十二行抄进六个 patch,basic 每改一次就动六个包。否决:它把 bundle 层本来要分开的能力轴与场景轴合到了一起。

**每个场景一个集合元包**(构建期从成员 bundle 合并 patch——提案里的波 3 候选)。暂不采用:包的包会给每个场景多一条发布线、多一处行的存放点,相对一行命令没有收益。

**等宿主插件市场支持「安装集合」。** 市场索引支持分类和标签,便于发现,但一次只装一张卡。界面里一键装集合需要上游改动;本 note 不阻塞它——市场以后可以按场景打标签,`collections.json` 正是它要读的清单。

## 影响

- 普通用户从 README 或套件镜像仓复制一条命令即可;高阶用户照旧单装任何包或套件。
- 新增模式套件必须同时加它的集合(否则 check:collections 失败),README 区块按清单重新生成。

## 测试

`scripts/check-collections.spec.ts`:版本排序与区间求交的单元用例、生成文字的形状、真实树(每个场景集合都是 basic 加恰好一个套件;零发现)。`pnpm check:collections` 干净;`pnpm test:scripts` 除 main 上原有的 `sync-icon-artwork` 失败外全绿。
