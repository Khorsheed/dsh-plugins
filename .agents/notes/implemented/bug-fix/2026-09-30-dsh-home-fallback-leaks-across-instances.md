# Agent Note: the `.dsh-official` home fallback leaked one instance's managed state into another

Status: implemented

English | [中文](2026-09-30-dsh-home-fallback-leaks-across-instances.zh.md)

## Problem

`capability-catalog`'s `dshHome()` (src/index.ts) and `local-agent-dsh`'s `defaultPresetRoot()` (src/provision.ts) resolved the harness home as `settings.home ?? $DSH_HOME ?? ~/.dsh-official` — the final fallback hardcoded to this machine's official-checkout home, written when the packages were born and the dev home was `.dsh-official`. On the desktop app neither input exists (its settings service reports no `home`, and `DSH_HOME` is not in the app's environment), so the desktop instance silently read the 3080 server's home: the desktop 工具与技能 section listed 3080's three preset-scoped managed skills as "3 个受管 skill 未在任何模式生效", looking exactly like the two instances shared configuration. The bug was invisible on 3080 itself because the launch spec sets `DSH_HOME=~/.dsh-official` explicitly — the fallback never fired where it would have been wrong.

## Decision

Both call sites now mirror the official precedence of `resolveDshHome` (`@deepseek-ai/dsh-home-paths`): the configured home, then a **non-blank** `$DSH_HOME`, then the `~/.dsh` installation default. A blank/whitespace `DSH_HOME` is treated as unset (official semantics), which the old `??` chain also got wrong.

## Alternatives considered

**Depend on `@deepseek-ai/dsh-home-paths` and call `resolveDshHome`.** Not taken: the inlined precedence is a few lines, the `.dsh` dir name is frozen by every existing install, and a new official edge adds peer-resolution surface in profile installs for zero behavioral delta. If the official default ever moves, the seam-registry upgrade audit is where we notice.

**Derive the home from the active profile path.** Rejected: a plugin has no reliable handle on the profile dir, and the home is not guaranteed to be its parent.

## Consequences

- Desktop instances now resolve `~/.dsh/capability-catalog/skills` — empty until the user imports there — so the phantom banner is gone. Nothing migrates: the three writing skills were always 3080's files, created through 3080's catalog, and stay in 3080's home.
- 3080 is unaffected (its `DSH_HOME` comes from the launch spec); dev checkouts with `DSH_HOME` set are likewise unchanged.
- Accepted divergence: `~`-prefixed `DSH_HOME` values are still not expanded here (the official helper expands them). No known caller relies on it; recorded so a future reader doesn't "fix" it blindly.
