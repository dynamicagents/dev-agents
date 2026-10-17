# Run records

One record per run, in `dev-agents`, labelled `security-audit`, written once at the end
of the run and never touched again. Ten runs are ten issues. No record holds more than
one run, and no record is the state of the audit — the state is *derived* by reading the
recent ones.

`dev-agents` is a public repository. Everything below follows from that.

## The schema

Human prose first, then one fenced block:

````markdown
Audited `core/a2a` at the SHA below.

Any first-party findings from this run were filed as private security advisories in the repository that owns the code; this record never names them. See each repo's Security tab.

```yaml
# security-audit run record — one run, written once, never edited.
run: <YYYY-MM-DD>
superproject: <dev-agents commit the run read the submodules at>
covered:
  - { repo: core, slice: core/a2a, sha: <commit of core> }
sweeps:
  - { repo: core, npm_audit: complete, lockfile_sha: <blob sha of package-lock.json> }
next: core/worker
```
````

Every value is a placeholder but the slice and rotation ids, which are literal. `run` is
the date the run happened, which the title carries too and `createdAt` only approximates
— a record written just after midnight is a record of the day before. `superproject` is
`git rev-parse HEAD` here, and it is what makes the rest reproducible: the submodule
commits a run read are whatever this workspace's pins were pointing at.

`covered[].slice` is a rotation id from the table in `SKILL.md`. `sha` is the commit the
slice was read at — `git -C <repo> rev-parse HEAD`. `next` is the rotation id the
following run starts at.

`sweeps` is the dependency pass, which runs per repository rather than per slice and so
cannot be recorded as one. `lockfile_sha` is
`git -C <repo> rev-parse HEAD:package-lock.json`, naming the exact lockfile the sweep
ran against: a later run compares it with the current one to tell a repo whose
dependencies have not moved since from one whose have.

## What a record may not contain

No vulnerability detail, no GHSA ids, no advisory links or URLs, no titles, no
severities, no CWEs, no counts, and no path presented as the location of a problem.
Naming the audited **slice** is safe and is the whole point: it says where we have
been, not what was found.

The rules below look like style and are not:

- **The "filed privately" sentence is constant.** It appears whether or not anything was
  found, because a sentence that varies with the outcome is a count. Keep it on **one
  line**, unwrapped: the check below reads lines, and a sentence broken across two of
  them is one a reviewer cannot grep for.
- **Not even the public upstream ids from `npm audit`.** Listing the not-applicable ones
  while omitting the applicable ones discloses the applicable ones by omission. A record
  says only that the sweep completed, and against which lockfile.

Read the draft back before posting it. The rule is mechanical, so check it mechanically
— on a file outside the repository, because a record is public the moment it exists:

```bash
grep -oEi "GHSA-[A-Za-z0-9-]+|security/advisories/[A-Za-z0-9-]+|severity|CWE-[0-9]+" \
  /tmp/security-audit-handoff/record.md
```

Any hit means the draft is not postable.

## Discovery

```bash
# Every record, newest first, closed ones included — which is most of them.
gh issue list --repo dynamicagents/dev-agents --label security-audit --state all \
  --limit 20 --json number,title,createdAt,closedAt,state,url,body

# Time-bounded form, when the window is better expressed in the query.
gh issue list --repo dynamicagents/dev-agents --label security-audit --state all \
  --search 'created:>=<window start YYYY-MM-DD>' --json number,title,createdAt,state,body
```

Filtering on a label that does not exist yet returns an empty list and exit 0, so a
first run needs no special case.

- **Cursor** — `next` from the newest record by `createdAt`. Issue state is never read
  as meaning; only `createdAt` is.
- **Coverage** — the union of `covered` across records created inside the window.

## The window is three months

About six runs at a fortnightly cadence: long enough that a slice is not re-audited from
scratch every run, short enough that "covered" still means something about code that
moves. The read stays bounded by construction — a handful of small records — so it does
not grow with the project's age.

## Age-out, and the cases that look like trouble

| Situation | Behaviour |
| --------- | --------- |
| Newest record is closed — the normal case | Read exactly like an open one. Closing is the owner saying they have read it |
| Every record is closed | Unchanged: cursor and coverage come from the records as usual |
| Some records older than the window | Only in-window records count as coverage. Older ones stay readable history, never deleted, edited or closed by the skill; their slices become due again |
| Newest record older than the window | Restart the rotation at the top, treat every recorded SHA as stale because the code has moved, and say so in the record's prose and the report-back |
| No records at all — first run, or they were deleted | Start at the top of the rotation and record "no prior record found" |

## Why the SHA is in the record

It is what makes a second pass over a covered slice cheap, and keeping it here rather
than on disk is what lets a worktree created a minute ago do that second pass. `SKILL.md`
step 3 has the diff it enables, and what to do with a SHA that no longer resolves.

## Rotation lives in the skill, not here

`SKILL.md` carries the rotation table, so it is versioned and reviewable. A record says
only what it covered and what is next. If the table changed since the last run, take
`next` when that id still exists, otherwise the longest-uncovered id in the current
table.
