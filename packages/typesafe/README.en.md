# @khorsheed/dsh-typesafe

English | [中文](README.md)

The small calls a Room has to make — "merge this?", "tell you now or wait?" — made quickly, and on the record.

You've handed out several jobs in a Room and drop in a quick remark: is it adding to one of those jobs, or a new one? Members hand results back one by one: should you hear about each as it lands, or all together once they're in? These used to follow fixed rules. With TypeSafe installed, when no clear rule applies the Room asks it, gets an answer in about a second, and either files your remark under the right task or holds results to report together. Every call is recorded: open the 「房间」 (room) tab in Context Lens to see what was asked, the probability of each option, and the conclusion.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/typesafe-1.png" width="640" alt="Context Lens's room tab on one automatic task-filing decision: decision model jev-1.14.0, the state sent to the model, the fixed question, candidates and probabilities (task 18 at 0.99, new at 0.01), and the conclusion: merged into task 18">

## What it does

- **Your follow-ups land on the right task**: when you send a Room a message that names no task, it decides which job you're adding to, or whether it's new.
- **It decides when you hear about results**: as a member's result comes back, it decides whether to report now or wait for the others, so you aren't interrupted line by line.
- **Every decision can be checked**: Context Lens's room tab shows what it was sent, the question, each option's probability, and the conclusion.
- **You set the switches and the balance**: under Automatic decisions in the Room's settings, turn Automatic task filing and Automatic report timing off separately, or adjust the Report-now threshold.
- **Nothing stalls without it**: if it isn't installed, has no key, or can't be reached, the Room carries on — new messages count as new tasks and results are reported as soon as they arrive.
- **The dev-mode agent can use it too**: in "开发模式" (dev mode), the agent can ask it directly when it needs a quick call on a small question.

## Install

In DSH, open Plugins → Add plugin, enter the package name below, and click install:

```
@khorsheed/dsh-dev-suite
```

TypeSafe comes with the Dev Suite, the Gamedev Suite, the Video Suite and 「多Agent协作」 (multi-agent), so the room in any of them can use it right away.

Then add a TypeSafe API key: in dev, game dev or editing mode, open Settings → Tools & Skills, find the skill `typesafe-decide`, and enter it under Credential config; or put a line `TYPESAFE_API_KEY=…` in `$DSH_HOME/.env` and restart DSH.

## Known limits

- Decisions need the network: what a decision uses (your latest message, the list of open tasks, or members' report progress) is sent to TypeSafe's service.
- The settings-page key field only appears in dev mode; in other modes use the `.env` route.
- Its answers are probabilities, not guarantees; if it calls things wrong, switch the relevant option off or raise the Report-now threshold.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- It provides the host service `ctx.get('typesafe')` (`judge` / `decide` / `health`, never throws); the model tool `typesafe_judge` ships in the package's `./tool` entry and is granted per mode. The service API, the named-question registry, config fields, key resolution, and internals are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/typesafe/docs/reference.en.md).
- Entry points: `src/index.ts` (the service), `src/tool.ts` (the model tool), `src/wire.ts` (the dsh-free wire layer). The Room's calls live in `packages/room/src/decisions.ts`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
