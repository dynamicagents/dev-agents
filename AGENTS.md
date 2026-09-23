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
| [`starter`](starter/AGENTS.md) | the repo you fork: prompt copy, config, and which plugins each agent installs |
| [`create-dynamicagents`](create-dynamicagents/AGENTS.md) | the CLI behind `npm create dynamicagents`, which scaffolds gates, leaders and agents on the framework |

Dependencies run `g2a-protocol` → `core` → `plugins` → `starter`, and never back.
`slack-gatekeeper` is g2a-protocol's other consumer — it depends on the contract
while importing none of the agent runtime, which is the arrangement that lets the
two never share a runtime. It is not checked out here.

`create-dynamicagents` stands outside that chain. It runs on a user's machine
before anything of theirs is installed, so it scaffolds onto the train without
importing any of it.

---

## Where a change goes

| You are changing… | It goes in |
| ----------------- | ---------- |
| a value two repos must spell identically | `g2a-protocol` |
| cancellation, retries, idempotency, durable execution | `core` |
| a capability an agent may or may not have | `plugins` |
| the Durable Object a capability lives in | `plugins` |
| what the model is told about a domain | the plugin that owns that domain |
| what an agent *is*, or how a round ends | `starter` |
| model ids, budgets, limits | `starter/src/config.ts` |
| what `npm create dynamicagents` asks, or writes into a new project | `create-dynamicagents` |

The test for core is not "does an agent vary here" but "**could an agent vary here
and still be correct**". A cancellation ordering cannot. A sentence the model reads
always can.

If you are writing durable-execution logic in `starter`, it belongs in `core`. If
you are writing the Durable Object a capability lives in — a container, its
alarm, its install — it belongs in `plugins`, which ships the object as a base
class the way `core` ships `DynamicAgent`. A consumer subclasses it and answers a
config; what stays in `starter` is the config.

---

## Working across the repos

```bash
npm run bootstrap    # submodules + node_modules + skill links. Run this first.
npm run check        # skill links and submodule structure are intact
npm run skills       # re-link .claude/skills after adding or removing a skill
npm run sync         # put every submodule on its branch and fast-forward it
```

`bootstrap` and `sync` both leave the submodules **on the branch `.gitmodules`
declares** — `next` for starter, `main` for the rest — and never on a detached HEAD. Plain `git submodule update` — and `git clone --recurse-submodules` — check out
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

**starter keeps `next`, because a fork builds its `main`.** Development lands on
`next` by squash, and a release is a PR from `next` into `main` merged with a **merge
commit** — the only method starter's `main` accepts — so `main` only ever gains merges
of `next` and never needs merging back. A fix takes the same path. starter's AGENTS.md
has the rest.

**A release, end to end.** Each step waits for the one before it to be on npm.

1. **core:** a PR into `main` that bumps the version.
2. **plugins:** a PR into `main` with the bump, the core devDependency and peer range
   moved to the new core, and any git ref removed.
3. **starter:** a PR into `next` pinning the new core and plugins, then a PR from
   `next` into `main`, merged with a merge commit.

**Every branch pins published versions by default; a git ref is temporary.** While a change needs
upstream work that is not yet published, plugins may point its core devDependency at
core's `main` by git ref, and starter's `next` may point at core's or plugins' `main`,
for as long as it takes. The release PR removes the ref. plugins' Release refuses to
publish while one is left, and starter's Test fails a PR into `main` that names one.

Two things make a git ref installable, and both are easy to undo by accident.
`prepare` runs `build` in core and plugins, because `dist/` is not committed and npm
runs `prepare` when installing a git dependency. And a consumer lists them in
`allowScripts`, or npm declines to run that `prepare` for them.

### The submodule pointers

A pointer is a **known-good combination**, not a mirror of each submodule's `main`.
Every commit in a subrepo makes its pointer stale, and that is the design: bump one
deliberately — after a green train — rather than on every commit. `npm run sync`
moves the checkouts and tells you which are ahead of their pin; advancing a pin is a
separate `git add` and a commit that says so. `npm run check` deliberately does not
fail on staleness; it checks only that the submodules would survive a clone.

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

- **Opening a PR ready for review requests it**, whichever branch it targets —
  starter's `next` into `main` included, though no rule there asks for one.
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

## Running Claude here

Launch from this directory. Skill discovery walks parent directories only as far as
the repository root, and each submodule is its own repository root — so a session
started inside `core/` may not see the workspace skills, while one started here sees
both these and, on demand, each repo's own `AGENTS.md` as you work in it.
