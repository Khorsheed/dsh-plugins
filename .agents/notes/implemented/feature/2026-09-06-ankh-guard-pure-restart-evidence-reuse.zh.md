# Agent Note: ankh-guard 纯重启证据复用

Status: implemented

[English](2026-09-06-ankh-guard-pure-restart-evidence-reuse.md) | 中文

## Problem

原重启凭证混合了两种不同生命周期：build/test 结果绑定干净 git HEAD，但十分钟新鲜窗口也迫使字节完全相同、已经运行过的部署在之后每次运维重启前重新执行完整构建与测试。官方 harness 检出上这一轮要花数分钟，即使源码、依赖、profile、已安装产物和启动输入都没变。单纯增大 `maxAgeMinutes` 只是把同一种混淆延长；只接受 `last-good-boot.json` 或 HEAD 相等，又会漏掉 profile、被忽略构建产物、已安装包、链接目标和执行面的漂移。

## Decision

新鲜 credential 的语义保持不变；有修改、launch cutover、旧状态以及无监督的 `restart` 动词仍必须使用它。watchdog 监督下的 `schedule-exit` 增加第二类证据：`provenDeployment`。只有本协议版本观察到新实例依次通过 readiness/ownership、composition preflight 和重启后 canary，才会写入这份证明。

证明把源 credential identity 与证据命令摘要绑定到重新计算的部署指纹：干净的 credential repo 与 harness revision、完整稳定 launch spec、profile 配置、直接安装包字节、`file:` 源归档、宿主安装元数据，以及显式 source/built preflight runner 与 install anchor。符号链接会跟随目标，合法目录循环会去重；dangling link、特殊文件、缺失包、缺失 git identity、脏树或缺失执行绑定全部 fail closed。证明不持久化命令、文件内容、bearer URL 或凭据值，只保存 revision 与 SHA-256 摘要。

`schedule-exit` 优先使用新鲜 credential。过期后会重新计算指纹，只接受完全匹配的证明，并把所选证据的种类与 SHA 写入短寿命 restart marker。successor watchdog 在 canary 阶段再次核对同一授权，因此调用方检查后到新进程验证前替换状态或改变任一指纹输入都不能通过。新的 `record --run` 尝试和 `clear` 都会使旧证明失效。证明授权的纯重启保留原证明；新鲜 credential 授权的重启则在 canary 后晋升新证明。

旧版 `last-good-boot.json` 不会迁移为证明。首次部署必须先完整跑一次证据重启与 canary，之后的纯重启才能走快速路径。证明落盘失败不会杀掉已经健康且 canary 通过的宿主；它会响亮记录，并让下一次重启重新要求 build/test。

## Alternatives considered

**HEAD 相同就让构建凭证永久有效。** 否决：HEAD 不覆盖 profile 清单、已安装 tarball、链接包目标、被忽略的运行产物或真实 source/built preflight 执行面。

**增大默认新鲜窗口。** 否决：只是降低错误生命周期模型的触发频率，仍无法区分“尚未真实启动的构建结果”和“已经通过实机 canary 的部署”。

**把健康启动 revision 或当前 HTTP 响应当作复用证明。** 否决：旧协议启动戳没有绑定具体 credential 与完整 launch/runtime 指纹，响应也可能来自错误 listener。

**所有重启动词都复用证明。** 第一版否决。`schedule-exit` 有稳定耐久 launch spec 与权威 supervisor ownership；单次 `restart` 可能重建命令或 listener 状态，因此继续要求新鲜 credential。

## Consequences

受监督且未变化的部署在十分钟后纯重启，不再仅因时间流逝承担完整 build/test 成本。composition preflight、权威停启、readiness、ownership 稳定、适用时的浏览器交接和 canary 仍全部执行。任何部署漂移都会回到既有完整证据路径。

指纹需要读取 profile 直接安装包与源归档字节，所以快速路径并非零成本；它被刻意设计为远低于重建并测试宿主。harness root 必须由 git 管理，并具备显式 preflight 执行绑定；缺少这些输入的部署仍可运行，但不能复用证据。

测试固定了旧状态迁移边界、过期 credential 复用、credential 替换失效、profile 与安装包漂移、外部符号链接目标漂移，以及授权 SHA 复核。3080 验收还会先完成一次全量种子重启，再以刻意过期的新鲜窗口执行一次同启动配置重启。

## 验证

- 包级门禁通过全部 189 个测试（60 个单元测试、129 个集成测试），包含进程所有权与生命周期套件。
- 全仓 `pnpm gate --all` 的 11 个阶段全部通过，耗时 434 秒；ankh-guard 最长分片为 119.7 秒，24 个包归档全部通过验证。
- 生产部署流程在 179 秒内完成，目标是干净的官方 `0.1.1-rc.2` harness revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。持久 launch spec 明确选择 source 执行面与已安装的 built preflight runner。
- 使用新鲜 credential 的种子重启在 canary 后晋升部署指纹 `95d92ffce81aabb5024e4b90d0b04d5026023f071d15b50b3cc3efc750b94e52`。随后把 `max-age` 刻意降到一分钟，同启动配置的 `schedule-exit` 选择了 `proven-deployment`，在 restart marker 中写入匹配的 evidence SHA，约十秒完成并返回 HTTP 200，同时保留原证明的时间戳与指纹。第二次重启没有运行 harness build 或 test 进程。
- 在证明复用演练前，外层 launchd supervisor、watchdog 与 listener 已被替换并确认为一条权威进程链。另有一项独立安装器后续：强制轮换 launchd 时，脚本在 job 稳定可见前就输出成功，实际需要显式 bootstrap/kickstart；该可观测性问题不影响本次证据复用结论。
