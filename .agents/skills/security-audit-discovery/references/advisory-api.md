# The advisory calls

`gh` has no advisory command, so every call here is `gh api`. The permission named on
each is the fine-grained one GitHub answers with in `X-Accepted-Github-Permissions`;
reading that header on a refusal is how you tell a missing permission from a missing
role.

## A finding cannot be labelled

A repository security advisory has `ghsa_id`, `summary`, `description`, `severity`,
`state`, `cwe_ids`, `credits`, `collaborating_users` and the rest — and **no `labels`,
assignees or milestones**. The list endpoint filters on `state` alone: no query, no
label, no date range. That is why dedup lists and inspects advisories, and why the
`security-audit` label indexes run issues instead.

## Which credential answered

`SKILL.md` step 1 carries the probe: it posts a body that cannot validate to the advisory
submit endpoint and to the run-issue endpoint, so neither can create anything, and takes
the answer from the status code. Which credential gave that answer is the part worth
being precise about when reporting a block.

The credential a CLI session uses is **not** the Worker's `GITHUB_TOKEN` binding (see
`starter/wrangler.jsonc` and `plugins/src/repo-github/sandbox-egress.ts`). A scope
granted to the deployment does not reach a session, and the reverse is equally true —
name which one refused when reporting a block.

## Submit a finding

`POST /repos/{owner}/{repo}/security-advisories/reports` — `repository_advisories=write`

```bash
gh api --method POST repos/dynamicagents/<repo>/security-advisories/reports \
  --input <prepared-body>.json --jq '{ghsa_id, html_url, state}'
```

`summary` and `description` are required. `severity` **or** `cvss_vector_string`, never
both — the API rejects a body carrying both. `cwe_ids` and `vulnerabilities[]` are
optional, and each entry in `vulnerabilities` needs `package.ecosystem`.
`start_private_fork` stays `false`: this workflow reports, it does not prepare a fix.

The reporter is added by GitHub as a collaborator and credited user on the advisory it
creates. That is what makes the dedup and read-back calls below work for this identity.

## Dedup — list, then inspect

`GET /repos/{owner}/{repo}/security-advisories?state=<state>` — `repository_advisories=read`

```bash
gh api --paginate "repos/dynamicagents/<repo>/security-advisories?per_page=100" \
  --jq '.[] | {ghsa_id, state, summary, created_at, description}'
```

`state` is a filter, not a required argument: left off, every state the caller can see
comes back in one pass, and `state` is on each entry anyway. Listing unpublished
advisories is open to a security manager, an administrator, or a collaborator on any
advisory in that repository — which this identity becomes on first filing.

**`description` is in the projection because that is where `Audit-Key` lives.** The
listing is the match: a key is compared against the whole set, and nothing is shortlisted
on prose first. Dropping the field would leave the run choosing which advisories to open
by reading their summaries, which is the judgement the key exists to replace.

`GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}` — `repository_advisories=read`
— reads one in full, once the key has already named it.

## Correcting one already filed — not a call this run makes

`PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}` exists and would take
`summary` and `description` from a collaborator on that advisory. **A discovery run does
not call it**, for the reason it edits no record anywhere: a record that can be amended
is no longer the account of the run that wrote it. A correction is a new advisory naming
the one it supersedes, the way a finding that still reproduces names the prior GHSA
(`SKILL.md` step 6).

There is no advisory-comment endpoint either. A conversation about a report happens in
the web UI, which is the maintainer's to have.

## What is not available

`GET /orgs/{org}/security-advisories` needs `repository_advisories=write` **and** org
owner or security manager. A repository collaborator is refused, so there is no
org-wide private query: the audit iterates the repository list it carries instead. The
global advisory database (`GET /advisories`) holds only published public advisories and
answers nothing about this train.
