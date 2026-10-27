# Agent Note: a Codex member runs under its session's sandbox mode

Status: implemented

## Problem

10-27，一个完全访问房间里的 Codex 成员（bcc89add…）不管会话显示的是什么权限，每条命令都跑在 Codex 的 `workspace-write` seatbelt 沙箱里，而且没有网络。Blender 在里面崩溃了（退出码 139，一轮里崩了五次）；同一份脚本由 Kimi 成员运行，成功导出了七次。沙箱只取自本插件的 `sandbox` 配置，它默认是 `workspace-write`，而 3080 上没有设置这一项。会话自己的 `sandbox/mode` 从来没有被读取过。Claude 成员是跳过权限运行的，Kimi 成员没有沙箱限制，只有 Codex 是例外。

## Decision

- 每一轮的沙箱策略由 `CodexCliProvider.sandboxFor(childSession, parentSessionId)` 决定。如果插件配置里明确设置了 `sandbox`，就以它为准。否则读取成员所在的会话：先看发起委派的会话最新的 `sandbox/mode`，再看子会话继承来的那一条。宿主的取值（`read-only` | `workspace-write` | `danger-full-access`）和 Codex 自己的取值完全一样，所以原样传过去。两个会话都没有记录模式时，这一轮按 `workspace-write` 运行。
- 两种运行方式都用它：exec 命令行的 `--sandbox`，以及实时驱动的 `thread/start`（通过 `CodexLiveRoundSpec.sandbox` 传入）。
- 配置的结构没有变。未设置现在表示「跟随会话」，而不是 `workspace-write`。

## Alternatives considered

- **把插件配置设成 `danger-full-access`。** 这样每个 Codex 成员都会拿到完全访问，不管它的会话是什么权限，会破坏只读或 workspace-write 会话本身的限制。

## Consequences

- 成员拿到的权限和它的会话显示的一致。受限的会话里，成员也保持受限。
- 实时驱动在成员的线程启动时应用模式。运行期间如果模式改了，要等成员下一次开线程（被回收或换模型）时才生效。
- 评测快照里的 `sandbox` 字段仍然报告配置的值（未设置时是 `workspace-write`），而不是各会话自己的模式。

## Testing

`local-agent-codex`（262）：测试覆盖优先读取发起会话的模式、读取子会话最新继承的模式、未知和缺失的模式，以及明确的配置覆盖会话设置。
