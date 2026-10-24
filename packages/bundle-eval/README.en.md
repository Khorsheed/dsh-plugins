# @khorsheed/dsh-eval-suite

English | [中文](README.md)

A mode for comparing coding agents on your own computer: Kimi, Codex, Claude Code and DSH work the same set of problems under the same conditions, and the results sit side by side.

Finding out whether a kind of job is better handed to Codex or Claude Code used to mean opening terminals one by one, feeding in problems by hand, and comparing from memory; run it again with another model and the earlier conditions no longer matched. In eval mode, tell the agent which problem set to use and who to compare, and it drafts the experiment for you; once you start the run, it hands each problem to the right tool, collects the answers, scores them, and records every step. In the end you get one row per problem, with both scores and the gap between them side by side.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-bundle-eval-hero.png" width="640" alt="An eval-mode session: the Experiments page on the right comparing an experiment's results, one row per problem with both groups' scores and the difference side by side">

## Things you can say to the agent

- "List the registered problem sets. How many problems does each have?"
- "Draft an experiment comparing Codex and Claude Code on this set, same model, one run each."
- "Turn the problems in this folder into a problem set, check it, then submit it for registration."
- "Read the last results and write a first draft of the analysis."

## What's inside

- **Datasets**: the "Datasets" page. Once a problem set is registered its version is fixed and it's read-only, so every comparison uses exactly the same problems.
- **Eval**: the "Experiments" page. Walk from designing the experiment through run records and result comparison to human review; every run of every problem is logged, and you can export it to double-check.
- **Lab**: when you want each tool to work in a clean environment, it gets its own Docker container.
- **Your local coding tools** (Kimi, Codex, Claude Code, plus Local DSH Delegation, off by default): these are what you're comparing.

The agent can draft experiments, tidy problem sets and write the analysis, but starting a run, approving a registration and giving the final scores are up to you. A run keeps going in the background even if you close the session. In human review the answers to a problem sit side by side with no hint of which tool wrote them, and when there aren't enough samples, the report says plainly that it won't rank.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-eval-suite
```

It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files. Then start a new session, pick "评测模式" (eval mode), and tell the agent what you want to compare.

All of this only shows up in eval-mode sessions; not seeing it in other modes is expected.

## Known limitations

- Running in containers needs a working Docker on your computer; without it you can still run directly on the machine. You prepare the eval images yourself.
- The tools being compared have to be installed and signed in by you; this suite doesn't do it.

## Compatibility

Needs DSH 0.2.0 or later; verified on 0.2.1.

## For developers

Command-line install (same result as above):

<!-- collection:start -->
Recommended: install it together with the basic suite (the Eval collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

- This package has no features of its own; it installs eval mode and the members above together. Uninstalling (`dsh plugin --profile web remove @khorsheed/dsh-eval-suite`) removes them together too; to turn off just one, switch it off on the suite's detail page.
- Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
