# Agent Note: 受管 skill 投递保留 frontmatter metadata 块

Status: implemented

## 问题

把 skill 收进 capability-catalog 的受管根（按 preset 限定投递）会静默丢掉 frontmatter `metadata:` 里除 `presetScope` 外的所有 key。磁盘文件没有问题——收养逐字拷贝 bundle、只改 `presetScope` 一行——但投递的内存投影（`candidateFor`）把 `metadata` 从零重建为 `{ presetScope }`。声明了 `metadata.credentials` 的 skill（weread-skills 声明 `WEREAD_API_KEY`）在被限定的那一刻就丢了详情弹窗里的凭据表单：catalog 读到的是投递出来的定义，找不到声明，于是退化成把该 key 列成只读的环境变量引用。

## 决策

`managedSkillFrom` 用 js-yaml 解析整个 `metadata:` 块（仓库的 YAML 惯例——local-agent-dsh 与 eval 以同样方式携带，经 `dsh.runtimeDependencies` 留在发布清单里），挂在受管记录上；`candidateFor` 把归一化后的 `presetScope` 叠加到该块上，而不是重建。只解析该块自身的行：块解析失败时降级为无 metadata（skill 照常投递），而不是拒绝一个行式读取器本可服务的文件。`loadSkillDetail` 的受管回退读的是同一个投影，因此两条读取路径下凭据表单都能在收养后存活。

## 考虑过的替代方案

**按已知 key 做行式提取。** 不采用：`credentials` 是嵌套列表，且该块是开放的（插件可以加自己的 key）；按 key 形状写正则等于写了半个解析器。

**对整个 frontmatter 做 YAML 解析。** 不采用：行式读取器接受一些严格 YAML 解析会拒绝的文件，一个宿主仍能服务的 skill 不应因一个无法解析的 metadata 值而变得不可投递。

## 影响

限定投递不再改动 skill 声明中除 scope 列表以外的任何内容；已声明的凭据以及未来的任何 metadata key 在收养后原样保留。代价是引入一个运行时依赖（`js-yaml`）。测试钉住了保留行为、坏块降级，以及凭据表单在受管详情读取中存活。
