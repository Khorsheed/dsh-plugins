# 验收记录

整合包与插件的**实测证据**放这里,一次验收一个文件:`<对象>-<yyyy-mm-dd>.md`(如 `web-basic-2026-09-05.md`)。

## 为什么不放别处

- **不放 `profiles/<name>/`**:那个目录会被 `sync-mirror` 整体同步进**公开**镜像仓。验收记录常带 agent transcript 摘录,不该跟着 profile 发出去。
- **不放 `.agents/notes/`**:Agent Note 记的是**决定**(强制的 `## Alternatives considered` 就是为此存在)。验收记录是**证据**,不是决定——给「21 个成员逐个装卸载都正常」写一段「考虑过的替代方案」只会逼出废话。
- **放 `docs/`** 是有先例的:[release-status.md](../release-status.md) 就是同类东西——状态快照,不走 note 格式,需要时重新生成。

**证据在这里,决定进 Agent Note。** 验收过程中做出的判断(例:「ankh-guard 留在 web-basic」)按常规写成 Agent Note,并链回本目录对应的证据文件。

本目录不受 Agent Note 的格式门禁与双语配对门禁约束(配对 glob 是 `{packages,profiles,.agents}`),**但仍受 `check:hygiene` 约束**:粘 transcript 前把绝对路径(`/Users/…`、`/home/…`)改成 `/home/user/…`,否则提交会被 pre-commit 拦下。

## 三段式模板

```markdown
# <对象> 验收 — <yyyy-mm-dd>

验收人:<谁> · 版本线:<各成员版本或 profile 版本> · 宿主线:<dsh 版本>

## 环境

一次性还是常驻、`$DSH_HOME` 是什么、端口、工具链走的哪条线(npm 缓存工具链
`~/.dsh-toolchains/stable` = 「用户拿到手什么样」;源码检出 = 「prod 配置对不对」)。
按 [ops.md 的环境拓扑](../ops.md)。

## 逐项结果

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| A13 全新安装 | 一次通过 | ✅ / ❌ | 命令与关键输出 |
| A15 `<成员>` 装卸载 | `--dump-config` 行数 −1、id 消失、装回复原 | ✅ / ❌ | 行数前后 |

**机器可判的项贴读数,不贴感想**(`--dump-config` 行数、Remote 命名空间探测、
工具注册表);人工验的项写清楚看了什么、在哪个界面。

## 卡住的地方

没跑完的项、判据本身有歧义的项、以及**指南的 bug**——A14/B11 那种「agent 中途
来问」的情形要原样摘录它问了什么,那是 README 缺一条的直接证据。
```
