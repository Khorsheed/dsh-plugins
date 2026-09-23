# Agent Note: pack-dist 保留 `dsh.runtimeDependencies`（不打进包体的运行时依赖随包发布）

Status: implemented

## Problem

`@khorsheed/dsh-capture` 在生产实例上对每一次渲染请求都回答 `Cannot find package
'@puppeteer/browsers'`（2026-09-21，「渲染抓取」的第一次真实点击）。这个包刻意不把
puppeteer-core / @puppeteer/browsers 打进 lib——它们通过运行时动态 import 消费——但
`pack-dist` 的 `rescopePackageJson` 会把整个 `dependencies` 段丢掉，依据是既定假设：
运行时依赖要么打进 lib，要么由宿主组合提供。结果单测全绿、tarball 上线、装好的插件
一个 verb 都跑不了。

## Decision

包通过一个新的 manifest 字段 `dsh.runtimeDependencies`（名字数组，每个都必须真实存在于
`dependencies`——写了不存在的名字会在打包时抛错）把特定运行时依赖带进 dist 清单。列出的
条目在 `rescopePackageJson` 里原样保留（名字和 range 都不动）；`dependencies` 里其余条目
仍按"打进 lib"的假设丢弃，family 边维持原有改写。`@khorsheed/dsh-capture` 声明
`['@puppeteer/browsers', 'puppeteer-core']`。

"运行时依赖打进包体"仍是默认：这个字段是给刻意不打进包体的依赖用的（大型自动化运行时、
原生模块），不是普通 import 的第二条声明通道。

## Alternatives considered

**把 puppeteer 打进 lib（tsdown alwaysBundle）。** 否掉：puppeteer-core +
@puppeteer/browsers 是 MB 级的自动化设施且自带依赖树，打进包体会把一大块第三方面藏进
一个本仓库默认透明的产物里；而且下一个打不进包体的依赖（原生模块）还是要走清单这条路。

**dist 清单保留全部 `dependencies`。** 否掉：与包体内已打包的内容重复声明，制造包体与
安装两套版本的错位，还模糊掉"默认打进包体"这条让 tarball 诚实的契约。

## Consequences

- dist 清单重新可以携带真实运行时依赖——安装侧（profile `pnpm install`）会解析它们，
  运行时动态 import 因此可用。
- `scripts/pack-dist.spec.ts` 双向钉住（原样保留；未列出的丢弃；名字不在 dependencies
  里则抛错）——红先验证过。
- 修复后 capture 在生产上的第一次渲染必须确认 profile 真的解析到了 puppeteer（即本次
  事故的复现路径）。
