# AGENTS.md — the Dynamic Agents workspace

The repos that ship as one train, plus the skills they share. Everything here is
either a pointer into a submodule or a rule that spans more than one of them; a
rule that belongs to a single repo lives in that repo's own `AGENTS.md`, which is
authoritative for it.

| repo | what it is |
| ---- | ---------- |
| [`g2a-protocol`](g2a-protocol/AGENTS.md) | the gatekeeper↔agent wire contract: constants and pure functions, no dependencies |
| [`core`](core/AGENTS.md) | the mandatory foundation — zero-trust A2A, the durable task lifecycle, the delegating loop |
| [`plugins`](plugins/AGENTS.md) | optional composable capabilities, one subpath export each |
| [`starter`](starter/AGENTS.md) | the train's reference deployment — prompt copy, config, and which plugins each agent installs |
| [`create-dynamicagents`](create-dynamicagents/AGENTS.md) | the CLI behind `npm create dynamicagents`, which scaffolds gates, leaders and agents on the framework |

Dependencies run `g2a-protocol` → `core` → `plugins` → `starter`, and never back.
`slack-gatekeeper` is g2a-protocol's other consumer, and a consumer of `core` too,
from outside the chain. Its built-in agents — admin and onboarding — are core
tenants: agents mounted with `defineAgent` and served by `createA2AWorker`, the
way starter's are, but inside the gatekeeper's own Worker. It still calls them
with the same token and push callback `g2a-protocol` defines for a remote agent.
So core's `agents` and `@cloudflare/think` peer ranges bound the gatekeeper's, and
a core change it needs reaches it only once core is on npm — step 1 of "A release,
end to end" under "Working across the repos". It is not checked out here.

`create-dynamicagents` stands outside that chain. It runs on a user's machine
before anything of theirs is installed, so it scaffolds onto the train without
importing any of it.

---

## Where a change goes

| You are changing… | It goes in |
| ----------------- | ---------- |
| a value two repos must spell identically | `g2a-protocol` |
| cancellation, retries, idempotency, durable execution | `core` |
| a Durable Object mechanism any object may use — many deadlines over its one alarm, a job it drives | `core` (`/alarm`, `/job`) |
| a capability an agent may or may not have | `plugins` |
| the Durable Object a capability lives in | `plugins` (a container whose disk is the checkout: `/sandbox`) |
| what the model is told about a domain | the plugin that owns that domain |
| how a task's steps run — the task host, the task workflow, a step job | `core` (`/task`, `/workflow`, `/agent`) |
| which steps a tenant's task runs — its pipeline | `starter` |
| what an agent *is*, or how a round ends | `starter` |
| an agent's name, or its classes' | `starter` (its `AGENTS.md`, "Adding and removing agents") |
| model ids, budgets, limits | `starter/src/config.ts` |
| what `npm create dynamicagents` asks, or writes into a new project | `create-dynamicagents` |

The test for core is not "does an agent vary here" but "**could an agent vary here
and still be correct**". A cancellation ordering cannot. A sentence the model reads
always can.

If you are writing durable-execution logic in `starter`, it belongs in `core`, and
so does any mechanism a Durable Object could use — an alarm shared by many
deadlines, a job driven through it. If you are writing the Durable Object a
capability lives in — a container, its git, its install — it belongs in `plugins`,
which ships the object as a base class the way `core` ships `StepAgent`. A consumer subclasses it and answers a
config; what stays in `starter` is the config.

**An agent is named for what it does** — `coding`, `claude-coordinator` — and one with no
specialty for its purpose, `generic`. Its classes share one shape, `<Tenant>Host`,
`<Tenant>Workflow`, `<Tenant>Agent` and so on; the whole pattern is starter's.

---

## Working across the repos

```bash
npm run bootstrap    # submodules + node_modules + skill links. Run this first.
npm run check        # skill links, submodule structure and the specs all hold
npm run skills       # re-link .claude/skills after adding or removing a skill
npm run sync         # put every submodule on its branch and fast-forward it
```

`bootstrap` and `sync` both leave the submodules **on the branch `.gitmodules`
declares** — `main` for every one of them — and never on a detached HEAD. Plain `git submodule update` — and `git clone --recurse-submodules` — check out
the recorded *commit*, and a commit is not a branch, so they detach you and the next
commit you write goes somewhere no branch can see. Run `npm run sync` after merging a
PR in one of the repos and it fetches, checks out the branch and fast-forwards.

