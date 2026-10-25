---
name: refactor-discovery
description: >-
  Go looking for the maintenance surface the train no longer needs: one root cause, shared
  across files and repositories, that could be removed or made smaller with no change in
  observable behaviour, or with a little change that is clearly better for the people using
  it. The repository-wide counterpart of `simplify`, which reviews a branch's diff and
  applies what it finds: this run reads every repository at rest, researches named
  hypotheses, confirms the evidence itself, files each confirmed finding as a public GitHub
  issue in every repository that has to change, and writes one report per run. Discovery
  only: it writes no fix, no dependency bump and no pull request. Use when asked to look
  for refactor, simplification or dead-code opportunities across the train, or for what
  could be deleted. Not for reviewing the pending diff on a branch, and not for a breaking
  change.
disable-model-invocation: true
---

# Refactor discovery

**The best outcome is a line that is no longer there.** A finding that removes a concept
beats one that moves it, and the measure this run works to is the maintenance surface: code
arrives here about a thousand lines at a time and leaves nowhere.

Be honest about what that makes this run. It files issues; it reduces nothing by itself.
What bends the line is how often it runs and how many of its issues get done, which is why
the report carries a standing count of what earlier findings became (step 11).

The unit of work is an **attempt**: a named hypothesis about one root cause and what it
costs, tested against the code until it is confirmed or dropped. Not a pass over a file
list, and not a list of things that could be nicer.

Triggered by a person, or by the Coordinator on a person's behalf. Nothing schedules it.

The workspace `AGENTS.md`, under "Discovery runs", carries the evidence gate, the ranking
axes, the disposition table, the citation rule, the cap and the rules against edits and
against reading a credential. Read it first; this file carries what is specific to a
refactor.

## This is `simplify` at rest, and over the whole train

`simplify` reviews the code a branch changed and applies the fixes. This run reads every
repository in the train as it stands, changes nothing, and files what it can evidence. One
keeps a branch clean; the other finds what no branch ever touched. Its lenses are in
step 4, written here rather than read from it: that skill is a Claude Code built-in with no
file in this workspace, so nothing here can point at it and expect the pointer to hold.

It is not `code-review`, which is already bought once per pull request and hunts
correctness bugs on a diff.

---

## 1. The brief

A run holds no state between runs. Everything it knows about earlier attempts arrives in
the prompt that starts it:

```yaml
min_tier: recurring      # the floor. Step 7
history: <url>           # the most recent report's link, or absent. Open it for the table
history_state: complete  # complete, incomplete or reconstructed
prior_reports: []        # up to four older, unexpired links: the detail, and the fallback
deadline: <ISO-8601 UTC> # optional. Absent means the run computes its own in step 2
```

**The run reads the history the brief names, and goes looking for none of its own.** The
rolling table is not copied into the brief: `history` is a link, and the run opens it and
reads the table out of the report behind it. That is a read of a page and not a call to a
store (`AGENTS.md`, under "A run is briefed, and keeps nothing").

- **A link that yields no table is unknown history, never a clean window.** A record past
  its retention, a link that arrived wrong, a host answering with a page no table can be
  read out of: each leaves this run without the window it was meant to have, and **no
  status code tells them apart**, because a host may answer `200` with a page that holds
  nothing. What decides it is whether a table came back. Say which link failed.
- **Absent history is not evidence of novelty.** An attempt the window does not show is
  unknown, not new. Say which it is, and never present a thin window as a clean one.
- `prior_reports` is the detail behind the table, opened when it would change what this run
  does, and as the fallback where `history` yielded nothing.
- `min_severity` is not this run's floor, whatever a brief copied from the audit says.
  `min_tier` is: it arrives as `recurring`, and step 7 is where that is binding.

**This run has a second history the report cannot give it, and it is the better half.** Its
records are public issues that never expire, so what was *filed* is readable at any time
from the repositories themselves (step 9). The report says what was **attempted**, which is
the part that exists nowhere else: every hypothesis this run ruled out leaves no issue
behind. Neither is the other's index, so say which of the two answered a question.

---

## 2. One clock, shared

Take the run's timestamp and its deadline once, at the start, in UTC. The deadline goes
verbatim into every brief this run hands out: two workers must never disagree about when to
stop. The timestamp is this run's id and stays with the orchestrating run: a worker files
nothing, so it has no use for one.

