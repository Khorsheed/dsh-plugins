# Agent Note:每个套件镜像只有一个源——packages/<套件>

Status: implemented

## 问题

dsh-basic 和 dsh-dev 两个镜像仓在本仓有两个候选源。`profiles/basic` 与 `profiles/dev` 是早先「克隆后跑脚本」的 profile 包:一份钉住全部成员的 `package.json`,`scripts/install.sh` / `update.sh` / `restart-into-*.sh`,第二套 README,dev 还有 `presets/` 下的目录式 preset。它们用 `sync:profile`(kind `profile`)同步。与此同时 `packages/basic` 和 `packages/dev-suite` 成了真正的安装单元——用户把 npm 包名贴进 DSH,模式 preset 写在套件自己的 `cordis.patch.yml` 里——学习、剪辑、游戏开发三个镜像也早已从 `packages/<套件>` 同步(kind `package`)。两套 README 各自漂移(dev profile 的 README 还是旧截图,还留着给 0.1.7 之前宿主的 install.sh 一节),profile 的成员清单也过时了(basic 下还列着 ankh-guard)。

## 决定

`packages/<套件>` 是它镜像(经 `MIRROR_REPO_NAMES` 对应 `Khorsheed/dsh-<短名>`)的唯一源。删除 `profiles/basic` 与 `profiles/dev`。

- **截图**用 `git mv` 移到 `packages/basic/docs/screenshots/`(仍是强制跟踪)。dsh-basic 镜像从 `packages/basic` 同步,图仍在 `docs/screenshots/`,所以所有 README 的 raw 地址不变。`docs/` 不在包的 `files` 里,npm 包不带这些图。dev profile 的截图要么是 basic 那套的字节副本,要么没人引用,一并丢弃;dev-suite 的 README 本来就嵌 dsh-basic 的地址。
- **README**:包里的 README 本来就是更新的门面页。profile 那份多出来的只有给旧宿主的 install.sh 安装路径,已退役。两个套件包各补了一份 `LICENSE`,镜像里照样有许可证。
- **工具**:退役 `scripts/sync-profile-mirror.mts` 与 `sync:profile`。唯一入口是 `pnpm sync:mirror <kind> <name>`,CI 的镜像检查改跑 `sync:mirror package basic --check`。`sync-mirror.mts` 里的 `profile` kind 留给 `profiles/eval`——暂缓公开的评测线,有自己的镜像。`release-status` 从 `packages/basic/package.json` 读 basic 成员。`check-install-spec-floors` 扫所有包 README 加剩下的 profile。

## 考虑过的替代方案

**把 profile 留作薄薄的镜像源。** 否决:每个套件两套 README 会漂移,而且一条不该再用的克隆安装路径会一直公开挂着。

**把 eval 也挪进 `packages/`。** 不在本次范围:`profiles/eval` 由 `scripts/eval-preset-parity.spec.ts` 钉住,还有自己的安装流程。

## 后果

- 本改动落地后第一次推送模式的同步会重写两个镜像:安装脚本、`pnpm-workspace.yaml`、(dev 的)`presets/` 消失;`src/`、`tests/`、`locale/` 和构建配置出现。dsh-dev 还会丢掉它带着的十张截图;本仓没有任何地方链接它们。
- 在那次同步推上去之前,CI 的镜像检查会失败。这正是想要的提示。
- 新的 README 截图放进 `packages/basic/docs/screenshots/`(`git add -f`)。

## 测试

`sync-mirror.mts package basic --dry-run` / `package dev-suite --dry-run` 显示上面的重写,dsh-basic 的截图没有任何变化。在 `packages/basic` 里 `npm pack --dry-run` 不列出 `docs/`。`pnpm test:scripts`、`check:plugins`、`check:collections`、`check:packages`、`check-install-spec-floors`、双语配对与 hygiene。

## 相关

- [README 截图托管](2026-09-27-readme-screenshot-hosting.zh.md)——本次沿用它的「图要被跟踪」规则,只是路径挪了。
- [包目录名与 npm 包名一致](2026-10-26-package-dirs-match-npm-names.zh.md)——`MIRROR_REPO_NAMES` 的来历。
