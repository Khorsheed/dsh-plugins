# Agent Note: 包目录名与 npm 包名一致

Status: implemented

## 问题

`packages/` 下有 11 个目录和它发布的包名对不上:模式套件(`dev`、`writing`、`learning`、`video`、`gamedev` 发布为 `@khorsheed/dsh-<mode>-suite`;`bundle-eval` 发布为 `@khorsheed/dsh-eval-suite`,是首发前旧名 `dsh-bundle-eval` 的遗留)、client 包(`message-tools`、`session-title-edit`、`ui-panel-kit`、`ui-content-preview` 发布为 `@khorsheed/dsh-client-*`)以及 `dsh-reader`(发布为 `@khorsheed/dsh-reader`)。读者得为同一个包记两个名字;`eval` 旁边的 `bundle-eval` 最容易让人困惑,也是这次改名的起因。

## 决定

每个目录名都改成 npm 包名去掉 `@khorsheed/dsh-`:`eval-suite`、`dev-suite`、`writing-suite`、`learning-suite`、`video-suite`、`gamedev-suite`、`client-message-tools`、`client-session-title-edit`、`client-ui-panel-kit`、`client-ui-content-preview`、`reader`。包名、loader 行 id、preset id 都不变,安装、会话与设置无感。

有两样名字原先由目录名推出,这次显式保持稳定:

- **镜像仓。** `scripts/sync-mirror.mts` 把 `packages/<dir>` 推到 `Khorsheed/dsh-<dir>`。模式套件的镜像仓是集合的门面,通过 `MIRROR_REPO_NAMES` 保留短名(`writing-suite` → `Khorsheed/dsh-writing`,dev、learning、video、gamedev 同理)。
- **发版 tag。** tag 形如 `<dir>-v<版本>`。有发布历史的三个改名包,把全部历史 tag 以新目录名复制了一份(`client-message-tools-v0.3.4` 与 `message-tools-v0.3.4` 指向同一处),`release:wave plan` 仍能算出「上次发版以来的改动」。旧 tag 保留。

树内所有 `packages/<旧名>` 路径(文档、Agent Note、sidecar、测试、脚本、发布 workflow 的示例)都已改写,`scripts/check-plugin-independence.ts` 里按目录名写的名单也换成新名。

## 备选

**只改 `bundle-eval`,或先改套件、client 与 reader 以后再改。** 用户选择一次改完:改动 `dsh-reader` / `message-tools` 的在途分支都是之后才合的,git 能跟踪改名。

**镜像仓一起改名。** 否决:`Khorsheed/dsh-writing` 等是已经被 README 链接的公开地址。

## 影响

- 在这次改动之前切出、又碰到改名目录的分支,合并时靠 git 的改名识别;合完要确认能构建。
- 新包:目录名取 npm 包名去掉 scope 前缀。

## 测试

全仓构建;每个改名包的测试与 datasets 的 organizing-preset 测试;`pnpm test:scripts`(check-plugin-independence、remote-namespaces、gen-typert、eval-preset-parity 的测试都读新路径);`check:plugins`、`check:profiles`、`check:collections`、`check:packages`、双语配对。