Neither touches a submodule with uncommitted changes, or one you have checked out
onto a feature branch that is still on GitHub. Merging a PR deletes its branch, and
`sync` takes that as finished: it moves a clean submodule off it onto the declared
branch, and keeps the branch.

### Remotes are HTTPS, and SSH is yours alone

`.gitmodules` spells every url `https://github.com/…`, and `npm run check` fails anything
but that or a relative path — a relative url resolves against this repo's own remote, so
it arrives by whatever transport the clone used and needs no opinion of its own. A
committed url has to work in the least-equipped place that will ever read it, and that is
not this laptop: a cloud session holds a GitHub token and no key, installs no
`openssh-client`, and reaches the network through an HTTP gateway that carries no SSH at
all. A token cannot be turned into a key from inside such a session, so a
`git@github.com:` url there is not slow or awkward — it is unreachable.

Preferring SSH is a *local* matter, and git has the mechanism:

```bash
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

Every fetch and push to GitHub then goes over SSH while the recorded url stays HTTPS —
`git clone` records the url it was **given**, not the rewritten one, so this changes no
file and nothing about it is committed.

**It has to be global.** A submodule is its own repository: git inside `core/` reads
`core`'s config and yours, never the superproject's, so a rewrite in `dev-agents/.git/config`
would work for this repo and silently not for the submodules underneath it. Scope it with
an `includeIf.gitdir:` include if you want it narrower than every GitHub repo you own.

An existing checkout keeps whatever url `git submodule init` copied into it until
`git submodule sync --recursive` moves it. `npm run bootstrap` runs that first, so
re-running it is enough.

The `git+ssh://` lines in plugins' and starter's `package-lock.json` are **not** the same
problem, and changing them makes things worse. Both `package.json` files already ask for
`git+https://`; npm records the ssh spelling because that is what pacote's `repoUrl()`
returns for a hosted repo, and then downloads the codeload HTTPS tarball rather than
cloning, precisely because the two match. Spell them `git+https://` and they stop
matching, and npm falls back to a real clone.

**Verify with `npm run check` in the repo you touched, not `npm test`.** Vitest
transpiles specs without typechecking them, so a type error passes a green suite
anywhere in the train. Where wrangler moved, `npm run types` first and commit the
regenerated `worker-configuration.d.ts` — it is generated but committed, because a
fresh clone has to typecheck without running a script.

**A local cross-repo install is `npm run link:local`** — `npm pack` plus a tarball
install — and never `npm link`. A symlinked checkout brings its own copy of every
peer, and two copies of `agents` in one Worker bundle break the `Session` and
`SessionMessage` types and every `instanceof`, at runtime rather than at the type
level.

**The published packages develop on `main`, and npm is their released line.** In
g2a-protocol, core, plugins and create-dynamicagents a PR squash-merges into `main`,
and a merge without a version bump ships nothing, so changes batch on `main` until a
PR that bumps the version releases them. That keeps a bump a deliberate act rather
than something that rides every merge.

**Publishing: a version bump reaching `main` is what ships it.** On the first green
Test run for a commit carrying that version, `release.yml` publishes to npm over
OIDC and only then cuts the tag. There is no separate publish step to forget and
none to take back. Core ships first; a contract change is a three-repo train, so one
repo is always briefly behind, and `PLUGIN_CONTRACT_VERSION` is asserted at DO start
so a skew fails with a sentence naming the plugin.

The release gate reads the **registry** — is `name@version` already published? — not
the commit log, so batching is safe: a merge of many commits and one bump publishes
once, and a merge with no bump does nothing.

**A release, end to end.** Each step waits for the one before it to be on npm.

1. **core:** a PR into `main` that bumps the version.
2. **plugins:** a PR into `main` with the bump, the core devDependency and peer range
   moved to the new core, and any git ref removed.
3. **starter:** a PR into `main` pinning the new core and plugins.

**A git ref onto an unpublished `main` is allowed, and what ends it differs by repo.**
While a change needs upstream work that is not yet published, plugins may point its core
devDependency at core's `main` by git ref; its Release refuses to publish while one is
left, so the release PR removes it. starter publishes nothing and nothing checks it, so a
ref may sit on its `main`, and the deployment then runs those library mains in
production — exercising them there is the point.

