# The run report

One report per run, written once at the end, human- and agent-readable. It is the only
thing that carries forward between runs, and a run that cannot publish one writes the same
text and hands it back (`../SKILL.md`, step 11).

## What it is for, and what it is not

Two readers. A person deciding whether this is doing anything, and the next run, which is
briefed from it. What the next run needs is **which attempts have been made and what they
cost**, so that it spends its window on something else.

What the report is **not** is the record of a finding. The issues are, and they are public,
permanent and readable at any time, which is the whole reason this report can be thin about
what was filed and must be thorough about what was not. **Every hypothesis this run ruled
out leaves no issue behind.** It exists here or nowhere.

**Nothing here is redacted.** The audit's report is reached by a bearer link and so carries
nothing a reader could act on. This one names repositories, paths and the issues it filed,
because every one of those is already public the moment the issue exists. The one rule that
does carry over: the report is handed back, never posted as an issue or a comment, because
a report is not a tracking artifact (`../SKILL.md`, guardrail block).

## The shape

````markdown
# Refactor discovery: <Refactor-Run>

Floor in force: `recurring`, from the brief's default (or: set by <who>, in words).
History: complete | incomplete | reconstructed, covering <earliest row> to <latest row> (or: <which link could not be read>).
Done so far: <n> findings from earlier runs are closed COMPLETED and removed <what>; <n> are still open; <n> were declined.
Clock: research and confirmation closed at <deadline>; <what, if anything, the clock stopped>.
Stopped at: the third confirmation (or: the clock, with <n> confirmed).
Read at: core <sha>, plugins <sha>, starter <sha>, g2a-protocol <sha>, create-dynamicagents <sha>, dev-agents <sha>; <any that were behind their main>.

## Attempts, last three months

| hypothesis | run (UTC) | status | what was researched, tested and ruled out | issues |
| ---------- | --------- | ------ | ----------------------------------------- | ------ |
| the step timeout is spelled in both the workflow and the host | 2026-09-02T09:12:05Z | ruled out | Both spellings are real, and they cannot diverge: the host derives its copy from the workflow's at construction and a spec pins the derivation. Re-opening this needs a second literal, not a second reader | |
| every tenant repeats the same three lines before its first step | 2026-09-14T15:40:11Z | filed | Confirmed over four tenants, counted with the command in the issue. A helper in core's root would delete them, and the behaviour class is `none` | dynamicagents/core#71, dynamicagents/starter#86 |
| the retry ceiling branch handles a case no caller can reach | 2026-09-14T15:40:11Z | inconclusive | Established the branch and that no call site passes the value that enters it. Whether a gatekeeper can is unresolved: it needs reading a repository this run does not have. Worth a window of its own |  |
````

**The rows are examples and not history.** What they show is the level the summary column is
written at, which is the thing most often got wrong.

The columns are those, in that order. The first four are the audit's, in the audit's order,
so somebody who reads both reports reads one table twice rather than two tables. The fifth
is this run's own.

**The hypothesis phrase is the first column and the key**: it is how a later run recognises
an attempt it is being told about, which is why it is written once and kept rather than
rephrased per report. Unlike the audit's it may name a repository and a path.

**One row is one finding**, which is one root cause. A finding filed in four repositories is
one row with four URLs in the last column, never four rows: the cap counts findings
(`../SKILL.md`, step 10, and the workspace `AGENTS.md` under "Ranking, and at most three").

`run (UTC)` is the `Refactor-Run` timestamp, which is both this run's date and the join to
every issue it filed. It repeats across rows whenever a run made more than one attempt, as
the last two above do.

### The status vocabulary is fixed

| status | what it means |
| ------ | ------------- |
| `ruled out` | tested, and the hypothesis does not hold. Often the most useful row in the table |
| `inconclusive` | read carefully and never confirmed, or the clock reached it, or the run stopped at its third confirmation while this was still in flight. Not a claim in either direction |
| `below floor` | an opportunity was established and it sits under the floor in force. Filed nowhere |
| `prior decision` | the attempt arrived at something an earlier record had already decided, and that decision stands |
| `filed` | confirmed, and filed. The issue URLs are in the last column |