```bash
date -u +%Y-%m-%dT%H:%M:%SZ                                 # Refactor-Run: this run's id
date -u -d '+<window_minutes> minutes' +%Y-%m-%dT%H:%M:%SZ  # the deadline, if the brief named none
date -u -v+<window_minutes>M +%Y-%m-%dT%H:%M:%SZ            # the same, where date is BSD's and -d is not a flag
```

```yaml
# The run's one clock. Minutes, UTC, computed once and shared verbatim. `window_minutes`
# is where the deadline above comes from, and the only place that number is written.
window_minutes: 90        # the start of research to the deadline
open_candidates_until: 25 # minutes before the deadline: no candidate is opened after it
confirm_until: 15         # minutes before the deadline: confirmation stops here
```

**The clock is this run's second stop condition.** The first is the third confirmation, and
step 8 owns it. The clock bounds search and confirmation, and nothing after them: filing a
confirmed finding, writing the report and handing the session back all complete after the
deadline has passed, because a clock that could stop a confirmed finding from reaching its
issue would throw away work already paid for.

A deadline is **never** a reason to drop the floor, weaken the evidence bar or file a
candidate that is not confirmed. Running out of time means a run with fewer findings, and
the report says where the clock bit.

A brief may name a deadline closer than `open_candidates_until`. The margins are absolute
minutes before it, not fractions of the window, so there is then no room to open a candidate
that could ever be confirmed. Open none, report the window as too short to research in, and
stop.

---

## 3. Check the capability before spending the window

Probe the issue routes this run depends on **before** researching anything. The create
probe makes nothing, because the body has no `title` and the endpoint requires one. A `422`
is the green light: the endpoint accepted the caller and rejected the body.

```bash
# Create path, per candidate destination repository. `issues=write`.
echo '{}' | gh api -i --method POST repos/dynamicagents/<repo>/issues --input -

# Read path, the same repositories. `issues=read`.
gh api -i "repos/dynamicagents/<repo>/issues?state=all&per_page=1"
```

`-i` is load-bearing: without it `gh` prints the body and the status and swallows the
response headers, and `X-Accepted-Github-Permissions`, the permission GitHub says the
endpoint wanted, is the only thing that separates a missing permission from a missing role.

**A refused create stops the run for that repository**, and **every create refused stops the
run**: there is then nothing this session could do with a finding. Report which endpoint
refused and what that header asked for, say that a session's credential is not the Worker's
`GITHUB_TOKEN` binding (separate paths, so a scope granted to the deployment does not reach
a CLI session), and ask for it to be fixed. Do not research on in the hope it clears.

A refused listing stops less than a refused create. Without it step 9 cannot run, and a
finding filed with no history behind it is how a decision somebody already made gets
re-filed. So a candidate owned by a repository whose listing is refused is researched like
any other and handed back with its prepared bodies, never filed blind. Its report row is
`confirmed, not filed`, which is the status that keeps an investigation somebody paid for
from reading as unknown to the next run.

GitHub documents `410` on the create path for a repository with issues turned off, which
would be a refusal of a different kind and worth naming as itself: nothing can be filed
there at all, by anyone. Every repository in the train has issues enabled, so this is read
from the documentation rather than measured.

Capability is read from status codes only. **Never read, echo, log or copy a credential.**

`references/issue-api.md` carries what each call needs and what was measured.

---

## 4. Form the hypotheses

**Read the constraints first.** Each repository's `AGENTS.md` states what must not be
weakened and, more usefully here, where a thing is supposed to live: the workspace's own
"Where a change goes" table, core's "The line core does not cross", starter's "Where a thing
goes", "The two invariants that have already broken once" and "Size ceilings",
g2a-protocol's "The three rules", plugins' rule that no subpath's module graph may reach a
sibling's, and create-dynamicagents' "What it writes, and why that is pinned". A rule stated
that plainly is the cheapest finding there is, because the repository has already agreed
with it.

**A constraint the code already states is a prior disposition.** These repositories comment
heavily and hold a comment to the code's bar, so a candidate the comments already explain is
not a finding unless the run shows the stated constraint no longer holds. This is the filter
that bites hardest on a refactor run, and reading past it is how a run spends its window
rediscovering decisions.

