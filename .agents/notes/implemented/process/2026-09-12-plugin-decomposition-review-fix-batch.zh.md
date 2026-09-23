# Agent Note:插件拆分复审批次 —— 三个阻塞项与一次 mainline 撞车

Status: implemented

## Problem

四份 Codex 审查(本地 agent 家族、file-preview、datasets/eval 线)给出了必修(P0)与排期(P1)清单。
本批实现完毕后回到**同一批审查者**做修复验证,却被打回三个阻塞项:

1. 让 local-agent 拆分成立的那条契约没有任何东西冻结。文档写着 provider 的 patch 绝不能重插 core 行
   (装两个 provider 就会把 core 行挂两次),但 `packages/local-agent/tests/patch.spec.ts` 只读 core 自己的
   patch —— provider 真去重插 core 行,全部检查仍然全绿。
2. `check-plugin-independence` 只校验包**声明了**哪些 `dsh.references`,不校验反方向。core 把声明删掉、
   而它的 client bundle 仍然带着伴生行的模块名时,只有打包阶段会发现,`pnpm check:plugins` 依旧放行。
3. WP8 的最小交付集没落地:根 README 还写着 26 个包(24 自挂载 + 另外 2)而树里是 32 个;协议文档
   把 `dataset-authoring` skill 写成"随 datasets 包分发";`release-status.ts` 去读一个通常不存在的
   sibling checkout;"这个包为什么没有 patch"只活在一份手工维护的目录名单里。

本批进行期间,mainline 已用 **`dsh.references`**(而非本分支的 `dsh.composition.gateRefs`)**独立**
落地了同一条反向边修复,顺带修了本分支也修过的脚本 spec 超时。同一个事实不能有两套元数据。

## Decision

- **采纳 mainline 的机制。** 本分支丢弃 `dsh.composition.gateRefs` 与两个重复的超时提交,rebase 到 main。
  四处冲突按**合并双方语义**解决而不是二选一:mainline 的"跨包边单向、纯数据提及写进 `dsh.references`"
  与本分支的"npm 依赖只保证模块可解析、不挂载行"两条契约都留在 `AGENTS.md` 与 `pack-dist` 注释里。
- **把 patch 归属冻结成全仓规则,而不是逐家族规则。** `check-plugin-independence` 现在拒绝任何
  "为另一个自挂载包插入行"的 bundle patch(`patch row ownership`)。local-agent 的 spec 另外从树里
  自动发现家族成员,逐个断言 provider 只挂自己的行、不挂任何自挂载包的行,并用一条注入的 core 行
  证明该断言真的会失败。
- **用证据闭环数据引用,不要中央名单。** 每个声明的 `dsh.references` 必须是真的本仓包、且不得与依赖边
  重复;包**自身源码**里出现的兄弟包名(剥掉注释后)必须已声明为边或引用。删掉声明现在会让
  `pnpm check:plugins` 失败,而不只是打包失败。
- **用组合元数据取代名单。** 七个刻意不自挂载的包声明 `dsh.composition.component`
  (`preset-composed-row` ×5、`provider-mounted-row`、`sub-profile-patch`),检查器改读 manifest;
  `NO_OWN_PATCH` 降为交叉校验,二者不允许漂移。
- **包地图改为生成。** `pnpm map:packages` 从 manifest 生成 `docs/packages.md`(计数、形态、组件、浏览器
  半边、`minHost`、profile 归属),`pnpm check:packages` 进 gate,手工计数不会再腐烂。
  `release-status.ts` 改读本仓 `profiles/web-basic`。
- **HTML skill 的归属。** `3d-artifact` 从 file-preview 迁到 inline-html-render(它真正的主题),
  两个 skill 都由该包以 `provider: 'inline-html-render'` 注册。
- **浏览器半边要有证据才安装。** `ui-file-preview` 只有在 host 半边回应零会话 `capabilities` 探测后
  才安装 UI 面;host 缺席 = 所有面缺席 —— 不留错误卡、不留空 tab、不新增 locale 文案。

## Alternatives considered

- **两套元数据并存**(`gateRefs` 与 `references`)——否决:同一事实两个名字正是本次审查要消灭的漂移,
  而且只能有一个成为文档化约定。
- **保留一份"必须声明引用"的中央名单** ——否决:名单必须与树同步维护,这正是要修的失效模式。
  包自己的源码就是证据,规则因此不需要名单;剩下的名单降级为交叉校验。
- **只做 local-agent 的回归测试**(审查者 A 给的"最小修复")——采纳并实现,但不作为唯一防线:
  A 自己给的更强建议(通用规则)才能覆盖下一个 provider 与另外四对 core/companion。
- **用 `--offline` 重生成 `docs/release-status.md`** ——否决:那会把占位符写进每一行的已发布列。
  这里 `npm view` 失败只是因为沙箱里 `~/.npm` 不可写;把 `NPM_CONFIG_CACHE` 指到工作区就拿到了真实版本。

## Consequences

- 检查器在两个方向上更严,且不需要新名单:既不自挂载又不声明组件的包会失败;挂载兄弟包行的 patch 会失败。
- `NO_OWN_PATCH` 从"权威"变成"与元数据互为镜像",随历史 Agent Note 不再被引用而逐条退休。
- `docs/packages.md` 过期即 gate 失败,因此任何改变形态 / 组件 / 客户端半边 / profile 归属的 manifest 改动
  必须在同一个提交里重新生成。
- WP9(把三个客户端包改名为 `@khorsheed/dsh-client-ui-*`)刻意留在本批之外:它需要与 mainline 协调
  lockfile 窗口,拆出去能让本分支保持可合并。

## Testing

- `pnpm gate` 检查点 A(rebase 前,12 步)与检查点 B(rebase 后,跑在 mainline 的代码上)均通过;
  逐项表与环境限制(无可交互 Docker、agent 沙箱内无 `/bin/ps`)见
  `docs/acceptance/plugin-decomposition-review-fix-batch-2026-09-12.md`。
- `pnpm test:scripts` 覆盖新规则:注入兄弟包行的反例、删掉声明的反例、元数据与名单的交叉校验、
  包地图渲染与 `--check`、以及 prerelease 数字比较(`rc.10` > `rc.6`)。
- 审查者 A、C 的裁定(冻结区间 `cf8f663..a0fa7c6`)见
  [审查者 A](../../../../docs/acceptance/plugin-decomposition-review-A-round2-2026-09-12.md) 与 [审查者 C](../../../../docs/acceptance/plugin-decomposition-review-C-round2-2026-09-12.md);他们提出的阻塞项对应提交
  `test(local-agent): freeze the provider patch contract`、
  `fix(scripts): make the family data-reference loop self-closing` 与三个 WP8 提交。
