# The issue calls

`gh` has an `issue` command, so unlike the audit's advisories most of these have a short
form and an `gh api` form. The permission named on each is the fine-grained one GitHub
answers with in `X-Accepted-Github-Permissions`; reading that header on a refusal is how
you tell a missing permission from a missing role.

## What an issue carries that an advisory cannot

Labels, assignees, milestones, a `stateReason`, comments, a body the search index reaches,
and **no expiry**. Three things follow, and they are why this run's bookkeeping is lighter
than the audit's:

- **What was filed is readable at any time**, from the repositories themselves. The run
  does not depend on a report to know what earlier runs filed, only to know what they
  *attempted*, which is the half no issue records.
- **The trailers are a convenience, not the only join.** `Refactor-Run` and
  `Refactor-Hypothesis` in the body are what rebuilds a lost report's filed rows, but the
  report may also carry the issue URLs outright, because an issue is public and a report of
  this run is not keeping anything back.
- **A label is an index**, so a person can find these without the trailers. The run still
  creates none: a repository's configuration is not a discovery run's to change.

## Which credential answered

Measured from this workspace's `gh`, against `dynamicagents/dev-agents`:

| call | status | `X-Accepted-Github-Permissions` |
| ---- | ------ | ------------------------------- |
| `POST .../issues` with `{}` | `422 Unprocessable Entity`, body `Invalid request.\n\n"title" wasn't supplied.` | `issues=write` |
| `GET .../issues?state=all&per_page=1` | `200 OK` | `issues=read` |

The `422` is the green light `SKILL.md` step 3 looks for: the endpoint accepted the caller
and rejected the body, and **nothing was created**, confirmed by the repository's issue
count being unchanged immediately afterwards. A body with no `title` cannot create an
issue, which is what makes it safe to probe a mutating endpoint with.

The credential a CLI session uses is **not** the Worker's `GITHUB_TOKEN` binding (see
`starter/wrangler.jsonc` and the egress module in plugins' GitHub repo plugin). A scope
granted to the deployment does not reach a session, and the reverse is equally true, so
name which one refused when reporting a block.

GitHub documents `410 Gone` on the create path for a repository with issues turned off,
which would be a refusal nobody can clear with a permission: there is no issue route there
at all. **That one is from the documentation and not from a probe**, because every
repository in the train has issues enabled and this run turns nothing off to find out.

## File a finding

`POST /repos/{owner}/{repo}/issues` (`issues=write`)

```bash
gh issue create -R dynamicagents/<repo> --label enhancement \
  --title "<the root cause, as a sentence>" --body-file /tmp/refactor-discovery/<n>.md
```

`title` is required and nothing else is. `--label` names a label that already exists:
`enhancement` is in every repository of the train, which is why the run names that one.
**What GitHub does with a label that does not exist is not established here**, and that is
itself a reason to name only one that does: a run cannot tell a silently created label from
a silently dropped one without checking afterwards, and checking afterwards is a second call
that proves the first was wrong.

The reporter is the issue's author, which is what makes the read-back below work.

## History: list, then inspect

`GET /repos/{owner}/{repo}/issues?state=all` (`issues=read`)

```bash
gh issue list -R dynamicagents/<repo> --state all --limit 200 \
  --json number,title,state,stateReason,labels,url,body
gh issue view <n> -R dynamicagents/<repo> --json title,body,state,stateReason,comments
```

**`--state all` is not a default.** `gh issue list` shows open issues only, and a closed
issue is exactly the history this run most needs: a decision somebody already made. The
workspace `AGENTS.md` makes it a rule for every discovery run, under "What earlier runs and
earlier people already decided".

**`--limit` is this route's `--paginate`.** `gh issue list` returns thirty rows and says
nothing about the ones it did not return, so a run reading the default draws the same
conclusion from a truncated answer as from a complete one.

Two ways this endpoint misleads a reader, both worth knowing before trusting a count:

- **The REST route returns pull requests as well as issues.** Measured: in `dev-agents`,
  which has no issues at all, `GET /repos/dynamicagents/dev-agents/issues?state=all`
  answered with three pull requests, while `gh issue list` in the same repository answered
  with nothing. `gh issue list` filters them out; `gh api` does not, so a run that reaches
  for the REST route has to filter on `.pull_request == null` itself.
- **`stateReason` carries the category and never the argument.** `COMPLETED`,
  `NOT_PLANNED` and `DUPLICATE` are the ones the disposition table is keyed on, and it is
  absent on an issue nobody has closed. The reason a maintainer declined something is prose,
  in the closing comment, so the `view` call above is not optional: `--state all` finds the
  decision and only the comments say what it was.

The per-repository listing is authoritative. `gh search issues` reaches the trailers across
repositories and is a convenience for a person, not a substitute: a search index has its own
lag and its own scoring, and a run that read one and not the listing cannot say what it did
not see.

## Correcting one already filed: not a call this run makes

`PATCH /repos/{owner}/{repo}/issues/{number}` would take a new title, body, state or
`state_reason`, and `POST /repos/{owner}/{repo}/issues/{number}/comments` would add a
comment. **A discovery run calls neither**, for the reason it edits no record anywhere: a
record that can be amended is no longer the account of the run that wrote it, and closing
is the owner's. A correction is a new issue naming the one it supersedes, which is the same
move the disposition table asks for when a fixed finding comes back: the workspace
`AGENTS.md`, under "What earlier runs and earlier people already decided", reached from
`SKILL.md` step 9.

That is also why the sibling issues of one root cause carry no cross-written issue numbers.
The numbers are only knowable after the issues exist, so writing them in would mean editing
each issue once the rest were filed. The first line of every body names the repositories
instead, which is knowable before any of them is created, and the full set of URLs goes in
the report.