A hypothesis names **one root cause and what it costs today**. A candidate that names a
shape somebody would prefer is a preference, and preferences are `cosmetic` (step 7).

### The lenses from `simplify`

Transcribed from `simplify`, read over the repositories at rest rather than over a diff.
Each one ends the same way, and that ending is the point: **a finding names the thing that
replaces it.**

- **Reuse**: code that re-implements what the train already has. One fact with two homes,
  in code, in a spec or in prose; a helper copied between two plugins where only core's
  root can hold one both may import; a value two repositories spell identically that
  `g2a-protocol` exists to own. Name the existing thing to call instead.
- **Simplification**: complexity that is carried rather than needed. Redundant or derivable
  state, copy-paste with slight variation, deep nesting, dead code left behind, a
  configuration knob nothing sets, an abstraction with one caller, a spec whose rule another
  spec already pins. Name the simpler form that does the same job.
- **Efficiency**: work done that nothing needs. Redundant computation or repeated I/O,
  independent operations run in sequence, blocking work on a hot path or at startup, and a
  long-lived object built from a closure, which keeps its whole enclosing scope alive for
  the object's lifetime. Name the cheaper form.
- **Altitude**: a symptom patched where the cause lives deeper. Special cases layered on
  shared infrastructure are the signal, and this train has a precise vocabulary for it:
  durable-execution logic in the deployment where the foundation owns it, a capability's
  Durable Object in the deployment where the plugin owns it, prompt copy or a number in core
  where only a tenant may vary it. Name the general change to the underlying mechanism.

### The lenses this train adds

- **A rule the code breaks**, quoted from the `AGENTS.md` that states it. The comment rules
  are the most checkable of these: no changelog in a comment, no package version or date in
  prose, no counts, and a cross-file reference that names a path which no longer resolves.
- **A cost a published shape imposes repeatedly**: every consumer repeating the same lines
  before the common thing; an error a consumer or an end user reaches that does not say what
  to do next; what a scaffolded project inherits and then has to undo.
- **A branch that exists for an edge case nobody has met**, which step 7's third behaviour
  class is for.
- **A pattern a newer upstream API would delete.** Core's "Package Bumping" says outright
  that a changelog is where a refactor opportunity is found. Filed as an issue naming the
  API, never as a bump: a dependency change is not this run's to make.

### The hypothesis phrase

Each attempt gets a short readable phrase naming the root cause and its cost, and it is the
name that attempt keeps: the first column of the report table, and the stable key a later
run recognises it by.

**It may name a repository, a module and a path.** This run's records are public issues and
its report is not keeping a location back, so the phrase says where the root cause is.

**Novelty is a judgment, not a key.** Hold the phrase against the table the history link
carried and against the issues step 9 lists, and ask whether that root cause has been
attempted: the same root cause under different words is a repeat, a different cause is new.
No taxonomy, no hash, no mechanical key, and no pretending that history nobody handed you
proves anything.

---

## 5. Investigate with bounded subagents

Fan out over candidates, never over the product. One investigator takes one candidate, and
its brief stands on its own: a skill with `disable-model-invocation: true` is not preloaded
into a subagent (`AGENTS.md`, under "The prompt names the skill"), so nothing in the brief
may assume the subagent can read this file.

A worker brief carries the hypothesis phrase, what to read and which sites to establish, the
run's deadline verbatim, the evidence bar from step 6, and the rules it works under: change
nothing, file nothing, publish nothing, and never read, echo, log or copy a credential.
Filing is the orchestrating run's alone.

**Concurrency stays modest.** No more than three investigations in flight, because every
claim that comes back has to be verified by the run itself, and that verification is the
narrow part. More workers buys queued claims, not findings.

**Depth, not more workers.** A candidate still unresolved after it has been read carefully
is Supported and drops out of filing. A second investigator on it buys a second opinion,
which is not evidence.

Stop opening candidates at `open_candidates_until`, or at the third confirmation, whichever
comes first. Step 8 is where the second of those is binding.

---

## 6. The run verifies, the worker does not

