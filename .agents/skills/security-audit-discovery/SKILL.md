---
name: security-audit-discovery
description: >-
  Find the next real security weakness in the Dynamic Agents train — sweeping the product
  slice by slice, across every repo in the train and this workspace — and file each one as
  a private GitHub security advisory in the repository that owns the code, with one
  labelled coverage issue per run. Discovery only: it writes no fix, no dependency bump
  and no pull request. Use when asked to audit the product, a repo or an area for
  security, or to go looking for vulnerabilities. Not for reviewing the pending diff on a
  branch — that is `security-review` — and not for structural findings, which are
  `refactor-discovery` and `restructure-discovery`.
disable-model-invocation: true
---

# Security audit discovery

A whole-product audit that runs in sweeps. Each run reads where earlier runs got to,
sweeps forward through the rotation reading what it can read carefully, files what it
finds privately, and leaves one small public record of where it reached. Nobody has to
remember anything between runs: the state is on GitHub.

Triggered by a person. Nothing here is scheduled.

The workspace `AGENTS.md`, under "Discovery runs", carries the gate, the ranking axes,
the disposition table, the citation rule, the cap and the rules against edits and against
reading a credential. Read it first; this file carries what is specific to a
vulnerability.

**Two stores, and they never mix.** A finding is private, and lives as a security
advisory in the repository that owns the code. Coverage is public bookkeeping, and lives
as one labelled issue per run in `dev-agents`. The label indexes run issues only — an
advisory cannot carry a label, so dedup never queries one.

---

## 1. Check the credential before reading anything

Probe each write path this run depends on: the advisory route in every repository it
could file a finding in, and the issue route in `dev-agents`, where the record goes. None
of them creates anything, because the body is missing a required field. A `422` is the
green light — the endpoint accepted the caller and rejected the body. A `403` means the
credential lacks the permission.

```bash
# Submit path, per destination repository. `repository_advisories=write`.
echo '{}' | gh api -i --method POST repos/dynamicagents/<repo>/security-advisories/reports --input -

# Run-record path, in dev-agents only — that is the one repository this skill files an
# issue in. `issues=write`. Same reading.
echo '{}' | gh api -i --method POST repos/dynamicagents/dev-agents/issues --input -
```

`-i` is load-bearing: without it `gh` prints the body and the status and swallows the
response headers, and `X-Accepted-Github-Permissions` — the permission GitHub says the
endpoint wanted — is the only thing that separates a missing permission from a missing
role.

On a `403`, **stop**. Report which endpoint refused and what that header asked for, and
say that the session's credential is not the Worker's `GITHUB_TOKEN` binding — they are
separate paths, so a scope granted to the deployment does not reach a CLI session. Ask
for the credential to be fixed. Do not audit on, and do not look for another way to
publish what you find.

Capability is read from status codes only. Never read, echo, log or copy a credential.

---

## 2. Find where the audit got to

```bash
gh issue list --repo dynamicagents/dev-agents --label security-audit --state all \
  --limit 20 --json number,title,createdAt,closedAt,state,url,body
```

`--state all` is not optional: a run record is closed once the owner has read it, and a
closed record is ordinary history. Issue state never changes how a record is read; only
`createdAt` does.

From the newest record by `createdAt`:

- **Cursor** — its `next`, the rotation id this run starts at.
- **Lap** — its `lap`, unless its `next` is the first row of the rotation, which is a lap
  that finished: this run is `lap + 1`, and starts with no coverage at all.
- **Coverage** — the union of `covered` across the records carrying **this** lap.
- **Nothing at all** — lap 1, starting at the top of the rotation, and the record says so.

`references/run-records.md` has the record schema, the queries, how a lap begins and
ends, and the freshness floor that decides whether a covered slice is read again.

---

## 3. The rotation

Rotation order. The cursor names one of these ids; if an id no longer exists, take the
longest-uncovered one instead.

