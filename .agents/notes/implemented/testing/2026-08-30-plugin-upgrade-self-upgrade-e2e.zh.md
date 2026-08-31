# Agent Note:plugin-upgrade 自升级 e2e —— 故意弄坏的 fixture 与不碰浏览器的驱动

Status: implemented

[English](2026-08-30-plugin-upgrade-self-upgrade-e2e.md) | 中文

## 问题

如何证明 plugin-upgrade skill 真的有效——一个只听到一句话的实例能把自己升级过宿主版本且不丢插件?一次活体验证需要:一个在新宿主上以已知方式损坏的插件、一个环境搭建器、以及带外断言。这些都不存在。

## 决定

`@khorsheed/dsh-plugin-upgrade` 在 `packages/plugin-upgrade/tests/e2e/` 下带了一套端到端验收装置(在 `files` 之外,永不发布):

- `fixtures/fixture-legacy-store/` —— 一个无构建、故意过时的插件。host 半面写日志并向 `$DSH_HOME/state/legacy-store-alive.json` 落标记(带进程 pid);浏览器半面手写 `window.__ModuleLoader__.load({id, factory})` 格式,硬 `require` `@deepseek-ai/dsh-client-runtime/client`——这是 0.1.1-rc.2 冻结模块表里有、0.1.2 删掉的一行。因此它在 rc.2 上正常,在 0.1.2 上 client 加载即炸,直到升级者修好它。fixture 以**损坏状态**入库——损坏就是测试输入。源码放在 `src/` 而非惯例的 `lib/`:仓库 hygiene 门禁禁止跟踪任何 `lib/` 段下的路径(那是构建产物目录),而这些文件是手写的。(client bundle 必须导出一个空 `apply`:浏览器侧 cordis runner 会把每个组合的 bundle 当插件 apply,exports 上没有 `apply` 会刷一条 console error,污染"零报错"基线。)
- `run-self-upgrade.mjs` —— `up | assert | cleanup`。`up` 搭一次性 HOME(软链官方 credentials、固定默认模型),组合一个 web profile:`dsh-base`/`dsh-web-app` 用 `file:` 指进 stable 工具链,外加 fixture 和 plugin-upgrade 的 tarball;在空闲 32xx 端口起 rc.2,验证就绪(HTTP 200 + 标记 + client.js),打印交接指引。它不驱动浏览器;由人或带 playwright 的 agent 发那句话。`assert` 带外验证升级:端口监听进程来自 alpha 工具链、fixture 标记的 pid 等于当前监听者(即在**新** boot 上重新 apply 过)、fixture client bundle 服务 200。`cleanup` 全拆。

## 首次实跑(rc.2 → 0.1.2-alpha.2,一句中文)学到的东西

实例内 agent 完成了整个升级:pull 式发现 skill,走 Phase 0-5,用双行兼容的 try/catch probe 修好 fixture,用 npm 把 profile 重指到 alpha,在空闲端口试启动 alpha 宿主,写交接笔记,拉起 supervisor,然后杀掉自己。四条断言全过。0.1.2 的两处宿主契约变化打破了 skill 和初版驱动共同的假设:

- **Web UI 现在有 token 门禁。**裸 `GET /` 返回 401;启动日志打印 `http://127.0.0.1:<port>/?token=...`,经 303 换 auth cookie。skill 的 supervisor 模板和任何要求 `/` 返回 2xx 的健康检查会把健康的 0.1.2 宿主误读为已死(agent 把它的 supervisor 健康探针改成"有应答即活",`assert` 也把 401 视为存活)。
- **插件 client bundle 只经启动清单的批量 URL 服务**(`/plugins/??<id>/client.js,...&rev=...`);rc.2 时代的单文件 `/plugins/<id>/client.js` 返回 404。`assert` 现在带 auth cookie 跟随清单,不再探旧 URL。

还有两个环境坑:macOS 没有 `setsid`(agent 用 Node 的 `spawn(..., {detached: true})` 重写了 `assets/restart-resume.sh`);无守卫的重启不会恢复在途回合——会话记录还在,但 agent 停在被中断的 kill 处,直到人推一下;交接笔记里的"第一句话"也只在推了之后才发出。

## 后果

- 本次跑出的六条改进候选已在后续改动中回填进 skill:任意 HTTP 应答即活的健康检查(Phase 5 + `restart-resume.sh` 的 `healthy()`)、面向无 setsid 平台（macOS）的 Node 版 `restart-resume.mjs`、breakage 清单新增浏览器资产 URL 契约条目、Phase 0 的 `~` 与实例 HOME 歧义提醒、试启动收编为 `assets/trial-boot.mjs` 并在 Phase 4 引用。（第六条——无守卫重启的恢复语义——由主线的 Phase 5-7 改写单独落地。)`tests/e2e/run-report.template.json` 冻结了指标口径，本轮数据存于 `run-report.v1.baseline.json`。
- v2/v3 扩展了这套装置：skill 变为纯目录形态（无插件壳——驱动改为装进 `$DSH_HOME/skills/`)；舰队形态（`--links <repoDir>` 把本地插件仓库克隆里的全部 bundle 链入，被测 agent 的改码→重建→重启循环没有打包往返；`--tarballs` 保留打包变体）;v3 断言覆盖每个带浏览器面的已装插件，以及服务产物与链入检出 lib 的新鲜度比对。全量舰队跑的数据存于 `run-report.v3.json`。
- v3 跑暴露并修掉的两个 rig bug:token 提取必须取宿主日志里**最后**一个 `?token=`（日志是追加的，只有最新一次 boot 的 token 有效）；第二会话断言应数**有内容的**日志（重启机器会注册一个零字节壳会话）。
- fixture 往 `main` 方向合并时必须保持损坏状态;在升级跑之外"修好"它就毁了这套装置。

## 否决的替代方案

- **把浏览器自动化塞进驱动脚本** —— 否决:playwright 浏览器是与其他 agent 共享的;驱动只打印那句话,操作留给执行者。
- **提交 agent 修好的 fixture** —— 否决:装置的价值在于损坏的初始状态;修好的版本记录在运行报告和实例的交接笔记里。
