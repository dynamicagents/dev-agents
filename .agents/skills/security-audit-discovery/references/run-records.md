# Run records

One record per run, in `dev-agents`, labelled `security-audit`, written once at the end
of the run and never touched again. Ten runs are ten issues. No record holds more than
one run, and no record is the state of the audit: the state is *derived* by reading the
current lap's records.

`dev-agents` is a public repository. Everything below follows from that.

## The schema

Human prose first, then one fenced block:

````markdown
Swept `core/a2a` and `core/worker` at the SHAs below, in lap 3.

Any first-party findings from this run were filed as private security advisories in the repository that owns the code; this record never names them. See each repo's Security tab.

```yaml
# security-audit-discovery run record: one run, written once, never edited.
run: <YYYY-MM-DD>
lap: <the lap these slices belong to>
superproject: <dev-agents commit the run read the submodules at>
covered:
  - { repo: core, slice: core/a2a, sha: <commit of core> }
  - { repo: core, slice: core/worker, sha: <commit of core> }
sweeps:
  - { repo: core, npm_audit: complete, lockfile_sha: <blob sha of package-lock.json> }
next: core/task+workflow+job
```
````

Every value is a placeholder but the slice and rotation ids, which are literal. `run` is
the date the run happened, which the title carries too and `createdAt` only
approximates, because a record written just after midnight is a record of the day
before. `superproject` is `git rev-parse HEAD` here, and it is what makes the rest
reproducible: the submodule commits a run read are whatever this workspace's pins were
pointing at.

`covered` carries **every slice the run read**, each at the commit it was read at
(`git -C <repo> rev-parse HEAD`), whether or not it produced a finding. A sweep reads as
many as it can read carefully, so a record usually names several. `next` is the rotation
id the following run starts at.

`sweeps` is the dependency pass, which runs per repository rather than per slice and so
cannot be recorded as one. `lockfile_sha` is
`git -C <repo> rev-parse HEAD:package-lock.json`, naming the exact lockfile the sweep
ran against: a later run compares it with the current one to tell a repo whose
dependencies have not moved since from one whose have.

## The lap is the window

Coverage means "read in this lap of the rotation", and a lap is a pass through the table
in `SKILL.md`. That is the window, and it is derived from the rotation rather than set as
a number: a window stated in months either outlives a lap, which makes "covered" a claim
about code that has since moved, or ends inside one, which makes it inert; every slice
expires long before it next comes round, and nothing is ever suppressed.

Mechanically, from the newest record by `createdAt`:

- **Cursor**: its `next`.
- **Lap**: its `lap`, unless its `next` is the **first row** of the rotation. That is
  the signal of a lap that finished: this run is `lap + 1`.
- **Coverage**: the union of `covered` across the records carrying this run's lap, which
  is empty on the first run of a new lap.
- **No records at all**: lap 1, cursor at the top of the rotation, no coverage, and the
  record says "no prior record found".

A lap therefore ends exactly where the rotation does, and the read stays bounded by
construction: one lap of small records, however old the project gets.

## The freshness floor

A covered slice counts as covered only while the code it names has not moved. Expressed
as movement rather than as time, because movement is what makes a reading stale:

```bash
git -C <repo> cat-file -e <recorded-sha>^{commit} && \
  git -C <repo> diff <recorded-sha>..HEAD -- <slice paths>
```

- **Resolves, and the diff is empty**: covered. Not read again in this lap.
- **Resolves, and the diff is not empty**: due again inside the lap, and the diff is
  what is read, since a second pass over a slice is the change since the first one.
- **Does not resolve**: a rebase or a force-push took the commit. The slice counts as
  unaudited and takes a full pass.

A sweep that reaches the end of the rotation with budget left spends it here, on the
slices this lap covered that have since moved, before `next` wraps to the first row.
Otherwise they wait for the new lap, which reads everything again anyway.

## What a record may not contain

The list is the guardrail block's, in `../SKILL.md`: one home, because it is the one a
spec pins and the one a reader of the skill meets. Naming the audited **slice** is safe
and is the whole point: it says where we have been, not what was found.

What belongs here is what writing a record does with that list. These look like style
and are not:

- **The "filed privately" sentence is constant.** It appears whether or not anything was
  found, because a sentence that varies with the outcome is a count. Keep it on **one
  line**, unwrapped, so a reviewer can grep for it: a sentence broken across two lines
  is one no line-based read finds.
- **No remainder, either.** A Confirmed finding past the cap goes to the invoking agent
  in the session's report; saying here that there were more is a count.
- **Not even the public upstream ids from `npm audit`.** Listing the not-applicable ones
  while omitting the applicable ones discloses the applicable ones by omission. A record
  says only that the sweep completed, and against which lockfile.

Read the draft back before posting it, on a file outside the repository: a record is
public the moment it exists. The half of the list that has a shape gets checked by its
shape:

```bash
grep -oEi "GHSA-[A-Za-z0-9-]+|security/advisories/[A-Za-z0-9-]+|severity|CWE-[0-9]+" \
  /tmp/security-audit-handoff/record.md
```

Any hit means the draft is not postable. **A clean grep means nothing on its own**: a
count, a title, a pending-item note and a path presented as the location of a problem
have no form to match, and are found by reading the draft against the list.

## Discovery

```bash
# Every record, newest first, closed ones included, which is most of them.
gh issue list --repo dynamicagents/dev-agents --label security-audit --state all \
  --limit 100 --json number,title,createdAt,closedAt,state,url,body
```

Filtering on a label that does not exist yet returns an empty list and exit 0, so a
first run needs no special case. Issue state is never read as meaning; only `createdAt`
is.

## Age-out, and the cases that look like trouble

| Situation | Behaviour |
| --------- | --------- |
| Newest record is closed (the normal case) | Read exactly like an open one. Closing is the owner saying they have read it |
| Every record is closed | Unchanged: cursor, lap and coverage come from the records as usual |
| Records from earlier laps | Only this lap's records count as coverage. Older ones stay readable history, never deleted, edited or closed by the skill |
| The newest record's `next` is the first row | That lap finished. This run is the next lap, with no coverage, and its record says which lap |
| Every recorded SHA in this lap has gone stale | Ordinary: the floor above says each is due again, and a slice the cursor has passed waits for the budget at the end of the lap |
| No records at all (first run, or they were deleted) | Lap 1, from the top of the rotation, recorded as "no prior record found" |

## Why the SHA is in the record

It is what makes a second pass over a covered slice cheap, and keeping it here rather
than on disk is what lets a worktree created a minute ago do that second pass: a run
holds no state anywhere else.

## Rotation lives in the skill, not here

`SKILL.md` carries the rotation table, so it is versioned and reviewable. A record says
only what it covered, which lap, and what is next. If the table changed since the last
run, take `next` when that id still exists, otherwise the first row this lap has not
covered. `SKILL.md`'s rotation section says why that is the rule and not a longest-wait.
