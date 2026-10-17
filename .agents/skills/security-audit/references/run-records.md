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
run: 2026-10-17
superproject: 5037bbd2a1c3f4e5d6a7b8c9d0e1f2a3b4c5d6e7
covered:
  - { repo: core, slice: core/a2a, sha: 3f82f0a4dc7e18357fa8f6b5ecc4530453654ffb }
sweeps:
  - { repo: core, npm_audit: complete, lockfile_sha: <blob sha of package-lock.json> }
next: core/worker
```
````

`covered[].slice` is a rotation id from the table in `SKILL.md`. `sha` is the commit the
slice was read at — `git -C <repo> rev-parse HEAD`. `lockfile_sha` is
`git -C <repo> rev-parse HEAD:package-lock.json`, which names the exact lockfile the
sweep ran against. `next` is the rotation id the following run starts at.

## What a record may not contain

No vulnerability detail, no GHSA ids, no advisory links or URLs, no titles, no
severities, no CWEs, no counts, and no path presented as the location of a problem.
Naming the audited **slice** is safe and is the whole point: it says where we have
been, not what was found.

Two rules that look like style and are not:

- **The "filed privately" sentence is constant.** It appears whether or not anything was
  found, because a sentence that varies with the outcome is a count. Keep it on **one
  line**, unwrapped: the check below reads lines, and a sentence broken across two of
  them is one a reviewer cannot grep for.
- **Not even the public upstream ids from `npm audit`.** Listing the not-applicable ones
  while omitting the applicable ones discloses the applicable ones by omission. A record
  says only that the sweep completed, and against which lockfile.

Read the draft back before posting it. The rule is mechanical, so check it mechanically:

```bash
grep -oEi "GHSA-[A-Za-z0-9-]+|security/advisories/[A-Za-z0-9-]+|severity|CWE-[0-9]+" <draft>
```

Any hit means the draft is not postable. Write the draft to a file outside the
repository while checking it — a record is public the moment it exists.

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
| Newest record is closed — the normal case | Read exactly like an open one. Closing is the owner saying he has read it |
| Every record is closed | Unchanged: cursor and coverage come from the records as usual |
| Some records older than the window | Only in-window records count as coverage. Older ones stay readable history, never deleted, edited or closed by the skill; their slices become due again |
| Newest record older than the window | Restart the rotation at the top, treat every recorded SHA as stale because the code has moved, and say so in the record's prose and the report-back |
| No records at all — first run, or they were deleted | Start at the top of the rotation and record "no prior record found" |

## Incremental re-audit

The SHA is what makes a second pass cheap, and it lives in the record rather than on
disk — so it survives a worktree created a minute ago:

```bash
git -C <repo> cat-file -e <recorded-sha>^{commit} &&
  git -C <repo> diff <recorded-sha>..HEAD -- <slice paths>
```

A SHA that no longer resolves means a rebase or force-push stranded it; the slice counts
as unaudited and takes a full pass.

## Rotation lives in the skill, not here

`SKILL.md` carries the rotation table, so it is versioned and reviewable. A record says
only what it covered and what is next. If the table changed since the last run, take
`next` when that id still exists, otherwise the longest-uncovered id in the current
table.