A subagent's report is a **claim**, and a claim is not evidence. Before a candidate can be
filed, the orchestrating run re-reads the code at `HEAD` itself and re-runs whatever the
claim rests on, naming the commit it read.

What makes a refactor opportunity **Confirmed** here:

- **the root cause, and every site it reaches**, each a full-SHA permalink with a line
  range, plus a named command and its output that a reader can re-run;
- **the cost already paid**, shown rather than asserted: the divergence that has already
  happened, the call sites counted by the command that counted them, the rule quoted from
  the file that states it, the merged pull request that had to touch both copies;
- **what it removes**, counted, by kind;
- **the row of the surface table** in step 7 for each kind it removes;
- **which audience sees it**, and over how many call sites and repositories.

**A discovery run writes no patch, so it never establishes that a change is
behaviour-neutral.** It establishes the root cause, the cost, what would be removed and what
covers the code today. The behaviour class in step 7 is a bounded claim about the direction,
the issue says so in those words, and a candidate whose class cannot be stated without
writing the change is Supported: handed back, filed nowhere, however much it would remove.
Impact never promotes a class.

Reading every repository in the train at a pinned combination adds rules the audit does not
need:

- **Name the commit per repository, and say when a checkout is behind.** A finding read
  against a stale checkout may already be fixed upstream. Compare what was read with
  `gh api repos/dynamicagents/<repo>/commits/main --jq .sha` and report any that differ.
- **Leave every checkout as you found it, which is not the same as leaving it clean.**
  Prefer `git`, `rg` and `gh`, which write nothing. Some commands do write: starter's
  `npm run check` runs `wrangler types`, and a playback run has dirtied core's cassettes
  before. Before running one of those, read `git status` in that checkout:
  - **Already dirty: do not run it there.** Somebody's uncommitted work is in the way, and
    after the command the run cannot tell their changes from its own, so the one rule it
    could follow next, restore, is the one that would destroy their work. Read that
    repository with read-only commands instead, and say in the report which checkout was
    dirty and what went unrun because of it.
  - **Clean: run it, then read `git status` again and restore what the command wrote.**
    Here a restore is safe precisely because the checkout had nothing to lose.

  Never `git checkout`, `git restore` or `git stash` across a checkout the run did not find
  clean. A discovery run that destroys uncommitted work has changed source, which is the
  one thing it may never do.

Stop confirming at `confirm_until`. A candidate still unconfirmed when the clock reaches it
is Supported, and the report says the clock decided it.

---

## 7. What may be removed, how behaviour may change, and the floor

### The surface is every line

Nothing is out of scope by category. Code, specs and comments are all candidate surface,
and what keeps a finding honest is the evidence it has to show rather than a list of things
it may not look at. Each protects something different, so the bar is per kind:

| what the finding removes | what it must show |
| ------------------------ | ----------------- |
| **code** | the behaviour class below, and the tests covering that code today, by file and test name, with the command that runs them |
| **a spec** | what would still fail if the change were made wrong: the other spec that pins the same rule, named and quoted. Or that the rule it pins no longer exists, shown at `HEAD` |
| **a comment** | which home for that fact survives, and the pointer that reaches it from here. Or the rule the comment itself breaks, quoted from the `AGENTS.md` that states it |

The prior-disposition rule in step 4 protects the **code** a comment explains, not the
comment. A finding about the comment itself is a different claim, and the row above is where
it is judged.

**There is no CI in this workspace and `npm run check` is the whole safety net.** That is
not a reason to exempt a spec, and it is the reason the spec row names a survivor rather
than accepting a count: a finding that thins the net without saying what still catches the
mistake is not Confirmed.

### Behaviour

| behaviour | what it means |
| --------- | ------------- |
| `none` | observable behaviour is identical: the same inputs give the same outputs, the same wire bytes, the same stored state and the same words |
| `little, for the better` | something observable changes, the issue names exactly what and who sees it, and it is an improvement for one of the audiences below |
| `narrowed, with a guard` | a path is removed and a guard clause refuses in its place, naming the limit. Fileable only where the run shows the path is not in use, and the refusal is a sentence the reader can act on |

A behaviour change that is not an improvement is a feature request or a bug report, not a
refactor opportunity: hand it back rather than filing it. For a spec or a comment finding,
this line states the equivalent from the surface table, which is the coverage that survives
or the home that survives.