| id | what it covers |
| -- | -------------- |
| `g2a-protocol/claims+audience` | `g2a-protocol/src/claims.ts`, `src/audience.ts` — claim names, audience derivation |
| `g2a-protocol/paths+limits+hitl` | `g2a-protocol/src/paths.ts`, `src/limits.ts`, `src/hitl.ts`, `src/notifications.ts`, `src/index.ts` — the push-callback leg carries a webhook url and its validation token |
| `g2a-protocol/rest` | the rest of `g2a-protocol` — whatever no other row names |
| `core/a2a` | `core/src/a2a` — gatekeeper JWT verification, AgentCard signatures, token handling |
| `core/worker` | `core/src/worker` — request routing and what reaches an agent |
| `core/task+workflow+job` | `core/src/task`, `src/workflow`, `src/job`, `src/abort.ts` — the durable lifecycle, cancellation, idempotency |
| `core/agent+subagent` | `core/src/agent`, `src/subagent` — delegation boundaries |
| `core/mcp+model+tool-output` | `core/src/mcp`, `src/model`, `src/tool-output.ts`, `src/digest.ts` — tool surfaces and what a model is handed |
| `core/state+env` | `core/src/artifacts`, `src/ledger.ts`, `src/env.ts`, `src/contract`, `src/alarm`, `src/index.ts`, `src/testing` — `/testing` is published too, and it reaches the filesystem |
| `core/rest` | the rest of `core` — whatever no other row names |
| `plugins/claude-code` | `plugins/src/claude-code` — the egress gateway, the stream parser, and what a run header may ask a launch for |
| `plugins/sandbox` | `plugins/src/sandbox` — the container, its disk, its install |
| `plugins/repo-github` | `plugins/src/repo-github` — token placeholders and the egress swap |
| `plugins/browser+computer+scratch` | `plugins/src/browser`, `src/computer`, `src/scratch` |
| `plugins/rest` | the rest of `plugins` — whatever no other row names |
| `starter/agents` | `starter/src/agents`, `src/index.ts` — souls, pipelines, children, per-tenant egress, and the Worker entry that mounts them and routes what reaches one |
| `starter/workspace` | `starter/src/workspace`, `src/sandbox-daemon.ts` |
| `starter/config+copy` | `starter/src/config.ts`, `src/copy.ts`, `src/host-manifest.ts`, `src/model.ts` |
| `starter/wrangler` | `starter/wrangler.jsonc` — bindings, migrations, the secret surface |
| `starter/rest` | the rest of `starter` — whatever no other row names |
| `create-dynamicagents/cli` | `create-dynamicagents/src/cli`, `src/cli.ts`, `src/train.ts` — what a scaffold writes, from what input, and the versions it pins |
| `create-dynamicagents/agent` | `create-dynamicagents/src/agent` — the templates a new project inherits |
| `create-dynamicagents/rest` | the rest of `create-dynamicagents` — whatever no other row names |
| `dev-agents/workspace` | `scripts/`, `.gitmodules`, the `.claude/skills` bridge, `.husky/pre-commit` |
| `dev-agents/rest` | the rest of `dev-agents` — whatever no other row names |
| `all/ci` | every repo's `.github/workflows` — OIDC publishing, secret surface, `permissions:` blocks |

**Every repository has a `…/rest` row**, and it covers everything tracked in that
repository that no other row names. `all/ci` is one of those other rows: a repo's
`.github/workflows` belongs to it, not to that repo's catch-all.

A rotation made of enumerated paths covers the product on the day it is written and then
stops, silently: coverage is a union of slice ids, so a module nobody wrote a row for is
not under-covered in any record, it is absent from the question. The catch-all is what
puts a module committed today inside a slice, with nobody having had to remember
anything — when that slice next comes round is the sweep's business, not the table's.

A top-level module under a repo's `src/` still earns a row of its own, and `npm run check`
here holds the table from each end: a path a row names resolves, and a top-level `src/`
module is named by a row that is not a catch-all. So a catch-all carries a new module
until the table catches up with it, rather than forever.

What a catch-all skips is what the audit reads nowhere: specs and test fixtures;
lockfiles, which the `npm audit` sweep in step 4 covers per repository whatever the slice
is; generated files such as `worker-configuration.d.ts`, whose real surface is the config
they are generated from; and, in `dev-agents`, the vendored skill packs under
`.agents/skills/` that this workspace did not write — prior art it never installs and
never runs, and not ours to fix. `AGENTS.md` there, under "Why the LangChain skills are
installed", is what says so.

### The sweep, and what bounds it

**A run sweeps forward from the cursor through as many slices as it can read carefully.**
The budget is the run, not the slice: a session is expensive to start and cheap to let
read, and one slice of a few files would leave the cap unreached and the lap barely
moved.

It stops at the first of these:

- **three Confirmed findings are ready to file** — the cap in `AGENTS.md`, which is what
  the sweep is budgeted against;
- **the reading stops being careful** — the honest end of a run, and the report says
  where it stopped;
- **the end of the rotation**, which ends the lap. A sweep that reaches the last row with
  budget left goes back for the slices this lap covered whose code has since moved —
  `references/run-records.md` has that test — and only then wraps `next` to the first row.

