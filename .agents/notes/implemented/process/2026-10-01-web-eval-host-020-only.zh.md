# Agent Note: web-eval 只支持宿主 0.2.0 及以后

Status: implemented

## Problem

web-eval pack 是在宿主 0.1.5-rc.1 上建起来、验收过的。它的 `eval` agent 预设是一个目录（`presets/eval/{agent.cordis.yml,preset.yml}`），由安装脚本复制到 `$DSH_HOME/.agent-presets/eval`；pin 写的是 `agent-presets.default: eval`。宿主 0.2.0 把这两样都去掉了：预设改成声明式 `@deepseek-ai/dsh-agent-preset` 行，默认值落在 `agent-preset-registry` 行上。0.2.0 工具链里有 `dsh-agent-preset` 和 `dsh-agent-preset-registry`，没有 `dsh-agent-presets`。所以 pack 在 0.2.0 上起来时不带自己的预设——而这个预设正是冻结决策 12 的执行点（评测 agent 不挂 shell、不挂容器控制）。这条线的真实数据还在 `~/.dsh-lab` 上的 3171 实例里，跑在 0.1.5 上。

## Decision

用户 2026-10-01 定（T82）：**web-eval 只支持宿主 0.2.0 及以后**，不做双线，不留目录式预设。

- **预设 bundle。** pack 的 `presets/` 是 profile 内的声明式 bundle：包名 `@khorsheed/dsh-web-eval-preset`，`private`，`dsh.bundle.kind: 'preset-declarations'`，顶层只有一行 `preset-eval`（`@deepseek-ai/dsh-agent-preset`，`id: eval`，显示名「评测模式」）。profile 以 `file:presets` 依赖它，并把它列进 `dsh.profile.bundles`。
  - 它的 `plugins:` 块与最后一个目录版逐字节相同（8fe63e72 处 sha256 `ee5e6f48…`）。
  - `scripts/web-eval-preset-bundle.spec.ts` 钉住这个摘要、唯一的那一行，以及组成里没有能跑宿主命令的行。
- **默认值 pin。** profile 的 `cordis.patch.yml` 钉 `agent-preset-registry.default: eval`，`agent-presets` 那条 pin 去掉。
- **安装闸门。** `dsh --version` 低于 0.2.0-rc.2 时，`install.sh` 和 `update.sh` 在写任何东西之前就以退出码 2 退出，并给出 `~/.dsh-toolchains/rc-0.2.0-rc.2`。
  - 源码模式还拒绝低于这条线的 `DSH_HARNESS` 检出，因为 typert 生成读的是它。
  - 往 `.agent-presets` 复制预设及其备份的逻辑都删掉了。遗留的 `$DSH_HOME/.agent-presets/eval` 只打一行可删提示，脚本从不替人删。
- **兼容性。** eval、eval-tool、datasets、datasets-tool 的 `dsh.compat` 中 `minHost` 与 `verifiedHost` 都是 0.2.0-rc.2，两份 README 的「兼容性」节写的同一件事。web-eval 的两份 README 新增「兼容性」节，「安装」里写明 0.2.0 宿主线，dump 计数改为 25 个名字（22 个 bundle、`local-agent-dsh-headless`，以及预设点名的两个伴生工具行）。main 的 README 写的是 23（按 0.1.5 时代目录式预设的组成数的）。合入 main 后，用合并后的源码在新临时 home 上 `--source --fresh` 重装，实测是 25 个名字、205 行。合并前后两边的 `UNPUBLISHED_DIRS` 完全一致，文档里写的是实测值。

### 受试 dsh 跟着实例走

`local-agent-dsh` 钉的是 `cliLaunch: [dsh]`，所以受试 CLI 从哪来取决于轮次：

- **宿主轮**在实例进程的 PATH 上解析 `dsh`。0.2.0 临时实例上就是 0.2.0-rc.2。
- **容器轮**用镜像里的 `/opt/dsh-headless`。

条件里没有任何字段能指定工具链。按用户 10-01 的规则（「跟实例走，就加 0.2.0 条件、保留旧条件」）：

- **新条件。** `dsh-lean-0.2.0-rc.2` 与 `dsh-full-0.2.0-rc.2`（作用域 `d-*-020rc2`，`home.sha` 在 provision 前为 null）放在题库分支 `t82-host020`（b40ab01），未合入。
- **旧条件保留。** 0.1.5-rc.1 的条件和用到它们的实验原样不动。

决定切换怎么做的三条观察：

- **核对顺序。** provision 先查凭据，再做有效配置核对。没有凭据时停在 `CREDENTIAL_ABSENT`；`harness.version` 不符只是一条排在后面的警告。
- **旧锁。** 条件页不重探，把旧锁（CLI 0.1.5-rc.1）显示为就绪。run 报告只记录委派的 cliVersion，不与条件比对。
- **dsh 开关。** 0.2.0 上 dsh provider 只在易失字段 `enabled` 为 true 时注册，默认是 false。0.1.5 把这个开关存在旧版设置文件里；0.2.0 在启动时一次性导入 `$DSH_HOME/settings.yaml`。开关打开之前，provision 报 `unknown harness dsh`。