Fixed, because the column is read by the next run as much as by a person, and a vocabulary
that drifts per report is one nothing can read twice.

**`inconclusive` carries the abandoned attempts**, and its summary says which stopped it: a
careful read that settled nothing, the clock, or the third confirmation landing elsewhere.
That last case is the one a later run most wants, because nothing was wrong with the
candidate except its timing.

### The summary column is the useful part

Write it for the next run: what was researched, how it was tested, and what ruled it out or
what is still unknown. A reader should be able to decide from it whether to spend a window
on that attempt again. **Too terse is the common failure.** "Tested, no finding" tells a
later run nothing and costs it the whole attempt a second time.

A `filed` row is short on purpose, and it is the one case where brevity is right: the issue
carries the evidence, the permalinks, what it removes and what survives it, and the row only
has to say it was confirmed and point at it.

## The `Done so far:` line

The only honest measure of whether any of this is working. This run files issues; it reduces
nothing. If the issues are not getting done then the maintenance surface is still growing
and the report should say so rather than list three more opportunities as though filing were
the point.

It is read from the step-9 listing the run already makes, so it costs no extra call: of the
issues carrying a `Refactor-Run` trailer from an earlier run, how many are closed
`COMPLETED`, what they removed, how many are still open, and how many were declined. Count
findings where the trailers group them and say when a count is of issues instead.

Two limits to state rather than paper over. A finding whose issues were filed before the
oldest listing page reached is not counted, and `--limit` is what decides that
(`issue-api.md`). And what an issue *says* it removes is what its author claimed, not what
the merge actually removed: the line reports the claim, and says that is what it is.

## Sorting, the window, and carrying it forward

Rows are sorted **earliest to latest**, so the table reads as a history and the newest rows
are where a reader stops. The window is **three months rolling**: each run copies the rows
it was handed that are still inside the window, appends its own, and drops the rest. Nobody
edits a row they were handed, and nothing is renumbered.

**The `History:` line moves with the rows.** `complete` is a claim about the whole chain and
not about this run's read, so write it only where the window handed over was complete *and*
this run read it. Otherwise the state handed over stands, `incomplete` or `reconstructed`,
with what is missing named: a window that arrived short is not healed by the next run's link
opening cleanly. The brief's `history_state` is the caller saying which to expect; the line
on the report behind the link is the run that wrote it saying the same for itself.

## No second home for the table

The table lives in reports and nowhere else. **Not** in the Coordinator's memory, not in a
tracking issue, and not in a store added to hold it. A copy is a second home for one fact,
and the copies do not stay in step. The Coordinator carries high-level context in ordinary
session history, which is what that is for.

## When the table cannot be recovered

A report's retention is the host's, and the window is three months, so the table survives by
being carried forward. A gap longer than retention breaks that, and what survives is
asymmetric, though less badly than for the audit:

- **Recoverable**: every run that filed something. The issues never expire and each carries
  `Refactor-Run` and `Refactor-Hypothesis`, so those rows rebuild from the repositories.
- **Lost**: every attempt that ruled something out, every inconclusive attempt, every run
  that found nothing, and every summary. Those were only ever here.

A rebuilt table is marked `reconstructed`, says which part of the window is missing, and
**does not claim three months of history**. An attempt the table does not show is **unknown
rather than new**: a candidate to run again, not a novelty to report. Invent nothing. A row
nobody wrote is not a row to write now.

## Checking a draft before it leaves

There is no disclosure check to run, which is the audit's whole closing section and none of
this one's: every record this run writes is public by design. What is worth reading the
draft for is the two ways it goes wrong on its own terms:

- **A summary that would cost the next run its window.** Read each `ruled out` row and ask
  whether it says enough to not repeat the attempt. If it does not, the row is the one thing
  in this document with negative value.
- **A `Done so far:` line that flatters.** It counts what was closed, not what was filed. A
  run with three new rows and nothing closed behind it is a report saying the line is still
  going the wrong way, and it should read that way.