Two things make a git ref installable, and both are easy to undo by accident.
`prepare` runs `build` in core and plugins, because `dist/` is not committed and npm
runs `prepare` when installing a git dependency. And a consumer lists them in
`allowScripts`, or npm declines to run that `prepare` for them.

### Claude Code's version

**A dependency round includes the Claude Code CLI** that starter's `claude-coordinator`
image installs. Its version is pinned, because plugins' egress gateway and stream
parser are written against one version's traffic, and it moves only once plugins has
verified a newer one:

1. **plugins:** `npm run probe:claude-code`. If it passes, `-- --record` and commit
   what it writes in the round's plugins PR. The report lists what changed since the
   verified version — say it in the PR.
2. **starter:** once plugins' `main` has it, move the pin in `wrangler.jsonc`.
   `npm run check` fails until the two agree.

If the probe fails, the pin stays where it is and the round says which check failed.
plugins' AGENTS.md ("Updating Claude Code") has the rest.

### The submodule pointers

A pointer is a **known-good combination**, not a mirror of each submodule's `main`.
Every commit in a subrepo makes its pointer stale, and that is the design: a bump is
deliberate — it needs a green train behind it, and it waits for the train's owner to
ask for one.

**A PR whose only change is a gitlink is never opened unprompted.** A green train
makes a bump possible, not due, and re-pinning on that alone spends a review to
decide nothing.

`npm run sync` moves the checkouts and tells you which are ahead of their pin;
advancing a pin is a separate `git add` and a commit that says so. `npm run check`
deliberately does not fail on staleness; it checks only that the submodules would
survive a clone.

---

## Pull requests

**Every Copilot review comment ends resolved.** Copilot reviews the PRs in all of
these repos, and a PR is not ready to hand over while one of its threads is open.

Resolved does not mean accepted. Read each comment against the code first — Copilot is
often right, and sometimes confidently wrong about an API it has not read or behaviour
it cannot run. Then fix it and reply naming the commit, or reply saying why not, and
resolve the thread either way, so it records what happened. The review summary can
raise points that are not threads; read those too.

**One Copilot review per PR, answered in one pass.** Every review is billed. The one
GitHub requests on its own when a PR opens ready for review is the only one a PR gets,
so never ask for another — not with `gh pr edit --add-reviewer @copilot`, not from the
Reviewers menu — however large the fix, and even when the review summary offers one.
Answer that review in a single wave: fix what holds up, push, then reply to and resolve
every thread. The fixes are checked by `npm run check` and the specs, not by a second
review. If a PR ever needs one, a person asks for it.

Resolving a thread is GraphQL-only:

```bash
# The open threads, with the id both mutations take. `--paginate` walks every page of
# threads — without it, a long review can look clean.
gh api graphql --paginate -F o=dynamicagents -F r=<repo> -F n=<pr> -f query='
  query($o:String!,$r:String!,$n:Int!,$endCursor:String){repository(owner:$o,name:$r){pullRequest(number:$n){
    reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{id isResolved path line
      comments(first:1){nodes{author{login} body}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not)'

gh api graphql -f id=<thread> -f body='<the fix and its commit, or why not>' -f query='
  mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(
    input:{pullRequestReviewThreadId:$id,body:$body}){comment{url}}}'

gh api graphql -f id=<thread> -f query='
  mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
```

### Knowing Copilot has finished

The review is requested automatically, and exactly when is worth knowing:

- **Opening a PR ready for review requests it.**
- **A draft gets no request** while it is a draft.
- **A push requests nothing.** The review of an earlier commit is the last one a PR
  gets — fixing Copilot's comments does not bring it back, and nothing here asks for
  it again (see above).

Finished is an event on the PR's timeline, not an absence of comments: a review can
finish having left none. Copilot's latest review event answers it:

```bash
gh api repos/dynamicagents/<repo>/issues/<pr>/timeline --paginate --jq '
  .[] | select((.event=="review_requested" and .requested_reviewer.login=="Copilot")
            or (.event=="reviewed" and .user.login=="Copilot")) | .event' | tail -n 1
```

`reviewed` means done. `review_requested` means still working. No output means it was
never asked, and waiting will not change that — a draft, usually. Reviews here have
landed from under two to about five minutes after the request, so poll no faster than
every thirty seconds, and stop after fifteen minutes rather than wait on a review that
never started.