`narrowed, with a guard` carries the hardest evidence bar here, and every part of it is
needed: no call site, no spec exercising the path, no issue reporting it, and nothing in
`git log` that put it there for a reason still stated. The point of the guard is that the
limit becomes a sentence somebody reads instead of a branch nobody exercises, and the branch
comes back when the edge case does.

### The audiences, ranked by reach

1. Somebody building on the published packages or the scaffold: import shapes, error
   messages, what a new project inherits.
2. The end user of a deployed agent: what it says, how an approval question reads, what a
   failure looks like.
3. Whoever is working inside these repositories.

### The tiers, and the floor

| tier | what it takes |
| ---- | ------------- |
| `structural` | crosses a published surface or more than one repository, or breaks a rule an `AGENTS.md` states outright |
| `recurring` | a cost already paid more than once: two copies that have already diverged, call sites repeating the same lines, a spec written around the shape |
| `local` | one module, one reader, a cost paid once |
| `cosmetic` | a preference with no cost shown. Never filed, at any floor |

**The floor is `min_tier`, and it starts at `recurring`.** It is lowered **only** by an
explicit instruction from the invoking agent, in words, in the brief, and **only to
`local`**. Nothing else lowers it: not a run that has found nothing, not absent history, not
an approaching deadline, not a cap with room left in it. `cosmetic` is never filed at any
floor, because a finding with no cost shown is one a reader cannot act on.

A candidate below the floor is handed to the invoking agent like a Supported one and filed
nowhere. The report carries the floor that was in force, which is a property of the run and
never of a finding.

### What belongs to `restructure` instead

Out of scope, reported by name and never filed here: a change that cannot be made without
breaking a consumer, a stored state or a wire contract; one that needs a Durable Object
migration; one that renames a public identifier (starter's `AGENTS.md` calls a tenant id
rename a re-registration rather than a refactor); and one that needs a three-repo release
train to be safe rather than merely to ship.

`structural` stays the top tier and stays in scope. A cross-repository change that breaks
nothing is the best kind of finding here, not the riskiest.

---

## 8. The third confirmation stops the run, and the order it files in

**The run stops the moment its third finding is confirmed.** No further candidate is opened,
investigations in flight are abandoned, and the run goes to file. Each abandoned attempt is
a report row with status `inconclusive` whose summary says the run stopped at its third
confirmation, so the next run picks it up rather than rediscovering it.

A finding here is one root cause, however many repositories it reaches, and step 10 is
where that is defined and where the issues it produces are counted.

That makes the cap and the stop condition the same number, and it leaves the floor as the
only thing between a run and three mediocre findings. So the cap is **never** a target: no
floor lowered, no weaker candidate promoted into it, no search widened to fill it. A run
that confirmed fewer than three files fewer and says so without apology.

Ranking decides the order of filing and of the report rather than which findings are filed:
the tier first, then net deletion, then reach in the audience order above, then the cost of
leaving it, then the cost of doing it. Net deletion counts every line removed, of any kind,
and where two candidates remove comparable amounts the one removing code ranks first: a
comment or a spec that is pulling its weight costs less to keep than code that is not.

---

## 9. Before filing: what has already been decided

Per owning repository, read the issues already there with the state filter off, which is
every state this caller can see, then read the ones that look close:

```bash
gh issue list -R dynamicagents/<repo> --state all --limit 200 \
  --json number,title,state,stateReason,labels,url,body
gh issue view <n> -R dynamicagents/<repo> --json title,body,state,stateReason,comments
```

**A listing as full as its limit is not known to be complete.** `gh issue list` returns at
most `--limit` rows and says nothing about any it left out, so a run that gets back exactly
as many rows as it asked for raises the limit and reads again, until the answer comes back
short. Until it does, that repository's history is incomplete and a candidate owned by it is
handed back rather than filed, which is the disposition step 3 gives a refused listing and
for the same reason: an older open or declined issue the listing never reached is how the
same finding gets filed a second time.