Every slice the run read goes in `covered`, at the commit it was read at, whether or not
it produced a finding. A slice already covered in this lap is read again only when it
fails the freshness floor, and then as the diff since the recorded commit:

```bash
git -C <repo> cat-file -e <recorded-sha>^{commit} && \
  git -C <repo> diff <recorded-sha>..HEAD -- <slice paths>
```

A SHA that no longer resolves — rebase, force-push — makes the slice count as unaudited,
and it takes a full pass.

---

## 4. Audit each slice

Source first. Read the slice's own code and config, and the `AGENTS.md` of the repo it
lives in: the constraints there are the ones a finding is measured against. Core's
zero-trust rules in particular say what must not be weakened.

Platform classes that keep recurring here are better looked up than recalled — consult
the `durable-objects`, `workers-best-practices`, `agents-sdk`, `wrangler` and
`cloudflare` skills for the slice's surface.

**Known advisories, in the same pass.** Per repo, from the committed lockfile:

```bash
npm audit --json --package-lock-only   # in the repo's own directory
```

`--package-lock-only` is what makes the sweep match the `lockfile_sha` the record
stores. Without it `npm audit` reads the installed tree, and in this workspace a tree
can legitimately disagree with the committed lockfile — `npm run link:local` installs
a tarball the lockfile has never seen.

Each reported advisory gets one verdict — **is the vulnerable function, option or path
reached by this repo's own source?** Applicable ones become candidates like any other,
naming the upstream GHSA inside the private advisory. Not-applicable ones go in the
report-back and nowhere else.

Do not read a dependency's source, do not open anything under `node_modules`, and do
not research beyond what `npm audit` already states. A fix — a bump, an override, a
lockfile edit — is never part of an audit.

---

## 5. The gate, the ranking and the cap

`AGENTS.md` has all three. What is specific here is the artifact that makes a
vulnerability **Confirmed**: it is reachable, and the run names the path.

- The **entry point** it starts from — a route, an A2A call, a gatekeeper claim, a tool
  the model can call, a file the container writes, an environment a `postinstall` reads.
- Each hop from there to the weakness, as a permalink with a line range.
- What an attacker gets at the end of it, and who is exposed.

"This looks unvalidated" with no path from an entry point is **Supported**: it is
reported to the Coordinator and never filed, however large the stated impact — impact
never promotes a class. A `npm audit` entry is Confirmed only with the verdict from step
4 behind it; the advisory's own severity is not evidence about this product.

The cap is on **filed advisories**. A fourth Confirmed finding goes to the Coordinator in
the session's report and into no public record — a remainder stated publicly is a count,
and the run record forbids counts. If it is lost with the session, the next run
rediscovers it; that is the designed safety net, not a leak.

Read the prior records before preparing anything — the disposition table in `AGENTS.md`,
applied to advisories rather than issues, with step 6's listing as the lookup. A closed
advisory is a decision; a published one that still reproduces is a regression, filed
anew and naming the prior GHSA.

---

## 6. File each finding as a private advisory

Read the owning repository's `SECURITY.md` first and follow it; it is authoritative for
its own route. Today each one points at GitHub's private vulnerability reporting.

**Dedup before filing.** One listing of the owning repo's advisories — every state it
can see, `triage` through `closed` — then inspect the likely matches by `ghsa_id`.
Match on the `Audit-Key` line, not on prose. A `closed` match is not refiled; a
`published` match is refiled only if it still reproduces, and then the new advisory
names the prior GHSA. An advisory a maintainer drafted alone, without this identity on
it, is invisible to the lookup — say so in the report-back rather than implying the
check was complete.

The exact calls, with the permission each needs, are in `references/advisory-api.md`.

Advisory body:

```markdown
## Impact
What an attacker gets, and who is exposed.

## Where
`repo/path/to/file.ts:line` — the code the finding is about.

## Evidence
The entry point, each hop to the weakness as a permalink, and what was read or run.
Enough for a maintainer to re-run the check.

## Suggested direction
Where a fix would go. Not a patch — this run does not write one.

Audit-Key: <sha256-12 of "repo|normalized path|finding class">
Audit-Run: <YYYY-MM-DD>
```

The key is what dedup matches on, so a run months later has to arrive at the same
twelve characters or it refiles a finding somebody already has. Each part is therefore
fixed rather than chosen: `repo` is the short name the rotation table spells; the
**normalized path** is the file from that repository's root with **no line number**,
because a finding outlives the line it sat on; the **finding class** is a kebab-case
noun phrase for the weakness itself — `jwt-audience-unchecked`, never the prose of this
advisory's summary, which is written fresh each time. Compute it; do not estimate it:

