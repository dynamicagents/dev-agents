---
name: security-audit
description: >-
  Run a rolling security audit of the Dynamic Agents train — one slice of the product
  per run, across every repo in the train and this workspace. Findings are filed as private
  GitHub security advisories in the repository that owns the code; coverage is recorded
  as one labelled issue per run. Use when asked to audit the product, a repo or an area
  for security. Not for reviewing the pending diff on a branch — that is `security-review`.
---

# Security audit

A whole-product audit that runs in slices. Each run reads what earlier runs covered,
audits the next slice, files what it finds privately, and leaves one small record of
where it got to. Nobody has to remember anything between runs: the state is on GitHub.

Triggered by a person, roughly fortnightly. Nothing here is scheduled.

**Two stores, and they never mix.** A finding is private, and lives as a security
advisory in the repository that owns the code. Coverage is public bookkeeping, and
lives as one labelled issue per run in `dev-agents`. The label indexes run issues only
— an advisory cannot carry a label, so dedup never queries one.

---

## 1. Check the credential before auditing anything

Two probes, both of which create nothing because the body is missing a required field.
A `422` is the green light — the endpoint accepted the caller and rejected the body. A
`403` means the credential lacks the permission.

```bash
# Submit path. `repository_advisories=write`. 422 = authorized, 403 = not.
echo '{}' | gh api --method POST repos/dynamicagents/<repo>/security-advisories/reports --input -

# Run-issue path. `issues=write`. Same reading.
echo '{}' | gh api --method POST repos/dynamicagents/dev-agents/issues --input -
```

On a `403`, **stop**. Report which endpoint refused and its
`X-Accepted-Github-Permissions` header, and say that the session's credential is not
the Worker's `GITHUB_TOKEN` binding — they are separate paths, so a scope granted to
the deployment does not reach a CLI session. Ask for the credential to be fixed. Do not
audit on, and do not look for another way to publish what you find.

Capability is read from status codes only. Never read, echo, log or copy a credential.

---

## 2. Find what earlier runs covered

```bash
gh issue list --repo dynamicagents/dev-agents --label security-audit --state all \
  --limit 20 --json number,title,createdAt,closedAt,state,url,body
```

`--state all` is not optional: a run record is closed once the owner has read it, and a
closed record is ordinary history. Issue state never changes how a record is read; only
`createdAt` does.

- **Cursor** — the `next` field of the newest record by `createdAt`.
- **Coverage** — the union of `covered` across records created inside the last **three
  months**. Older records stay readable, and stop counting as coverage.
- **Nothing in the window, or nothing at all** — start at the top of the rotation and
  say so in the record.

`references/run-records.md` has the record schema, the age-out rules and the
incremental-diff pattern.

---

## 3. Pick the slice

Rotation order. The `next` cursor names one of these ids; if an id no longer exists,
take the longest-uncovered one instead.

| id | what it covers |
| -- | -------------- |
| `g2a-protocol/claims+audience` | `g2a-protocol/src/claims.ts`, `src/audience.ts` — claim names, audience derivation |
| `g2a-protocol/paths+limits+hitl` | `g2a-protocol/src/paths.ts`, `src/limits.ts`, `src/hitl.ts` |
| `core/a2a` | `core/src/a2a` — gatekeeper JWT verification, AgentCard signatures, token handling |
| `core/worker` | `core/src/worker` — request routing and what reaches an agent |
| `core/task+workflow+job` | `core/src/task`, `src/workflow`, `src/job` — the durable lifecycle, cancellation, idempotency |
| `core/agent+subagent` | `core/src/agent`, `src/subagent` — delegation boundaries |
| `core/mcp+model+tool-output` | `core/src/mcp`, `src/model`, `src/tool-output.ts` — tool surfaces and what a model is handed |
| `core/state+env` | `core/src/artifacts`, `src/ledger.ts`, `src/env.ts`, `src/contract`, `src/alarm` |
| `plugins/claude-code` | `plugins/src/claude-code` — the egress gateway and the stream parser |
| `plugins/sandbox` | `plugins/src/sandbox` — the container, its disk, its install |
| `plugins/repo-github` | `plugins/src/repo-github` — token placeholders and the egress swap |
| `plugins/browser+computer+scratch` | `plugins/src/browser`, `src/computer`, `src/scratch` |
| `starter/agents` | `starter/src/agents` — souls, pipelines, children, per-tenant egress |
| `starter/workspace` | `starter/src/workspace`, `src/sandbox-daemon.ts` |
| `starter/config+copy` | `starter/src/config.ts`, `src/copy.ts`, `src/host-manifest.ts` |
| `starter/wrangler` | `starter/wrangler.jsonc` — bindings, migrations, the secret surface |
| `create-dynamicagents/cli` | `create-dynamicagents/src/cli` — what a scaffold writes and from what input |
| `create-dynamicagents/agent` | `create-dynamicagents/src/agent` — the templates a new project inherits |
| `dev-agents/workspace` | `scripts/`, `.gitmodules`, the `.claude/skills` bridge, `.husky/pre-commit` |
| `all/ci` | every repo's `.github/workflows` — OIDC publishing, secret surface, `permissions:` blocks |

