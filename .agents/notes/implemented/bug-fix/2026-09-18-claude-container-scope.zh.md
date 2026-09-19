# Agent Note: 容器化的 claude 条件自带 scope

Status: implemented

[English](2026-09-18-claude-container-scope.md) | 中文

## Problem

claude 是这一家族里唯一凭据存在两个存储里的，而这两个存储并没有同一个读者。实测：

| 在哪 | 版本 | CLI 读**且**写的存储 |
|---|---|---|
| 宿主，macOS | 2.1.274 | keychain |
| 单元，Linux | 2.1.272 | `<CLAUDE_CONFIG_DIR>/.credentials.json` |

T20c 起容器轮 bind 挂的就是实例自己那个作用域目录（读写），于是宿主轮与容器轮跑在同一个 scope 上，就是**同一次授权被两个存储各续一次**。服务端轮换一次性 refresh token 的做法是作废整个 **token family**，于是没有最后续到的那一侧手里就是一个死 token。这不是一个时间窗口，这就是「共用」的含义。

在评测实例上、自然过期窗口里，端到端实测过一次：

1. 单元那一轮续了期，并把轮换后的凭证经挂载写了回来（凭据文件的 refresh token 指纹变了，access 过期时间往后推了 8 小时）。
2. 宿主的协调**正确地拒绝覆盖**它——[新者胜](2026-09-17-claude-credential-sync-newer-wins.zh.md)完全按设计工作，日志打出 `is AHEAD of the keychain`。
3. 紧接着的宿主轮却报 `Failed to authenticate: OAuth session expired and could not be refreshed`，而文件自己的 access token 离过期还有好几个小时——因为**宿主 CLI 读的根本不是那个文件**。它读 keychain，而 keychain 里那条 refresh token 刚被单元的轮换连坐作废；它还在失败那一轮开跑 1 秒后改写了 keychain 条目。
4. 恢复要人工 `/claude-code login`。全程容器侧用同一个文件一直好好的。

所以新者胜是正确且必要的——它保住了文件那一侧，第 2 步就是证据——但它替 keychain 说不了话。**没有任何东西能替它说**：要把单元的轮换写回去，就得把密文当作 argv 传给 `security add-generic-password`，那是用一条凭据暴露路径换另一条。

剩下的杠杆只有一个：不要共用这次授权。

## Decision

**跑在单元里的 claude 条件声明自己的命名 scope，且任何宿主轮都不使用该 scope。** 两个 scope 就是两次独立授权——claude 的 keychain 条目按配置目录路径哈希，命名 scope 天然拿到自己那一条——于是任一侧的轮换都够不到另一侧的 family。

评测**强制**这条而不是只写进文档，因为它的失败代价是一次人工重登，而且在下一次宿主轮之前完全看不见：

- `packages/eval/src/unit.ts` 里的 `claudeScopeDiagnostics` 接收「跑在单元里的条件」与「跑在宿主上的条件」两组，对没有 scope 的容器化 claude 条件返回 `CLAUDE_CONTAINER_SCOPE_MISSING`，对宿主侧 claude 条件占用了容器条件已用 scope 的情况返回 `CLAUDE_CONTAINER_SCOPE_SHARED`。两条消息都写明**为什么**（两个存储、family 连坐），缺 scope 那条还点名修法：`/claude-code login --scope <名>`。
- 它在 `validate` 里跑（离线，在有人批准计划之前），也在 run 的开跑前拒绝里再跑一次（在取任何单元之前）。计划没有 unit 段时所有条件都在宿主上，那时选手也算宿主侧。
- **缺省的 scope 就是实例的默认 scope**——`/claude-code` 委派与每次状态探针用的正是它——所以「不写」是最坏情况而不是中性情况。这就是规则写成「必须声明」而不是「应当不同」的原因。

只检查 `claude-code`。codex 把 `cli_auth_credentials_store = "file"` 钉死，宿主与单元共用**一个**存储因而是一条链；kimi 只有文件；dsh 注入 API key 且从不续期。三家都分叉不了。

两个容器化条件**可以**共用一个 scope：那一对的两侧都是同一个文件，是一条链，正如 codex 的单存储是一条链。

provider 没有改动。这是计划层面的纪律，不是运行时行为。

## Consequences

- 容器轮可以随意轮换自己的授权，碰不到实例自己委派用的那份凭据。
- 每个容器化的 claude 条件要一次人工登录（`/claude-code login --scope <名>`），一次而已——因为凭据从不在 scope 之间复制。
- 早于这条规矩的计划会被 `validate` 拒绝并给出修法，而不是跑起来把实例登出。
- 由此逼出的对前一份记录的更正（宿主 CLI 读 keychain，因此两个存储永不收敛）记在那一份里，而不是只记在这里。

## Alternatives considered

**把单元的轮换写回 keychain（a2）。** 对观测到的故障最直接的修法，因暴露面否决：`security add-generic-password -U … -w <值>` 只能把密文放进 argv，进程表可见；不给值则退化成交互式提示，headless 用不了。用原生 Security 框架绑定能绕开 argv，但为一次写入给插件包加一个需要编译的依赖。

**对容器 scope 抑制协调，让两侧各留各的副本。** 这正是 scope 隔离达成的效果，但若靠给同步开特例来做，两个存储名义上仍指向**同一次授权**——family 连坐发生在服务端而不是我们的代码里，本地做什么都不能让共用变安全。

**给单元挂一份凭据的拷贝。** 与「凭据不复制」这条既有规矩冲突，而且会打断模型回读——回读要从挂载的作用域目录里解析本轮的会话记录。

**只写进文档、不强制。** 这条的失败在下一次宿主轮之前是静默的，代价是一次人工登录。违反规则的计划与正确的计划在 run 的输出里读起来一模一样——这正是检查该进闸门的时候。

## Testing

`packages/eval/tests/container.spec.ts` 里针对 `claudeScopeDiagnostics` 的六条用例：没有 scope 的容器化 claude 条件被拒且消息同时带上 keychain 理由与登录命令；自带 scope 的通过；宿主侧条件占用容器 scope 被拒且消息点名那个容器条件与 token family；宿主侧用默认 scope 的通过；两个容器化条件共用一个 scope 的通过；另外三家即使跨线共用同一个 scope 也不受影响。

`run.spec.ts` 那个四家容器夹具现在给它的 claude 条件配了 scope——改动之前它一个都没声明，因此它同时是一个「闸门会拒什么」的活例子。

测试没覆盖的是前提本身：服务端的 family 连坐行为。它在实例上被实测过（见 Problem 那段时序），没有一份真实授权就复现不了。