**The second call is not optional.** A closed issue's `stateReason` carries the category and
never the argument, so the reason a decision was made is in its closing comment and nowhere
else. Then apply the disposition table in `AGENTS.md`, under "What earlier runs and earlier
people already decided": its rows are keyed on the decision a record carries and it names
the issue state that spells each, so there is nothing to translate here. Read the code at
`HEAD` again as well, because a prior reason is evidence about the past rather than about
today.

Three routes this run has and an advisory-based one does not, and it uses all three:

- **`git log` at the location, and `git log -S` for the condition.** A refactor tried and
  reverted is a prior decision that no issue ever recorded.
- **The comments at the location**, which are a prior disposition here (step 4).
- **The pull requests that touched the path.** A reviewer may have declined the same change
  in a thread, which is a decision with no issue behind it either.

`deprioritized` in `dev-agents` is a Declined decision whatever its description invites to
do later: the run never reopens anything, and a premise that is now factually false goes to
whoever asked for the run, who may act.

The same listing answers the `Done so far:` line in step 11, so it is read once and used
twice.

---

## 10. File the finding, one issue per repository that has to change

Which repository owns it is `AGENTS.md`'s, under "The records": the repository that owns the
code, and `dev-agents` for a finding about this workspace itself or about the train as a
whole.

**One finding is one root cause, and it is filed in every repository that has to change.**
Each issue is independently actionable and independently closable by that repository's
maintainer, and all of them together count **once** against the cap in step 8. There is no
ceiling on how many issues one finding produces. Two bounds keep that from being a grouped
record by another name:

- **The split is by where a change has to be made, not by where the symptom is visible.** A
  root cause that is one edit in one repository is one issue, however many repositories
  feel it.
- **Each issue stands on its own.** A reader of the one in `core` can act without opening
  the one in `plugins`. Nothing is a checklist, and no issue waits on another.

State the issue count before filing any of them, so the volume is never a surprise.

```bash
mkdir -p /tmp/refactor-discovery
gh issue create -R dynamicagents/<repo> --label enhancement \
  --title "<the root cause, as a sentence>" --body-file /tmp/refactor-discovery/<n>.md
```

Issue body, in this train's house style, which is a bold run-in rather than a heading:

```markdown
Found by a refactor discovery run. One root cause, filed in every repository that has to
change: <the repositories, by name>.

**What is there now.** The root cause, and this repository's sites, each a full-SHA
permalink with a line range.

**What it costs.** The cost already paid, shown: the divergence, the call-site count and the
command that produced it, the rule quoted, the pull request or issue that paid it.

**What it removes.** Lines by kind (code, spec, comment), and the unit: a branch, an export,
a file, a dependency, a concept.

**What survives it.** For code, the behaviour class and the tests covering it today, by file
and test name, with the command that runs them. For a spec, the other spec that pins the
same rule, quoted, or that the rule is gone. For a comment, the home that survives and the
pointer that reaches it. This run wrote no patch, so none of this is a check it ran.

**Suggested direction.** Where the change would go. Not a patch: this run does not write
one.

Refactor-Run: <the run's UTC timestamp from step 2>
Refactor-Hypothesis: <the phrase this finding is named by>
```

`--label enhancement`, which every repository in the train already has. **The run creates no
label**, milestone or project, and assigns nobody: a repository's configuration is not a
discovery run's to change.

**The trailers are the join, and they are readable.** The same `Refactor-Run` appears on
every issue this run files and on this run's rows in the report table, and
`Refactor-Hypothesis` names the attempt each came from, which is what lets a later run
rebuild the rows that filed once the report carrying them has expired. The sibling issues
of one finding are recognised the same way, together with the repository list in the first
line, which is known before any issue is created. **No issue numbers are cross-written**: that
would need a second pass that edits an issue, and this run edits nothing. The full set of
URLs goes in the report and in the session report instead.

**No key, and no hash.** A record is recognised again by something a person can read, which
`AGENTS.md` settles under "The records". Dedup here is step 9, and it is read rather than
computed.

Then read each issue back by its number and confirm it is there. A refusal at any of these
steps stops the run as in step 3: the prepared bodies stay in `/tmp/refactor-discovery/`,
the operator gets the exact status and the UI route, and nothing is published anywhere else.
**Outside the repository** is the requirement and `/tmp` is how it is met: a path inside a
checkout is one `git add -A` away from a commit nobody reviewed. Where some of a finding's
issues are filed and one is refused, those filed stay filed, and the report names which
repository is missing its half.

