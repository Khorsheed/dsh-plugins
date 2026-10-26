# @khorsheed/dsh-local-agent-dsh-headless

English | [中文](README.md)

The interface-less DSH behind 「本机 DSH 委派」 (Local DSH Delegation). You never install it yourself: it comes along automatically with the 「多Agent协作」 (multi-agent) suite or the Dev Suite.

## What it is

A headless DSH composition: the caller names the session id, it runs the task, prints the final answer to stdout, and exits; with `--serve` it stays up and takes work round after round. `@khorsheed/dsh-local-agent-dsh` uses it to start "the second DSH" and to continue the same session in later rounds.

The only difference from the official `@deepseek-ai/dsh-headless` is who owns the session id: here the caller passes it with `--session-id` / `--resume`, and the output never carries a session marker.

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # new
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"        # continue
dsh --profile headless-local-agent-dsh --serve                               # resident
```

## Notes

- Don't add it to an interactive profile: its configuration is meant only for the sub-DSH, would leak into real sessions, and fails loudly at boot.
- Installing it directly with `dsh plugin add` mounts nothing; install it through `@khorsheed/dsh-local-agent-dsh`, which prepares the sub-profile for you.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Command-line flags (`--model` / `--effort`), the resident-mode wire protocol, and what the sub-profile contains and why are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-dsh-headless/docs/reference.en.md); the protocol is defined in `src/wire.ts`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