**Merge only once it says `reviewed`.** Merging does not cancel a review in progress:
it still lands, on the merged PR, and its threads still have to end resolved — with
the fixes now needing a PR of their own. The thread-resolution rule on a branch cannot
catch this, because a review that has not landed has no threads to hold the merge.

---

## Prose

**Avoid the em dash.** A comma, a colon, a semicolon, a pair of parentheses or a full
stop carries the same break, and one of them nearly always fits. Where none of them
reads well, the sentence is holding two thoughts at once, so split it or restructure it
until the aside is a clause that stands on its own. This covers every kind of prose
written here: these `AGENTS.md` files, the skills, code comments, commit messages and
pull request bodies.

It is a rule for prose as it is written, not a licence to sweep. An em dash in text
nobody is otherwise editing stays until that text is edited for its own reasons, so that
a diff carries a change of meaning rather than a change of punctuation.

---

## Comments

These repos comment heavily, and that is deliberate: much of what is in them was
expensive to learn and invisible in the code. The cost is that comments rot, so they
are held to the same bar as the code.

A comment states a **constraint, a measurement, or a coupling** — something that
changes a decision. Not what changed, not when, not what a previous version said;
`git log` owns that.

- **No changelog.** "This used to…", "the design plan called for…" are history.
  Write the rule that survives it. A measurement is worth keeping; the date it was
  taken is not.
- **No package versions or dates** in prose. Stale on the next bump, and nothing
  checks them.
- **One home per fact.** Put the explanation where somebody editing that behaviour
  will see it, and a pointer everywhere else. Copies do not stay in step, and then
  the reader cannot tell which is current. This applies across the train too: a rule
  core enforces is explained in core and pointed at from the consumer.
- **No counts.** "the three tables", "the four values below". Every one of these was
  wrong within a release. Name the thing, not how many there are.
- **Cross-file references name a real path**, and a path in a comment is checkable —
  so check it before writing it. A path into another repo of the train does not
  resolve from a consumer's checkout: name the module in prose instead.

If a comment is longer than the code it explains, ask what decision it is protecting.

---

## Skills

Skills live in `.agents/skills/`. Claude Code reads `.claude/skills/`, which holds a
symlink per skill and is **generated** — `npm run skills` after any change, and
`npm run check` fails when the two drift.

```bash
npx skills add <pack>    # writes to .agents/skills/ only
npm run skills           # then link it where Claude Code will find it
```

The CLI knows nothing about `.claude/skills/`, and a skill that never got linked
fails silently: Claude Code does not announce a skill it did not find. That is the
whole reason the check exists.

A skill written here by hand is as valid as a vendored one: `skills-lock.json` records
only what `npx skills` installed, and nothing requires an entry. `npm test`, which
`npm run check` runs, reads the frontmatter of every skill either way: a `name` that
disagrees with its directory, or a malformed block, is dropped by Claude Code as
silently as a missing link. `scripts/skills.test.mjs` says what else it pins.

### Why the LangChain skills are installed

The `langchain-*`, `langgraph-*`, `deep-agents-*` and `langsmith-*` skills describe
libraries this workspace **does not use and must not install**. They are here as
prior art.

What we build on — the Vercel AI SDK (`ai`) and the Cloudflare Agents SDK
(`agents`) — has not reached LangChain's maturity on several of the problems this
framework has had to solve for itself: durable orchestration, persistence and
checkpointing, human-in-the-loop, memory, multi-agent handoff, evaluation. Core's
`/round`, `/subagent` and `/subtasks` exist precisely because that ground was not
covered. So when designing something new, read how LangGraph or DeepAgents handled
the same problem before inventing — they have met the failure modes already.

**Consult, never import.** Nothing in the train depends on a LangChain
package and nothing should start to. The risk these skills create is exactly that: a
skill fluently describing `langgraph`'s persistence API, loaded while someone is
designing checkpointing, is one step from `npm install`. They are a design input.
The output is our own code, on our own two SDKs.

---

## Discovery runs

A **discovery run** goes looking for work rather than doing it: it finds candidates,
establishes which are real, ranks them, files the best few where they will be found
again, and changes no code. `security-audit-discovery` is such a run, and it is
triggered by a person; nothing schedules it.