For a slice already covered inside the window, audit only what moved since:

```bash
git -C <repo> cat-file -e <recorded-sha>^{commit} && \
  git -C <repo> diff <recorded-sha>..HEAD -- <slice paths>
```

A SHA that no longer resolves — rebase, force-push — makes the slice count as
unaudited, and it takes a full pass.

---

## 4. Audit it

Source first. Read the slice's own code and config, and the `AGENTS.md` of the repo it
lives in: the constraints there are the ones a finding is measured against. Core's
zero-trust rules in particular say what must not be weakened.

Platform classes that keep recurring here are better looked up than recalled — consult
the `durable-objects`, `workers-best-practices`, `agents-sdk`, `wrangler` and
`cloudflare` skills for the slice's surface.

**Known advisories, in the same pass.** Per repo, from the committed lockfile:

```bash
npm audit --json   # in the repo's own directory
```

Each reported advisory gets one verdict — **is the vulnerable function, option or path
reached by this repo's own source?** Applicable ones become findings like any other,
naming the upstream GHSA inside the private advisory. Not-applicable ones go in the
report-back and nowhere else.

Do not read a dependency's source, do not open anything under `node_modules`, and do
not research beyond what `npm audit` already states. A fix — a bump, an override, a
lockfile edit — is never part of an audit.

---

## 5. File each finding as a private advisory

Read the owning repository's `SECURITY.md` first and follow it; it is authoritative for
its own route. Today each one points at GitHub's private vulnerability reporting.

**Dedup before filing.** One call per state — `triage`, `draft`, `published`, `closed`
— over the owning repo's advisories, then inspect the close candidates by `ghsa_id`.
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
What was read or run, and what it showed. Enough for a maintainer to reproduce.

## Suggested direction
Where a fix would go. Not a patch — this audit does not write one.

Audit-Key: <sha256-12 of "repo|normalized path|finding class">
Audit-Run: <YYYY-MM-DD>
```

Then read the advisory back by its `ghsa_id` and confirm it appears under
`?state=triage`. A refusal at any of these steps stops the run as in step 1: the
prepared request body goes to a file **outside the repository**, the operator gets the
exact status and the UI route, and nothing is published anywhere.

If the invoking agent asked for report-back-only, file nothing and hand the finding
back instead. That is the only case in which a finding is not filed.

---

## 6. Write one run record

One issue, this run only, written once at the end. The label, created if absent:

```bash
gh label create security-audit \
  -d "Audit coverage run records (no vulnerability detail)" -c 0E8A16 --force
```

Title: `security-audit <YYYY-MM-DD> — <slices covered>`. Body: a paragraph a person can
read in ten seconds, then the fenced record block from `references/run-records.md`,
whose keys are `covered`, `sweeps` and `next`.

`dev-agents` is public, so the record carries coverage and nothing else. The sentence
saying findings were filed privately is **constant** — it appears whether or not
anything was found, because a sentence that varies with the outcome is a count.

Never edit, close, reopen or comment on a record, this run's or any other. A correction
is a new record naming what it supersedes.

---

## 7. Report back

To the invoking agent, in the session: what was audited and at which SHAs, each finding
with its advisory URL, the not-applicable upstream advisories and why, anything the
dedup lookup could not see, and the run record's URL.

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
- **One issue per run**, describing that run only. Never a tracking issue, never an
  omnibus thread, never an edit or append to an existing record.
- The skill **never closes, reopens, edits or comments** on an issue. Closing is the
  owner's. Every lookup passes `--state all`.
- A run issue carries coverage only: **no GHSA ids**, no advisory links, no
  vulnerability detail, no severities, no CWEs, no counts, no pending-item notes.
- Dedup reads and inspects private advisory records. The label indexes run issues only;
  advisories cannot carry labels.
- **Never read, echo, log or copy a credential.** Capability is established by response
  codes alone.
- The audit's own writes are limited to: an advisory report, one run issue, the
  `security-audit` label if absent, and files under a handoff directory outside the
  repository.
<!-- guardrail:end -->

## References

- `references/advisory-api.md` — the advisory calls, their permissions, the capability
  probe, and why the label cannot live on a finding.
- `references/run-records.md` — the record schema, discovery, the three-month window,
  age-out and the incremental-diff pattern.
