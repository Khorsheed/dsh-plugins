# Agent Note: 社区包只发 0.MINOR.PATCH——不再发 prerelease 版本

Status: implemented

## 问题

有两条线带 `-rc.N` 版本号:local-agent 家族(npm 上是 `0.2.0-rc.3`)与评测家族(`0.2.0-rc.1`,未发布)。这个后缀对用户没有信息量——所有包都是 0.x,本身就表示「尚未稳定」,与宿主的兼容关系写在 `engines.dsh` / `dsh.compat.minHost` 里——却一直在制造工作量:npm 的 prerelease 区间只在同一个版本三元组内匹配(`^0.2.0-rc.4` 匹配不到 `0.2.1-rc.x`,即 docs/publishing.md 记录的 peer 区间陷阱);npm 12 不显式 `--tag` 就拒绝 stage prerelease(2026-10-24 这一波就停在这里);家族同版的规则又把每一次 rc 前移乘到七个包上(同一波还因为 dsh-headless 没跟其它成员一起进 rc.4 被拦过一次)。

## 决定

2026-10-24 起,社区包只发 `0.MINOR.PATCH`,写入 docs/publishing.md「版本号规则」:

- 破坏性改动、新能力,以及套件成员或卡名变化进 MINOR;修 bug、只改文档、只跟随依赖前移进 PATCH;
- local-agent 家族保持同一条版本线;
- 新包从 `0.1.0` 首发;已有版本线的包首发取那条线的正式版本;
- 不烧版本号:已 stage 的版本只有在不能复用时才换号。

`release:wave` 机械执行:`check` 把任何 prerelease 目标版本报为错误,`plan` 对 rc 线建议它的正式版本(`0.2.0-rc.3` → `0.2.0`)而不是下一个 rc。同一天早些时候加在 `stage` 里的 `--tag latest` 绕行随之删除——不会再有 prerelease 走到那里。

本波:local-agent 家族前移到 `0.2.0`(高于 npm 上的 `0.2.0-rc.3`;`0.2.0` 从未发布,不复用任何版本号),datasets / eval / lab 以 `0.2.0` 首发。

## 备选

**保留 rc 线,让工具去适配(`--tag`、区间改写)。** 否决:只是逐个修症状,还留着一个对用户没有信息量的后缀。

**rc 线改从 `1.0.0` 重来。** 否决:这里没有东西稳定到能承诺 1.x 语义;0.x 才是实话。

## 影响

- 不再需要处理 `--tag`,pack-dist 的 `^` 改写也不会再遇到 prerelease 区间的意外。
- 需要「试水」的包以普通 0.x 版本发布,在成熟前不进套件(sidechat 的做法),而不是以 rc 发出去。

## 测试

`scripts/release-wave.spec.ts`:prerelease 目标版本是 check 错误;plan 与 `bumpVersion` 把 rc 线转为正式版本。家族在 0.2.0 时 `pnpm check:release-groups --release` 绿。
