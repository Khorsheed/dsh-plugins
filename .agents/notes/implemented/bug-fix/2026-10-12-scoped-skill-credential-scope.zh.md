# Agent Note: 凭据提示与注入越出 catalog 自身的 scope 读取

Status: implemented

## 问题

catalog 有两处读取把 catalog 的设置面 scope（默认 preset 的 standing scope）当成了读者的视野。在[按 preset 限定投递](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md)存在之后，被限定到非默认 preset 的 skill——weread-skills 限定到学习模式——在该 scope 下不可见，于是：(1) `skill` 加载时的环境变量提示对它从不触发（模型从未被告知它已配置的凭据存在）;(2) shellEnv 贡献者的刷新从来看不到它声明的 key,`DSH_WEREAD_API_KEY` 从未被注入到任何地方。在 3080 上的实际表现：一个已配置、已投递、可加载的 skill，模型却回答「key 没有设置」。

## 决策

环境变量提示在**调用方**的 scope 上读取被加载的 skill(`exec.agent`——与 `skill` 工具自己的读取位置相同），仅当执行上没有 agent 时才回退到 catalog scope。shellEnv 贡献者另外直接扫描受管根（`scanManagedSkills` + `definitionFor`)，把按 preset 限定的 skill 所声明的 key 并入注入集合，与注册表快照那一路并存。

## 考虑过的替代方案

**遍历 roster 的每个 preset 并合并快照。** 不采用：提示路径会多出 roster 耦合，而调用方 scope 才是唯一诚实的读取位置；注入路径则由受管根扫描恰好覆盖限定投递的缺口，无需枚举 preset。

**把注入的变量按执行 scope 隔离。** 不采用，代价与目的不成比例：preset 范围是发现/投递策略，不是机密边界（投递模块的文档注释明写），且变量值只有在命令主动打印时才离开环境。

## 影响

被限定到任何 preset 的 skill 现在都能在加载时拿到凭据提示，其 `DSH_<KEY>` 注入也是全实例生效。刷新链路引入了真实文件读取，shellEnv 规格里的微任务冲刷因此换成墙钟 `settle` 辅助；两个假定时器的启动窗口测试先用假时间推进重试，再切回真实时间等待落定。
