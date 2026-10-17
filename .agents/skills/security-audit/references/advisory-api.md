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

## Capability probe — creates nothing

```bash
echo '{}' | gh api --method POST repos/dynamicagents/<repo>/security-advisories/reports --input -
echo '{}' | gh api --method POST repos/dynamicagents/dev-agents/issues --input -
```

`422` is authorized: the endpoint accepted the caller and rejected a body missing its
required keys. `403` is not authorized, and the run stops there. Because the body can
never satisfy validation, no advisory and no issue can be created by the probe.

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
for s in triage draft published closed; do
  gh api --paginate "repos/dynamicagents/<repo>/security-advisories?state=$s&per_page=100" \
    --jq '.[] | {ghsa_id, state, summary, created_at}'
done
```

One call per state, because `state` takes a single value. Listing unpublished
advisories is open to a security manager, an administrator, or a collaborator on any
advisory in that repository — which this identity becomes on first filing.

`GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}` — `repository_advisories=read`
— reads one, and is how a close candidate's `Audit-Key` is checked.

## Amend one already filed

`PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}` —
`repository_advisories=write`, open to a collaborator on that advisory. Correct or
extend `summary` and `description` only. `state`, `credits` and `cve_id` are the
maintainer's.

There is no advisory-comment endpoint. A conversation on a report happens in the web
UI; a `PATCH` is the only append available here.

## What is not available

`GET /orgs/{org}/security-advisories` needs `repository_advisories=write` **and** org
owner or security manager. A repository collaborator is refused, so there is no
org-wide private query: the audit iterates the repository list it carries instead. The
global advisory database (`GET /advisories`) holds only published public advisories and
answers nothing about this train.
