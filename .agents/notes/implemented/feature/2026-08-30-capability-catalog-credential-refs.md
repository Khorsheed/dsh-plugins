# Agent Note: capability-catalog skill credential display separates metadata creds from env refs

Status: implemented

English | [中文](2026-08-30-capability-catalog-credential-refs.zh.md)

This note records the credential-display redesign in `@khorsheed/dsh-capability-catalog`'s skill detail modal, shaped by a code-review conversation (Codex).

## Problem

The skill detail modal's 凭据配置 section built its credential roster by merging TWO sources: `metadata.credentials` (explicitly declared) and env-var references scanned from the skill body (`$X` / `process.env.X` / `{{env:X}}`). For `dsh-self-restart-guard` the body references `$DSH_HOME`, `$GUARD`, `$DSH_SESSION_ID`, so the modal offered `DSH_HOME` as a user-configurable credential and even showed it 已配置 — because `DSH_HOME` is already set in the agent's own environment. These are the agent's runtime inputs, not user secrets, so presenting them as a configurable credential form (badge + masked input + Save) was misleading.

## Decision

**`metadata.credentials` is the only authoritative source of user-configurable credentials.** Body-detected env refs are surfaced separately as read-only, collapsed, informational — never as credential forms.

- Data model (`types.ts`): `CatalogSkillDetail` gains `environmentRefs?: readonly string[]`.
- `loadSkillDetail` (`skills.ts`): builds the editable `credentials` array from `metadata.credentials` only; the env-derived keys go to `environmentRefs`.
- Modal (`SkillDetailModal.tsx`): the 凭据配置 form renders only `data.credentials`; a new collapsed 引用的环境变量 `<details>` lists `data.environmentRefs` as read-only chips with a hint that these are provided by the runtime/caller and cannot be configured here.
- Locales: added `envRefs` / `envRefsHint` (zh + en). `credentialsHint` is unchanged because it now only ever describes declared metadata credentials.

## Alternatives considered

- **Keep the merged roster but relabel derived refs.** Rejected: merging loses provenance; the modal cannot reliably tell a declared secret from a body-scan env ref once combined.
- **`origin: 'metadata' | 'body-env'` on each credential state.** Considered; the separate `environmentRefs` array is simpler for consumers and keeps the `CredentialField` form untouched.
- **Try to filter shell-local vars (e.g. `GUARD`) out of the refs.** Rejected for this pass: `$GUARD` is indistinguishable from a real env var via Markdown regex, and the read-only chip list frames them honestly as "referenced variables" instead of a sound—but not practically achievable—perfect filter.

## Consequences

- The agent's own runtime env (DSH_HOME, DSH_SESSION_ID, GUARD) no longer shows 已配置 / a Save form; it is a read-only reference list. Declared secrets keep the full `CredentialField` form (badge + masked input + Save).
- `shellEnv`/`envHint` are unchanged — they still inject/alias `$DSH_<KEY>` env vars for auto-detected refs so the model can read them; only the UI display changed. A later compatibility audit could narrow those to explicit declarations only.
- Build + 68 host-side tests + `check:plugins` green; no component tests exist (verified by deploy smoke).
