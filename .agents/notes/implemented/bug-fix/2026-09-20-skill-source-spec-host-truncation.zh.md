# Agent Note：把粘贴来的来源 spec 读成 host + 仓库，而不是 `owner/repo`

Status: implemented

## Problem

在「新增 skill → 命令安装」里粘贴最常见的浏览器链接 `github.com/larashero3-dotcom/lieflat-charts`，报的是

```
install failed: ... git clone --depth 1 https://github.com/github.com/larashero3-dotcom ...
remote: Repository not found.
```

看起来像「这个 skill 不支持」。实际是 spec 被读错了两次。`refToCloneUrl()` 用未锚定的 `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/` 在整串里匹配 `owner/repo` 形状，然后用 `const [owner, repo] = ref.split('/')` 只取前两段：开头的 `github.com` 被当成 owner，`<user>` 被当成 repo，真正的仓库名被静默丢弃。带 scheme 的 spec 原样透传，而不带 scheme 的（也就是用户实际粘贴的那种）走的是坏路径。同一个函数还把仓库内路径（`owner/repo/skills/<name>`，`types.ts` 里写着支持）静默丢掉。于是有两个后果：报错里的克隆 URL 是假的，用户也无法区分「URL 写错」和「仓库不存在」。

报告里那条 URL 对两段输入（`github.com/<user>`）和三段输入（`github.com/<user>/<repo>`）是逐字节相同的——也就是说，光看报错反推不出输入形状，这本身就是缺陷的一部分。

## Decision

`resolveCloneTarget()` 取代 `refToCloneUrl()`，并且 `commandInstall` 只搜索 spec 指名的那个路径。

- 先去掉粘贴 URL 带的 `?query`/`#fragment` 和结尾的 `.git`。
- 带传输协议的 spec（`https://…`、`ssh://…`、`git@host:owner/repo`）就是克隆 URL；但只有 `github.com` 会按 `owner/repo[/path]` 拆开。其他 host 的整条路径就是仓库本身，所以 GitLab 子组（`gitlab.com/group/sub/repo`）按原样克隆，不再被截断。
- 不带 scheme、且首段像 host（含 `.` 或 `:`）的 spec：剥掉 host，再以 `https://<host>/<owner>/<repo>` 拼回。非 GitHub 的 host 保留整条路径。
- `owner/repo` 之后剩下的部分就是仓库内子路径。粘贴浏览器 URL 带来的 `tree/<分支>`/`blob/<分支>` 标记被丢掉，结尾的 `SKILL.md` 表示那是个文件，于是搜索根是它所在的目录。`collectSkills` 之后只扫这个路径——指向单个 skill 的 spec 不会再触发「多技能」拒绝，仓库里不存在该路径也各自报错，而不是退化成全仓扫描。
- 报错不再是一根字符串。只给 host 或用户主页的会说清楚并且什么都不克隆（`… is not a repository — a source needs owner/repo`）；路径形状的 spec 在 `stat` 落空后报 `local directory not found:`，不再被读成 `owner/repo`；克隆失败保留 git 原文并追加按 stderr 判定的提示（`Repository not found` → 检查 owner/repo 名字；GitHub 对拼错和私有库是同一句话）。

## Alternatives considered

**正则锚定成恰好两段，更长的直接拒绝。** 否决：能治好静默截断，但文档里写着的 `owner/repo[/path]` 仍然不支持，而且把最常见的粘贴变成要用户手工改写的报错。剥掉 host、认下路径，才是把粘贴的链接真的装上。

**任何 host 都按 `owner/repo` 拆。** 否决：GitLab（以及多数自建 forge）允许仓库前有任意深度的路径，按第二段切会在那边克隆错仓库。只有 GitHub 的 URL 形状是已知的，所以只拆 GitHub。

**不带 scheme 的 host 前缀 spec 一律判为无法识别，让用户补 `https://`。** 单独作为修法否决（带 scheme 的透传行为不变）：用户产出的恰恰是不带 scheme 的粘贴，提示他去改 URL 比直接认下来更糟。

**从 `tree/<分支>` URL 里解析出默认分支。** 否决：为了一个「最坏也就是克隆默认分支」的场景加一次网络探测和刷新令牌路径，不划算，而且后面的子路径校验已经把结果兜住了。

## Consequences

`github.com/<user>/<repo>`、`github.com/<user>/<repo>/skills/<name>`、`https://github.com/<user>/<repo>/tree/<分支>/<路径>`、`…/blob/<分支>/<路径>/SKILL.md`、`owner/repo`，以及带 `.git`/query 的写法都归一到同一个克隆，仓库名之后的部分用来收窄搜索。只有 `github.com` 的拆分是特例；其他 forge 的 spec 必须是克隆 URL 本身。用例在 `tests/import.spec.ts` 的 `commandInstall source specs` 下：host 剥离的回归、搜索收窄、tree 与 blob 形状、后缀剥离、非 GitHub 路径、只给 host 的拒绝（断言没有发起克隆）、仓库内路径不存在、本机目录不存在、克隆失败提示。客户端的 `src/client/locales.ts` 两份文案与两份 README 现在都写明 GitHub 链接可以直接粘贴——原来的占位符只写了 `owner/repo`，正好诱导了出错的那一种写法。
