# The run report

One report per run, written once at the end, human- and agent-readable. It is the only
thing that carries forward between runs, and it is reached by a **bearer link**: whoever
holds the link reads it, there is no ACL and no revocation, and it expires about a month
after it is written. Every rule below follows from those two facts.

A run that cannot publish one writes the same text and hands it back (`../SKILL.md`, step
11). The rules hold either way, because what they are about is text written to be
published.

## What it is for, and what it is not

Two readers. A person deciding whether the audit is doing anything, and the next run, which
is briefed from it. What the next run needs is **which attempts have been made and what
they cost**, so that it spends its window on something else. That is the whole value of the
report, and why the table is its centre rather than its appendix.

What the report is **not** is the record of a finding. The private advisory in the
repository that owns the code is authoritative for every detail of one, and this file says
nothing a reader could act on.

## The shape

````markdown
# Security audit discovery: <Audit-Run>

Floor in force: `high`, from the brief's default (or: set by <who>, in words).
History: complete | incomplete | reconstructed, covering <earliest row> to <latest row>.
Clock: research and confirmation closed at <deadline>; <what, if anything, the clock stopped>.
Any findings from this run were filed as private security advisories in the repository that owns the code; this report names none of them.

## Attempts, last three months

| hypothesis | run (UTC) | status | what was researched, tested and ruled out |
| ---------- | --------- | ------ | ----------------------------------------- |
| a cancel racing a settle leaves a terminal task re-reported | 2026-07-14T09:12:05Z | ruled out | Walked the accept, cancel and settle ordering and the guarded write behind each. Every later write is refused against the flip and says so, and the hook that reads the answer cannot decide it. Re-opening this needs a new write on that path, not a second read of the same one |
| a resume carries an authorization decided before it | 2026-08-02T15:40:11Z | inconclusive | Established where resume state is written, where it is read, and that a human answer can separate the two. Whether anything re-checks the authorization in between stayed open: establishing it needs a driver this run had no window to write. Worth a window of its own |
| a retry outliving the decision that stopped it | 2026-08-02T15:40:11Z | filed | Confirmed by walking the sequence and re-reading it at HEAD. Detail is in the advisory this row's timestamp joins |
````

**The rows are examples and not history.** What they show is the level the summary column is
written at, which is the thing most often got wrong.

The columns are those, in that order. **The hypothesis phrase is the first column and the
key**: it is how a later run recognises an attempt it is being told about, which is why it
is written once and kept rather than rephrased per report. The `run (UTC)` column is the
`Audit-Run` timestamp, which is both this run's date and the join to any advisory it filed
(`../SKILL.md`, step 10). It repeats across rows whenever a run made more than one attempt,
as the last two above do.

### The status vocabulary is fixed

| status | what it means |
| ------ | ------------- |
| `ruled out` | tested, and the hypothesis does not hold. Often the most useful row in the table |
| `inconclusive` | read carefully and never confirmed, or the clock reached it. Not a claim in either direction |
| `below floor` | a weakness was established and it sits under the floor in force. Filed nowhere, and nothing further is said about it |
| `prior decision` | the attempt arrived at something an earlier record had already decided, and that decision stands |
| `filed` | confirmed, and filed privately. The minimal indicator, and the most this report ever says about a finding |

Fixed, because the column is read by the next run as much as by a person, and a vocabulary
that drifts per report is one nothing can read twice.

### The summary column is the useful part

Write it for the next run: what was researched, how it was tested, and what ruled it out or
what is still unknown. A reader should be able to decide from it whether to spend a window
on that attempt again. **Too terse is the common failure.** "Tested, no finding" tells a
later run nothing and costs it the whole attempt a second time.

The bound in the other direction is the guardrail block's, and it is read there rather than
from a summary here: summarising a list of prohibitions is how one of them goes missing,
and the one that goes missing is the one a draft then carries. What this file adds to that
list is the item with no form at all: **no sequence written out in enough detail to
follow.** Say what was established, not how to drive it.

**A `filed` row is the hard case.** The phrase and the summary stay at the level that was
already true before the run, which is the interaction being tested, and the summary says
only that it was confirmed. Where an honest summary cannot be written without naming where
the weakness is, write the phrase the attempt was researched under, say it was confirmed and
filed privately, and stop: the detail has a home, and this is not it.

## Sorting, the window, and carrying it forward

Rows are sorted **earliest to latest**, so the table reads as a history and the newest rows
are where a reader stops. The window is **three months rolling**: each run copies the rows
it was handed that are still inside the window, appends its own, and drops the rest. Nobody
edits a row they were handed, and nothing is renumbered.

## No second home for the table

The table lives in reports and nowhere else. **Not** in the Coordinator's memory, not in a
private repository, and not in a store added to hold it. A copy is a second home for one
fact, and the copy without an expiry is the one that outlives the privacy rules it was
written under. The Coordinator carries high-level context in ordinary session history, which
is what that is for.

## What the next run is given

A coordinator brief carries the table verbatim, and up to four unexpired report ids for the
detail behind it. The ids are opened only when that detail would change what the run does,
and only where the runtime can actually read one. **A local Claude Code session can read and
write no artifact at all**, and says so rather than implying it checked something it could
not reach.

## When the table cannot be recovered

Retention is about a month and the window is three, so the table survives only by being
carried forward: while no gap between runs is longer than retention, the latest report holds
the whole window.

A longer gap breaks that, and what survives is asymmetric:

- **Recoverable**: the runs that filed something. Every advisory carries `Audit-Run` and
  `Audit-Hypothesis`, so those rows can be rebuilt from the advisories in the repositories
  that own them.
- **Lost**: every attempt that ruled something out, every inconclusive attempt, every run
  that found nothing, and every summary. Those were only ever in the report.

A rebuilt table is therefore marked `reconstructed`, says which part of the window is
missing, and **does not claim three months of history**. An attempt the table does not show
is **unknown rather than new**: it is a candidate to run again, not a novelty to report.
Invent nothing. A row nobody wrote is not a row to write now.

## Checking a draft before it leaves

Read the draft against the list in the guardrail block of `../SKILL.md`, which is the one
home for what a report may not carry: it is the list a spec pins and the list a reader of
the skill meets. The half of it that has a shape is checked by its shape:

```bash
grep -oEin "GHSA-[A-Za-z0-9-]+|security/advisories/|CWE-[0-9]+|dynamicagents/[a-z-]+|src/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(ts|jsonc?|mjs)\b" \
  /tmp/security-audit-handoff/report.md
```

Any hit means the draft is not sendable. A severity word has no such shape worth grepping,
because the report carries one legitimately: the floor in force, on the line that names it.
Any other is a finding's severity, and that is read rather than matched.

**A clean grep means nothing on its own.** A summary that walks a sequence, a phrase that
localises a weakness, and a component named in other words all have no form to match. Those
are found by reading the draft as somebody who holds the link and nothing else.