```bash
printf '%s' "core|src/a2a/verify.ts|jwt-audience-unchecked" | sha256sum | cut -c1-12
```

A hash rather than the readable `Discovery-Key` a public issue carries, and the reason is
the store: an advisory is matched by machine after a full listing, where legibility and
searchability buy nothing, and the whole listing is private anyway.

Then read the advisory back by its `ghsa_id` and confirm it appears under
`?state=triage`. A refusal at any of these steps stops the run as in step 1: the
prepared request body goes to `/tmp/security-audit-handoff/`, the operator gets the
exact status and the UI route, and nothing is published anywhere. **Outside the
repository** is the requirement and `/tmp` is how it is met — a path inside the checkout
is one `git add -A` away from being the public disclosure this step exists to avoid, and
the handoff only has to outlive the session the operator is reading.

If the invoking agent asked for report-back-only, file nothing and hand the finding
back instead. That is the only case in which a finding is not filed.

---

## 7. Write one run record

One issue, this run only, written once at the end. The label, created only if absent:

```bash
gh label list --repo dynamicagents/dev-agents --json name --jq 'any(.name == "security-audit")'

# Only on `false`. Never `--force`, which updates the colour and description of a label
# that already exists — an edit, and a discovery run does not make them.
gh label create security-audit --repo dynamicagents/dev-agents \
  -d "Audit coverage run records (no vulnerability detail)" -c 0E8A16
```

`--repo` on both, and on every call in this step: a run reaches here having read other
repositories, and `gh` resolves a bare invocation against the current directory's
remote. A record that lands in `core` is a public issue in the wrong repository.

Title: `security-audit <YYYY-MM-DD> — <slices covered>`. Body: a paragraph a person can
read in ten seconds, then the fenced record block from `references/run-records.md`.

`dev-agents` is public, so the record carries coverage and nothing else. The sentence
saying findings were filed privately is **constant** — it appears whether or not
anything was found, because a sentence that varies with the outcome is a count.

Never edit, close, reopen or comment on a record, this run's or any other. A correction
is a new record naming what it supersedes.

---

## 8. Report back

To the invoking agent, in the session: which slices were swept and at which SHAs, where
the sweep stopped and why, which lap this was, each filed finding with its advisory URL,
each Confirmed finding beyond the cap and where it was in the ranking, each Supported
candidate, the not-applicable upstream advisories and why, the covered slices this lap
that have since moved, anything the dedup lookup could not see, and the run record's URL.

---

<!-- guardrail:start -->
- **Report only.** No fixes, no refactors, no dependency, lockfile or version changes,
  no submodule pointer bumps. Each needs separate explicit authorization from the
  invoking agent.
- Findings go to a **private advisory in the owning repository** by default.
  Report-back-only happens when, and only when, the invoking agent asks for it.
- **Never a public issue**, pull request, commit message, discussion or gist containing
  vulnerability detail. If the advisory route is refused, the run stops, hands the
  prepared body to the operator outside the repository, and asks — it never degrades to
  anything public.
- **Only a Confirmed finding is filed, and impact never promotes a class.** A finding
  with no path from a named entry point is reported to the invoking agent and filed
  nowhere.
- **At most three findings are filed in a run**, and the cap is never a target: a run
  that found fewer says so.
- **One issue per run**, describing that run only. Never a tracking issue, never an
  omnibus thread, never an edit or append to an existing record.
- The skill **never closes, reopens, edits or comments** on an issue or an advisory.
  Closing is the owner's. Every lookup passes `--state all`.
- A run issue carries coverage only: **no GHSA ids**, no advisory links, no
  vulnerability detail, no severities, no CWEs, no counts, no pending-item notes.
- Dedup reads and inspects private advisory records. The label indexes run issues only;
  advisories cannot carry labels.
- **Never read, echo, log or copy a credential.** Capability is established by response
  codes alone.
- The run's own writes are limited to: an advisory report, one run issue, the
  `security-audit` label if absent, and files under `/tmp/security-audit-handoff/`.
<!-- guardrail:end -->

## References

- `references/advisory-api.md` — the advisory calls, the permission and role each needs,
  which credential answered, and why the label cannot live on a finding.
- `references/run-records.md` — the record schema, what a record may not contain and how
  to check that mechanically, the queries, the lap, and the freshness floor.
