# Ankh Guard 测试准入与诊断验收 — 2026-09-08

验收人：ankh-guard owner · 实现提交：`fdc57c5` · 本地基线：`main@17e0ce8` · 宿主线：`dsh-v0.1.1-rc.2`

## 环境

macOS，8 个逻辑 CPU，Node v22.21.1，pnpm 11.20.0。开发树 `fix/ankh-guard-gate-diagnostics` 与独立验收树 `codex/ankh-guard-gate-acceptance` 使用相同实现提交，各自安装依赖。只运行测试/构建/打包检查，未部署 tarball、修改 profile、重启 3080 或修改宿主源码。主 checkout 原有的 release-status 文档改动保持不动。

设计及取舍见 [Agent Note](../../.agents/notes/implemented/testing/2026-09-08-test-admission-and-lane-diagnostics.md)。本轮是在有其他 agent 工作的共享机器上进行，不是空载三次中位数基线。

## 逐项结果

| 项 | 判据 | 结果与证据 |
|---|---|---|
| 结构化统计 | 不丢掉失败分片中的通过数；缺报告/信号/非零退出必须红 | 四条新增回归通过；`1 failed \| 11 passed` 记录为 11 passed、1 failed、missingPassing=1 |
| 跨进程准入 | A acquired ACK → B busy → A released ACK → B acquired | IPC 握手测试通过，不用 sleep 猜重叠 |
| 根包过滤 | 选择、build、test 都排除 root 递归编排器 | gate spec 14/14；脚本总测试 105/105；实际 pnpm 全量选择列出 26 个包，不含 root |
| 包级验收 | build 与完整 umbrella 通过 | 194/194（64 unit + 130 integration） |
| 全量 gate | 不缩小范围、不忽略退出错误 | `pnpm gate --all`：11 步通过，577 秒；build 299 秒、test 204 秒、pack 52 秒；24 个可打包包验证通过 |
| gate 排队 | 后进入者等待，前者结束后继续执行 | 第二树 `pnpm gate --since HEAD` 等待 322770ms 后 acquired，8 步/36 秒通过；该命令验证无包变更 gate 的准入，不能当成第二次全仓测试 |
| 独立树完整 integration | 包含真实 watchdog、reclaim、preflight，不只跑 unit | 第二树首次显式 integration 130/130，通过时与第一树 gate 的构建阶段重叠 |
| lane 排队与全覆盖 | 两个独立树同时请求完整集成覆盖，后者等待但不能跳测 | 第一树 gate 内 umbrella 含全部 130 integration；第二树再次显式 integration 实际等待约 131 秒，随后 130/130；两份结果均无失败 |
| 最终清理 | 无活跃、超龄存活或不可读 lease；准入已释放 | reclaimable-dead=160、active-live=0、over-age-live-human-review=0、unreadable=0；准入目录无剩余锁文件 |

保留在 OS 临时目录中的主要证据（每个目录包含逐任务 stdout/stderr、Vitest JSON 与 summary.json）：

- `ankh-test-results-qzNa4H`：首次带诊断的失败现场。194 条断言通过，但 lifecycle-drift 因 `[vitest-worker]: Timeout calling "onTaskUpdate"` exit 1；同步真实 home 用例耗时 71.2 秒。不是 inventory 不足，也没有被误报成成功。
- `ankh-test-results-mBo6kV`：将长同步工作移出 Vitest 事件循环后，包级 194/194 通过。
- `ankh-test-results-KBaBQa`：全量 gate 内 194/194；lane 执行墙钟约 145 秒，最长 Vitest 分片 114 秒。启动时 load average 为 53.53/31.23/19.26，外部测试进程读数 21。
- `ankh-test-results-bsl629`：第二树首次 integration 130/130，执行墙钟约 196 秒。
- `ankh-test-results-hvfKrv`：第二树排队后的 integration 130/130，执行墙钟约 160 秒，不含排队时间。第一树 lane 于 11:37:26.249 UTC 完成，第二树基线于 11:37:26.528 UTC 记录。

这些数字区分了排队时间、lane 墙钟、最长分片、全仓测试阶段与整个 gate，不能互换或拿单次高负载结果宣称性能提升。160 条 reclaimable-dead 是保留的死记录，不是存活进程，也不是监听者。

## 卡住的地方与边界

- 首次记录上述本地验收时尚未合并 main、未 push。共享 gate 改动与包内改动同在实现提交中；未更改 CI 或其他包的 worker 配置。随后经用户明确要求完成合并与部署，见下节。
- 历史三次 `190 → 178/163` 缺少逐任务原始证据，仍不能断言是哪条测试失败、是否 OOM。已证明旧正则会把失败优先的整片汇总漏算；另独立捕获并修复了一条同步阻塞/RPC 错误路径。
- 准入只协调新版 gate 与 lane。旧 worktree、直接 Vitest、独立 build、其他程序仍可能争用资源；崩溃持有者留下的准入锁需要先审计后代，再人工处理，不自动杀进程或回收不明所有权。
- 未复跑冷装 CI 或 npm 发布。没有将集成覆盖移出 gate，也没有自动重试失败测试。
- checkpoint 审计发现明确的 web-eval 重启脚本调用点，使用 profile 安装的 CLI。当前源码的 clean checkpoint 不创建新提交，dirty checkpoint 需显式授权；历史空提交不能证明是现版 watchdog 自动提交。本轮不改生产 checkpoint 协议，不更新安装产物。

## 后续合并与 3080 部署

用户确认后，main 从 `17e0ce8` 快进至 `f134afd`，完整包含实现 `fdc57c5` 和本报告。没有 push；主 checkout 原有的 release-status 文档改动保持不变。

部署前备份了旧 tarball 与 profile package.json、pnpm-workspace.yaml、pnpm-lock.yaml；移走旧 lib 后，从 main 干净构建，通过规定的 `pnpm deploy:3080 --package packages/ankh-guard --initiator ankh-guard-owner` 完成部署。流程耗时 155 秒，main 上 194/194 通过，composition preflight PASS，随后按闸重启及 canary PASS。profile 引用 `khorsheed-dsh-ankh-guard-0.1.1+2609081151.tgz`，不是 link；旧包保存在本次私有部署备份中，部署工具清理的旧时间戳 tarball 可以由此恢复。

2026-09-08 19:51（Asia/Shanghai）的实机结果：

- 宿主 listener PID 从 1932 变为 78304，supervisor direct child 为 78295；所有权稳定窗口 3 秒，retry=0。
- 19:51:38 ready，19:51:39 canary PASS 并记录 deployment proof；后续 HTTP `/` 为 200。
- `check-env` 显示 launchd 监督 watchdog PID 1904，skill 注册记录为成功。
- CLI、插件入口、preflight runner、watchdog 脚本的安装字节与 main 构建产物 SHA-256 全部匹配。
- 宿主 checkout 仍为官方 `dsh-v0.1.1-rc.2`，没有修改宿主源码或启动配置。

本轮代码改动是测试工具及 gate，不改变发布的运行时代码；部署前比较也已证明线上 CLI、入口与 watchdog 和本轮版本一致。因此保留已有 watchdog PID 1904，仅让其按协议重启宿主，不能把这次描述为“替换了新版 supervisor 进程”。测试排队的效果在仓库新入口中验证；浏览器界面没有对应的新功能。生产会话中的手动 skill 调用/自重启体验交由用户继续验证，本次未为验收创建模型会话。