What a run looks for, where it looks and what its evidence has to be are the skill's
own, in `.agents/skills/<name>/SKILL.md`. What is here is every rule that is not about
one kind of finding, so that a run of any kind has one place to read them from.

A run reads every repository in the train, which is one more reason a session starts in
this directory.

### The prompt names the skill

A discovery run happens because the prompt that starts the session names the skill, on
its first line, as `/<skill-name>`. Claude Code reads that line as an invocation and
loads the skill before the rest of the prompt. Whoever asked for the run writes that
line: a person, or the Coordinator delegating for one. That is the whole mechanism:
nothing in the train carries the choice as a structured input, and neither `starter` nor
`plugins` knows a discovery skill exists. A prompt without such a line is an ordinary
session.

Prompt-only means nothing in the train validates the name. Claude Code does: a first
line naming no installed skill does not run, and the session is told so, given installed
names to compare it with, and told to treat what is left as a plain request. So a
misspelled name loses the run rather than hiding it. No skill is loaded, the task goes
ahead as an ordinary session, and that session can report which run never started
instead of improvising one. A caller copies the name above rather than typing it.

A discovery skill also sets `disable-model-invocation: true`, which takes the choice
away from the model entirely: the skill cannot be picked up off its description, only
named. A run files private advisories and a public record, which is the case the
Claude Code docs name for that field. **Its cost is real**: a skill with it set is not
preloaded into a subagent, so each skill briefs its own passes in the prompt it writes
rather than assuming the subagent can read the skill.

### Evidence first: the gate

Every candidate is placed in one of the classes below, and the class is decided by
**what evidence exists**, never by how sure the run feels:

| class | what it means |
| ----- | ------------- |
| **Confirmed** | a reader can re-run the check. A named command and its output, or permalinks that show the claim on their face |
| **Supported** | it follows from code a reader can see, but the last step is judgment, and no command or permalink closes it |
| **Speculative** | neither. Dropped, and not reported |

**Only Confirmed is fileable, and impact never promotes a class.** A Confirmed finding
of small value can be dropped by the ranking below; a Supported finding of enormous
value cannot be filed, however much it matters. It goes to the Coordinator in the
session's report and no further. What makes a finding Confirmed is the skill's own, and
it says so.

No score and no threshold. A number a model produces for its own confidence is not a
probability, and a published bar is something to clear rather than a test to pass.

### Ranking, and at most three

Ranking runs over the Confirmed set only, ordinally, on the axes below, each answered
with evidence rather than an adjective:

- **Reach**: call sites, repositories, whether it crosses a published surface.
- **Cost of leaving it**: recurring issues, review time spent on it, a spec written
  around it.
- **Cost of doing it**: an in-repo edit, a published surface's change, a Durable Object
  migration, a three-repo release train.

No weights and no total: the run states the order and the sentence that decided each
adjacent pair. Then it files **at most three**. Fewer or none is a normal run, and the
report says so without apology. A fourth Confirmed finding goes to the Coordinator in
the session's report, where if it is lost the next run rediscovers it.

The cap is on records filed. It is not a target: reaching for a weaker candidate to fill
it is the one failure this whole design exists to prevent.

### What earlier runs and earlier people already decided

Before a candidate is prepared, the run reads the history of the area in the repository
that owns it, by every route the store those records live in offers. **A label is never
the only route**: a prior record may predate the labels or carry none at all, and
`dynamicagents/plugins#66` is labelled `bug`. Every lookup passes `--state all`: a
record is closed once its owner has read it, and a closed record is ordinary history.

Then it re-reads the code at `HEAD`, because a prior reason is evidence about the past
and not about today, and it reads the comments at the location. **In these repositories
a comment stating the constraint is a prior disposition**: comments here are held to the
code's bar and record what was expensive to learn, so a candidate the code already
explains is not a finding unless the run shows the stated constraint no longer holds.

