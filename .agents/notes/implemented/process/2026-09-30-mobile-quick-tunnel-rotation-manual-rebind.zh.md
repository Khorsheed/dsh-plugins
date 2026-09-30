# Agent Note:mobile Quick Tunnel 轮换被 deploy-3080 拒绝;手动重绑并治愈 launch spec

Status: implemented

## Problem

2026-09-30,3080 的 mobile 公网入口(`…trycloudflare.com` Quick Tunnel)失效——它的 cloudflared 进程没了(Quick Tunnel 域名随进程死亡)。既定运维轮换 `pnpm deploy:3080 --package packages/mobile --mobile-origin <new>` 走完 1–4 步后在第 5 步**拒绝**:轮换必经 `reconfigure`(入口域名在启动命令里),而 `restartVerb()` 在自动重绑前要求线上 `launch-spec.json` 带有 `preflight.candidateProbeCommand` 字段。线上 spec 是旧一代 guard 写的、没有该字段,自动化按设计停下并提示「按手册重绑」。

## Decision

按 [self-deploy reconfigure note](2026-09-26-ankh-guard-self-deploy-reconfigure.md) 的手册原样执行:

1. 手动起新隧道:`cloudflared tunnel --url http://127.0.0.1:3080 --protocol http2 --no-autoupdate`,脱离会话驻留,日志在 `~/.dsh-official/state/cloudflared-mobile.log`。动宿主之前先端到端验证:`https://<new-domain>/` → 401(经边缘到达 dsh 栅栏;401/403 证明转发通,530/000 才是隧道断)。
2. 诊断 preflight:`preflight --profile web --preflight-surface built --preflight-install-anchor <harness>/apps/cli/package.json --timeout-ms 300000` → PASS。
3. 重启前即刻重录绿色凭证(10 分钟新鲜窗口必须覆盖 reconfigure 的双重 preflight + 启动 + canary)。
4. `reconfigure --on-failure restore-previous`,逐字段抄自线上 spec,并补 `--candidate-probe-command`——按随包 Skill 的规则派生:与 `--start` 同一 executable 与 launcher argv,把长驻的 `web …` 动作换成一次性 `--profile web --dump-config`。

结果:cutover `ready`,13:59:36 canary PASS,deployment proof 已记录。新 spec 现在**固化了 `candidateProbeCommand`**(reconfigure 共同绑定),此后对该 spec 的 `--mobile-origin` 轮换不会再撞这个拒绝。

## Alternatives considered

**当场给 deploy-3080 加自动派生探针。** 暂缓而非否决:拒绝是正确的保守行为——guard 无法证明任意 shell 的语义同源——但 deploy 编排器本身就是调用方信任边界,可以套用 Skill 文档化的派生规则。spec 已治愈后这个缺口在本机是潜伏的,改进让位于运维时效;仍列为后续候选。

**用 schedule-exit 加改环境变量轮换。** 不可行:入口域名绑在启动命令里(env + `--trusted-host`),而 schedule-exit 按*已记录*的命令原样重启。只有 reconfigure 能重绑 spec。

**从零重建 spec(configure-launch / 重新 supervise)。** 更重,且会丢掉 `--on-failure restore-previous` 依赖的持久化 previous 侧;reconfigure 是保住回滚的事务路径。

## Consequences

- 3080 的 mobile 入口已恢复,域名 `bridge-spider-rely-studios.trycloudflare.com`;每次轮换后手机必须重扫二维码(旧二维码永久失效)。
- 隧道是普通脱离会话的 cloudflared 进程(pid 98789,2026-09-30 ~13:51 启动)。**没有监督者**——自动隧道管理器已于 2026-09-28 移除([note](../bug-fix/2026-09-28-remove-mobile-tunnel-manager.md))。机器重启后不存活;失效时重复本轮换流程。稳定命名隧道能终结重扫仪式,但需要运维者的 Cloudflare 账户——那是一个明确的产品决策,不该悄悄自动化。
- 机器上另有一条指向 `127.0.0.1:3182` 的 cloudflared(对端服务存活,与我们无关)——别动。
- 本次会话还清掉了一个 02:42 那代监督者留下的孤儿 `dsh-watchdog.sh`(pid 61186);它不在现役监督链上(launchd `com.dsh.watchdog` → 66070 → 66253)。
- 未解之谜(在观察):13:56 实例自己重启过一次(attempt=5),没有可见的操作者动作;在轮换 cutover 前已自愈并 canary PASS。
- `--dump-config` 观察到的组合警告(不阻塞、属 profile 卫生、与本次轮换无关):家族 retreat 后 bundle patch 的 `tool-subagent-codex`/`tool-subagent-claude-code` 条目找不到;profile patch 残留 `ui-brain-3d`(找不到)、`llm-deepseek` 与 `ui-shortcuts`(name mismatch 被跳过)。值得安排一次专门清理;不要乱手改——profile 是共享状态。
