# Agent Note: 把监督安装器纳入发布物——推荐的部署形态此前从 npm 拿不到

Status: implemented

[English](2026-08-18-ship-the-supervisor-installers.md) | 中文

## Problem

`package.json` 的 `files` 只列了 `lib/*.js`、`lib/types/**/*.d.ts`、`scripts/dsh-watchdog.sh` 和 `cordis.patch.yml`，`scripts/install-launchd.sh` 不在其中，因此 `npm pack` 从未包含它。而 README 把部署形态 C——launchd 监督 watchdog——写作推荐形态，并让读者去执行那个脚本：**推荐形态指向了一个 npm 消费者根本拿不到的文件。** 发出去的只有 watchdog，而裸的 detached watchdog 正是形态 C 要消除的那个单点失效。

systemd 那边则完全没有产物。README 只给了一条命令，单元文件留给读者自己拼——同一个形态的 Linux 半边，是照着散文手工组装。

## Decision

把两个安装器都加进 `files`，并给 systemd 补上缺失的产物。`install-systemd.sh` 与 `install-launchd.sh` 逐个标志对齐（`--start`、`--port`、`--home`、`--repo`、`--cli`、`--label`、`--force`、`--uninstall`），生成 `~/.config/systemd/user` 下的**用户**单元——绝不生成系统单元，因此不需要 root。语义映射：

| launchd | systemd | 理由 |
| --- | --- | --- |
| `KeepAlive SuccessfulExit: false` | `Restart=on-failure` | 退出码 0 是有意的 `watchdog-stop`；其余一律重启整条链 |
| `RunAtLoad` | `WantedBy=default.target` + `enable --now` | 立即启动，并在每次登录时启动 |
| `EnvironmentVariables` | `Environment=` | 单元启动时环境几乎为空，所以要快照 PATH 并用绝对路径的 `node`——launchd 那边正是这个问题导致过 exit 127 |
| `StandardOutPath` / `StandardErrorPath` | `StandardOutput=append:` / `StandardError=append:` | 日志落点一致 |

两处 systemd 特有的取舍：

- **`StartLimitIntervalSec=0`。** 默认值（10 秒内 5 次启动）会把反复重启的单元置为 `failed` 并停止重试，等于监督静默终止——而这正是该部署形态要防的那种失败。重试预算属于 watchdog，它本身已有退避并会退化成崩溃页。
- **`--print`。** 把单元写到 stdout 后退出，完全不碰 systemctl。本包在 macOS 上开发，这是此处唯一能审阅和检查生成产物的途径；没有它，systemd 这条路就会在完全未被执行过的情况下发布。

`Environment=` 与 `ExecStart=` 的值是按 **systemd** 而非 shell 的规则引用的。systemd 按空白分词、并支持双引号内的反斜杠转义，但它不解析 shell 引用——因此用于内层 `bash -c` 字符串的 `printf '%q'` 形式会被拆成多个参数，`ExecStart` 在第一个空格处就被截断。`systemd_quote` 辅助函数把整条程序包成单个 systemd 参数，内层的 shell 引用在其中原样保留。`StandardOutput=append:` 接受的是不带任何转义的裸路径，因此含空白的 `--home` 在生成阶段就被拒绝，而不是产出一个启动时才解析失败的单元。

## Verification

- `bash -n` 通过；`--print` 输出已逐行检查。
- 对生成的 `ExecStart` 做往返解析：按 systemd 规则分词恰好得到三个参数（`/bin/bash`、`-c`、程序体），再把第三个参数按 shell 规则解析，逐字节还原出原始的 `--start` 字符串。在没有 Linux 的开发机上，这是替代真机启动的检查手段——它证明的是引用正确，不是运行正确。
- 错误路径：缺 `--start` 退出 2，未知标志退出 2，含空白的 `--home` 退出 2 并给出原因，没有 `systemctl` 的机器退出 2 并指向 `install-launchd.sh` 与 `--print`，而不是写下一个它无法 enable 的单元。
- `npm pack --dry-run` 现在列出 `scripts/dsh-watchdog.sh`、`scripts/install-launchd.sh`、`scripts/install-systemd.sh` 三个文件。
- `install-launchd.sh` 对缺失 `--start` 的拒绝行为保持不变。

**未验证：** 没有在真实 systemd 主机上 bootstrap 过任何单元——本机没有 systemd。生成的单元被证明格式正确、引用正确，但未被证明能拉起服务。Linux 上的首次使用应当按真正的测试对待。

## Alternatives considered

**只给一个 `.service` 模板加文档，不写脚本。** 写起来风险更低，但把替换绝对路径、快照 PATH、引用启动命令这三件事留给读者——而它们正是 launchd 安装首次运行时出问题的三件事。与 macOS 之间的不对称也会缺少解释：逻辑是同一套，不同的只是产物。

**放在 `/etc/systemd/system` 的系统单元。** 不需要 `enable-linger` 就能跨登录存活，但一个由 agent 拥有的开发者服务要求 root 并不合适。安装器保持用户作用域，并把 `loginctl enable-linger` 命令打印出来，交由管理员自行决定执行。

## Consequences

npm 消费者现在可以在两个平台上，用 README 已经给出的那条命令抵达推荐的部署形态。systemd 这条路以产物而非散文的形式存在，其限速与引用上的取舍记录在下一个读者会去找的地方。两个安装器都不会自动注册任何东西：安装始终是用户的显式动作。