If the invoking agent asked for report-back-only, file nothing and hand the findings back
instead, each as a `confirmed, not filed` row whose summary says the caller asked for it.
That and a destination whose history could not be read (step 3) are the cases in which a
confirmed finding is not filed, and the status exists so that neither reads as unknown to
the run after this one.

---

## 11. Write one report

One report per run, human- and agent-readable, written once at the end. Its contract, the
rolling table, the `Done so far:` line and how history ages out are in
`references/run-report.md`.

The run **produces** the report and writes it to `/tmp/refactor-discovery/report.md`, then
hands the text back in the session report. Publishing it where a next run can be briefed
from it belongs to whoever hosts the run, and a local session says plainly that it published
nothing.

---

## 12. Report back

To the invoking agent, in the session: every hypothesis attempted and what happened to each;
each filed issue with its URL, grouped under the finding it belongs to; each Supported
candidate and what stopped it; each candidate below the floor; each candidate held for
`restructure`; the floor in force and who set it; whether the run stopped at its third
confirmation or at the clock; which repositories were behind their `main`; what the brief
did not carry, which of its links would not open, and what that leaves unknown; and the
report text with its path.

---

<!-- guardrail:start -->
- **Report only.** No fixes, no refactors, no dependency, lockfile or version changes, no
  submodule pointer bumps. A run that applied its own finding is the failure this skill
  exists to prevent, and each of those needs separate explicit authorization from the
  invoking agent.
- Findings go to **public issues in the repositories that own the code**, labelled
  `enhancement`. Report-back-only happens when, and only when, the invoking agent asks for
  it.
- **One finding is one root cause**, filed as one issue per repository that has to change,
  each closable on its own, and counting once against the cap. Never one record carrying two
  root causes.
- The run **creates no label**, milestone or project, and assigns nobody.
- **Never a pull request, a branch, a commit or a patch.** A suggested direction is prose.
- **Only a Confirmed finding is filed, and impact never promotes a class.** A candidate
  the run has not verified itself, or that rests on a worker's claim, is reported to the
  invoking agent and filed nowhere.
- **A discovery run writes no patch, so it never establishes that a change is
  behaviour-neutral.** It establishes the root cause, the cost, what would be removed and
  what covers the code today.
- **Every line is candidate surface**, code, specs and comments alike, and no kind is
  removed without its row of the surface table: for code the behaviour class and the tests
  that cover it, for a spec the other spec that still pins the rule, for a comment the home
  that survives.
- **A constraint the code already states is a prior disposition**, and that protects the
  code a comment explains, not the comment.
- **At most three findings are filed in a run, and the run stops the moment its third is
  confirmed.** The cap is never a target: a run that confirmed fewer says so, and no search
  is widened to fill it.
- **`min_tier` starts at `recurring`, and only an explicit instruction from the invoking
  agent lowers it, and only to `local`.** Never an empty run, absent history, a deadline or
  an unfilled cap. `cosmetic` is never filed at any floor.
- **A breaking change is out of scope** and is reported for `restructure`, never filed here.
- **One report per run**, describing that run only. Never a tracking issue, never an omnibus
  thread, never an edit to a report already handed over.
- The skill **never closes, reopens, edits or comments** on an issue, a pull request or an
  advisory, its own records included. Closing is the owner's. History is never filtered by
  state.
- **Never read, echo, log or copy a credential.** Capability is established by response
  codes alone.
- **Every checkout is left as it was found.** A command that can write is not run in a
  checkout that was already dirty, and a checkout the run did not find clean is never
  restored, stashed or checked out: destroying somebody's uncommitted work is changing
  source. The run's own writes are limited to: the issues of a confirmed finding, the
  report it hands back, and files under `/tmp/refactor-discovery/`.
<!-- guardrail:end -->

## References

- `references/issue-api.md`: the issue calls, the permission each needs, what was measured
  against each, and the ways the issues endpoint misleads a reader.
- `references/run-report.md`: the report's contract, the rolling table and its fixed status
  vocabulary, the `Done so far:` line, and what survives when an artifact expires.
