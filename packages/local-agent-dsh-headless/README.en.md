# @khorsheed/dsh-local-agent-dsh-headless

English | [中文](README.md)

The interface-less DSH behind 「本机 DSH 委派」 (Local DSH Delegation). You never install it yourself: it comes along automatically with the 「多Agent协作」 (multi-agent) suite or the Dev Suite.

## What it is

A headless DSH composition: the caller names the session id, it runs the task, prints the final answer to stdout, and exits; with `--serve` it stays up and takes work round after round. `@khorsheed/dsh-local-agent-dsh` uses it to start "the second DSH" and to continue the same session in later rounds.

Unlike the official `@deepseek-ai/dsh-headless`, the caller passes the session id with `--session-id` / `--resume`, and the output never carries a session marker. For account delegation, it also receives the parent's launch grant through the official account service without writing it to the child credential store.

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # new
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"        # continue
dsh --profile headless-local-agent-dsh --serve                               # resident
```

## Notes

- Don't add it to an interactive profile: its configuration is meant only for the sub-DSH, would leak into real sessions, and fails loudly at boot.
- Installing it directly with `dsh plugin add` mounts nothing; install it through `@khorsheed/dsh-local-agent-dsh`, which prepares the sub-profile for you.

## Compatibility

Needs DSH 0.2.2-rc.1 or later. Account delegation needs 0.2.2-rc.2 or later; API-key delegation still supports 0.2.2-rc.1.

## For developers

- Command-line flags (`--model` / `--effort`), the resident-mode wire protocol, and what the sub-profile contains and why are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-dsh-headless/docs/reference.en.md); the protocol is defined in `src/wire.ts`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