| prior record | what the run does |
| ------------ | ----------------- |
| **Open, same claim** | File nothing. Report that it is already open, and name it. Never comment on it; new evidence goes to the Coordinator, who may act |
| **Closed `COMPLETED`, the code shows it fixed** | Not a candidate. File nothing |
| **Closed `COMPLETED`, the condition is back** | A regression, and fileable as a **new** record naming the prior one, with evidence of both the fix and what undid it. **Never reopen** |
| **Closed `NOT_PLANNED`** | An accepted decision. **Do not re-file.** The only unlock is a premise that is now factually false: quote the stated reason (which is in the closing comment, never in `stateReason`) and show the code or constraint that contradicts it. A reason that was a preference stays closed, and the run says so |
| **Closed as a duplicate** | Follow to the canonical record and apply *its* disposition |
| **Open, stale**: the code moved and the claim no longer matches its location | File nothing, comment nothing. Report that it is stale, name it, and say what moved. Closing it is the owner's |
| **None** | Eligible |

**A rediscovery is not a finding.** The test is the claim, not the prose: a new finding
must differ in its named opportunity class, not merely in wording or in which file of
the same module it points at. A prior record is context when it constrains the finding:
when it explains why the code is as it is, names a decision, or supplies evidence.

### The records

**One record per opportunity**, never a grouped one: a grouped record cannot be closed
per item or deduped per item, which breaks the disposition table above. An opportunity
that spans repositories is still one record: one opportunity, one record.

Where it lands is the repository that **owns the code**, and `dev-agents` only for
findings about the workspace itself. **What a finding is written down as is the skill's**,
and `security-audit-discovery`'s is a private advisory, never a public issue; that route
is under "Security findings are private, and coverage is not".

**A citation is a full-SHA permalink with a line range**, and it is not decoration: it is
what makes a finding re-checkable by somebody reading it in a month, and therefore what
makes it Confirmed rather than asserted.

A record's key carries the normalized path with **no line number**, because a finding
outlives the line it sat on.

A label is created only when a lookup says it is absent, and **never with `--force`**,
which edits an existing label's colour and description. A discovery run makes no edits.

### What a discovery run never does

- **No source changes.** No fix, no refactor, no dependency, lockfile or version edit, no
  submodule pointer bump. A run leaves every checkout it touched clean, and any draft it
  writes lives under `/tmp`, outside the repository.
- **Never closes, reopens, edits or comments** on an issue, a pull request or an advisory,
  its own records included. Closing is the owner's.
- **Never files more than the cap**, and never a tracking issue or an omnibus thread.
- **Never reads, echoes, logs or copies a credential.** What a credential can do is
  established by response codes alone.

**The credential a session holds is not the Worker's.** `GITHUB_TOKEN` in
`starter/wrangler.jsonc` belongs to the deployment; a Claude Code session's `gh` is
credentialed separately, and a scope granted to one does not reach the other. So a run
probes its own capability against each destination before looking for anything (by
response code, with a body that cannot create), and stops with the endpoint named if it
is refused, rather than finding another way to publish.

### Security findings are private, and coverage is not

**A security finding goes to a GitHub security advisory in the repository that owns the
code**, filed through that repository's own private vulnerability reporting; its
`SECURITY.md` is authoritative for the route, and the skill reads it at run time. A
finding about the train itself, or about this workspace, goes to `dev-agents`, which is
why this repository has a `SECURITY.md` of its own. **Never a public issue, pull request,
commit message or discussion.** If the advisory route is refused the run stops and asks.

**Coverage is public bookkeeping.** One issue per run in this repository, labelled
`security-audit`, which is deliberately not the skill's name: the label indexes records
already filed under it, and a record looked up under a name it was not filed under reads
as a lap that covered nothing. Each record describes that run only: which slices were
read, at which commits, which sweeps completed, which lap it is, and where the next run
starts. What a record may never carry has one home, the guardrail block in
`.agents/skills/security-audit-discovery/SKILL.md`: that is the list a spec pins and the
list a reader of the skill meets. The record exists because a run that finds nothing
leaves no advisory, and without it there would be no trace that the code was read. And
because nothing about the audit is kept on disk, a worktree made a minute ago recovers
where the audit got to by reading those records back.

The rotation and its records exist because an advisory cannot be labelled, filtered by
date or searched, so where the audit has been is not derivable from what it filed.
`.agents/skills/security-audit-discovery/references/advisory-api.md` establishes that
against the API.

---

## Running Claude here

Launch from this directory. Skill discovery walks parent directories only as far as
the repository root, and each submodule is its own repository root — so a session
started inside `core/` may not see the workspace skills, while one started here sees
both these and, on demand, each repo's own `AGENTS.md` as you work in it.