### 3171 数据试迁

3171 的 `state/{eval,datasets,mission}` 以只读方式复制进一个临时 home（`/private/tmp/dsh-t82-home`，端口 3185），并与 3171 核对：结果 23 行、数据集注册表一致、`diff -rq` 为空。正式切换的步骤写在 web-eval README 的「把 0.1.5 实例切到 0.2.0」里，停实例由人手动做。步骤只写，未执行。

有两样没有迁，因为权限层拒绝了复制：

- **会话**（个人数据）。
- **旧版设置文件**（与凭据相邻）。

所以切换步骤改为在界面里打开 DeepSeek 委派，或由用户自己放入设置文件走一次性导入。

## Alternatives considered

**双线（0.1.5 与 0.2.0 并行）。** 也就是 pack 为 0.1.5 保留目录式预设、为 0.2.0 加 bundle，安装脚本按 `dsh --version` 分支。否决，四条理由：

- **两套组成。** 两个宿主组装预设走的是不同契约：按 home 扫描的目录名册，对比声明式行。装置会存在两份，而一个逐字节等价 spec 在一个检出里只能守住其中一份。
- **验收翻倍。** 每一轮验收（a–e、T86 与 T87 重拍、两种宽度）都得在两个宿主上各跑一遍。
- **代码早已双线。** 家族代码里已经背着 0.1.5 分支（双名探测、typert 双形编解码、`readOutput`），双线会把它们冻结在原处。
- **只有一个实例要搬。** 跑在 0.1.5 上的只有 3171，而它可以迁移。

用户 2026-10-01 选了只支持 0.2.0。包代码里的 0.1.5 分支暂时留着，清单见 Consequences。

**保留目录式预设，在 0.2.0 上也照样复制。** 否决：0.2.0 从不读 `$DSH_HOME/.agent-presets`。预设装上了但不起作用，每个会话都跑在随发行版的 `standard` 上，带着 Bash。

**把预设 bundle 单独发成 npm 包。** 暂不：这个预设是本 pack 装置的一部分，离开 pack 没有意义。profile 内的 `file:presets` 依赖让它和引用它的 pin 一起走版本。

**按条件钉受试 dsh CLI。** 也就是加一个指定工具链的条件字段。这超出 T82 范围（T82 不改 schema），而用户的规则是按版本另加条件。

## Consequences

**换来的：**

- 一套组成契约、一张验收矩阵。
- 安装在写下任何一个字节之前，就拒绝它服务不了的宿主。已在 rc-0.1.5-rc.1 工具链上实证：退出码 2，home 为空。

**付出的：**

- **旧宿主拿不到新版本。** 0.1.x 上的实例拿不到这个版本，要么迁移（README 里的步骤），要么停在旧发布线。
- **旧锁还在。** 它们照样显示为就绪。
- **版本跟着实例走。** 宿主跳版本之后，在条件重新 provision 之前，每一次 dsh run 测的都是新 CLI。

**后续**（代码里留下的旧宿主分支和缺口；不属于 T82）：

- **local-agent-dsh 的 `provision.ts`**（最要紧的一条）。`PRESET_ROSTER_MODULE = '@deepseek-ai/dsh-agent-presets'` 和 `USER_PRESET_DIR = '.agent-presets'` 按 0.1.5 的方式组装作用域 home 的预设。在它移植成声明式 `@deepseek-ai/dsh-agent-preset` 行之前，带预设的 dsh 条件在 0.2.0 上预计组不出来。原计划在凭据配好后实测确认。
- **eval 里仍按 0.1.5 写的代码：**
  - `sub-profile.ts`：`PRESET_ROSTER_MODULE`。
  - `preset-snapshot.ts`：`USER_PRESET_DIR`。
  - `job.ts`：0.1.5 的 `readOutput` 拉取路径。
  - `slash.ts`：`agentPresets` 探测。
- **双名探测与双形编解码。** preset-registry 的双名探测（380a469c）和 gen-typert 的双形编解码（00cfa1d6），在不再有 0.1.5 消费者之后可以退役。
- **界面。** DSH 委派卡片上显示一个没展开的 `{harness}` 占位符（local-agent-dsh 客户端的界面 bug）。

## Related

- [web-eval 的 agent 预设随 pack 分发](2026-09-08-web-eval-agent-preset.zh.md)。本 Note 取代它的目录形态，保留它的决策（冻结决策 12 的预设）。
- [评测 pin 归 pack](2026-09-07-web-eval-pins-belong-to-the-pack.zh.md)。
