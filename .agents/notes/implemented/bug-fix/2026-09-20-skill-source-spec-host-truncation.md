# Agent Note: Read a pasted source spec as a host plus a repo, not as `owner/repo`

Status: implemented

## Problem

Pasting the everyday browser URL `github.com/larashero3-dotcom/lieflat-charts` into **Add skill → Install from source** failed with

```
install failed: ... git clone --depth 1 https://github.com/github.com/larashero3-dotcom ...
remote: Repository not found.
```

which reads like the skill is unsupported. The spec was misread, twice over. `refToCloneUrl()` matched the `owner/repo` shape anywhere in the string (`/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/`, unanchored) and then kept only the first two segments (`const [owner, repo] = ref.split('/')`), so the leading `github.com` became the owner, `<user>` became the repo, and the real repo name was silently dropped. A spec that carries a scheme was passed through untouched, and one without a scheme — the usual paste — took the broken path. The same function silently dropped any in-repo path (`owner/repo/skills/<name>`), which `types.ts` documented as supported. Two consequences followed from the shape of the code: the clone URL in the error message was nonsense, and the user had no way to tell a bad URL from a repo that does not exist.

The failing URL in the report is byte-identical for a two-segment input (`github.com/<user>`) and a three-segment one (`github.com/<user>/<repo>`), which made the defect hard to read back from the message alone — that ambiguity is itself part of the problem.

## Decision

`resolveCloneTarget()` replaces `refToCloneUrl()`, and `commandInstall` searches only the path the spec named.

- Trim a copied URL's `?query`/`#fragment` and a `.git` suffix first.
- A spec with a transport (`https://…`, `ssh://…`, `git@host:owner/repo`) is a clone URL, but only `github.com` is split into `owner/repo[/path]`; on any other host the whole path is the repository, so GitLab subgroups (`gitlab.com/group/sub/repo`) are cloned as given rather than truncated.
- A scheme-less spec whose first segment looks like a host (contains `.` or `:`) has that host stripped and re-attached as `https://<host>/<owner>/<repo>`. Non-GitHub hosts keep their whole path.
- The remainder after `owner/repo` is the in-repo subpath. A `tree/<branch>`/`blob/<branch>` marker from a copied browser URL is dropped, and a trailing `SKILL.md` names the file, so the search root is its directory. `collectSkills` then scans that path alone — a spec pointing at one skill no longer trips the multi-skill refusal, and a path the repo does not have is its own error instead of a whole-repo scan.
- Errors stop being one string. A host or user page with no repo says so and clones nothing (`… is not a repository — a source needs owner/repo`); a path-shaped spec that missed `stat` says `local directory not found:` rather than being read as `owner/repo`; a failed clone keeps git's stderr and appends a hint keyed off it (`Repository not found` → check the owner/repo name; GitHub answers the same for a typo and for a private repo).

## Alternatives considered

**Anchor the regex to exactly two segments and reject anything longer.** Rejected: it fixes the silent truncation but still leaves the documented `owner/repo[/path]` unsupported, and it turns the most common paste into an error the user must hand-edit. Stripping the host and honouring the path installs what the pasted link points at.

**Accept any host as `owner/repo`.** Rejected: GitLab (and most self-hosted forges) allow an arbitrarily deep path before the repo, so splitting on the second segment would clone the wrong repository there. Only GitHub's URL shape is known, so only GitHub is split.

**Treat a scheme-less host-prefixed spec as unrecognized, telling the user to add `https://`.** Rejected as the whole fix, though the passthrough is unchanged for URLs with a scheme: the no-scheme paste is what users produce, and a message telling them to edit the URL is worse than accepting it.

**Resolve the default branch out of a `tree/<branch>` URL.** Rejected: it would add a network probe and a refresh-token path for a case whose only cost is cloning the default branch, which the subpath check then validates.

## Consequences

`github.com/<user>/<repo>`, `github.com/<user>/<repo>/skills/<name>`, `https://github.com/<user>/<repo>/tree/<branch>/<path>`, `…/blob/<branch>/<path>/SKILL.md`, `owner/repo`, and `.git`/query-suffixed forms all resolve to the same clone, with the part after the repo narrowing the search. Only the `github.com` split is special-cased; a spec for another forge must be the clone URL itself. Covered in `tests/import.spec.ts` under `commandInstall source specs`: the host-strip regression, the narrowed search, the tree and blob forms, suffix stripping, the non-GitHub path, the host-with-no-repo refusal (asserting no clone ran), the missing in-repo path, the missing local directory, and the clone-failure hint. The client copy in `src/client/locales.ts` and both READMEs now say a GitHub link can be pasted as-is, since the old placeholders named only `owner/repo` and tempted exactly the form that broke.
