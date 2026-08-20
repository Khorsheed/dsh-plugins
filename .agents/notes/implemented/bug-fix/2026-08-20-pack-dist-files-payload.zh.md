# Agent Note: pack-dist stages every files-declared payload, not just lib/

Status: implemented

[English](2026-08-20-pack-dist-files-payload.md) | 中文

## Problem

`scripts/pack-dist.ts` 过去只把根文档（`STAGED_ROOT_FILES`）和 `lib/` 打进发布 tarball。包在 `files` 字段里声明的其他内容会被静默丢弃——对 ankh-guard 来说就是 `scripts/dsh-watchdog.sh` 和 launchd/systemd 安装器，也就是这个包存在意义所在的整个监督机制。第一次用 pack-dist 发布 ankh-guard（0.1.0-rc.7）时，差一步就把一个没有 watchdog 的守护包发出去了。此前发布的 0.1.0-rc.6.5 是从 standalone 仓库打包的（它带有 monorepo 包里没有的 `LICENSE` 和 `README.en.md`），所以这个缺口一直没被发现。

## Decision

staging 现在会复制 manifest 的 `files` 字段声明的每一个普通（非 glob）路径，除了已处理的根文档和 `lib/`：`filesDeclaredExtras(pkg.files)` 过滤掉 glob 条目（已被 `lib/` 的递归复制覆盖）、`lib` 本身和已 stage 的根文件；每个幸存且存在于包内的路径都按相对位置复制进 staging 树。`PackageJson` 类型增加了可选的 `files` 字段。

## Alternatives considered

- **把 `scripts/` 硬编码为额外 stage 目录** —— 这是某个包的布局而不是契约；下一个要发 `assets/` 或 `bin/` 支持文件的包还会再次静默丢失。
- **在包目录里直接 `pnpm pack`，事后再改 tarball** —— rescope 必须在打包前完成（npm 安装的是 tarball 里的 manifest），事后做 tarball 手术比 stage 声明文件更脆弱。
- **遇到未 stage 的 `files` 条目就报错而不是复制** —— 响亮报错会逼出每包一份手工清单；直接复制声明的路径是同等安全且零簿记。

## Consequences

- 任何在 `files` 里列出普通路径的包现在经 pack-dist 发布时无需额外接线；`lib/` 之外的 glob 负载仍不支持（目前不存在——过滤器跳过它们；将来要加就扩展 `filesDeclaredExtras`，不要绕过它）。
- ankh-guard 0.1.0-rc.7 的 tarball 带有 `scripts/dsh-watchdog.sh`、`scripts/install-launchd.sh`、`scripts/install-systemd.sh`，已在 `npm publish` 前通过检查打包产物确认。
- 覆盖：`scripts/pack-dist.spec.ts` 钉住了过滤器行为（保留普通路径；跳过 lib、根文档和 glob），经 `pnpm test:scripts` 运行。
