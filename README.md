# dev-agents

**The development environment for [Dynamic Agents](https://github.com/dynamicagents).**

The repos that ship as one train, pinned together at a known-good combination, plus
the agent skills they share — so a laptop, a cloud session, or a machine that has
never seen this project all reach the same place from one clone.

```bash
git clone --recurse-submodules https://github.com/dynamicagents/dev-agents.git
cd dev-agents
npm install && npm run bootstrap
```

Then launch your agent from this directory.

| repo | |
| ---- | --- |
| [`g2a-protocol`](https://github.com/dynamicagents/g2a-protocol) | the gatekeeper↔agent wire contract |
| [`core`](https://github.com/dynamicagents/core) | the mandatory foundation |
| [`plugins`](https://github.com/dynamicagents/plugins) | optional composable capabilities |
| [`starter`](https://github.com/dynamicagents/starter) | the train's reference deployment |
| [`create-dynamicagents`](https://github.com/dynamicagents/create-dynamicagents) | the CLI that scaffolds gates, leaders and agents |

[`AGENTS.md`](AGENTS.md) is the working guide — where a change goes, how the publish
train runs, and the conventions that span more than one repo. It is symlinked to
`CLAUDE.md`, because Claude Code reads that name.

---

## Skills

Skills live in `.agents/skills/`, with a link to each in `.claude/skills/`, which is where
Claude Code reads them. Both are committed, so a clone carries its skills, and
`skills-lock.json` records where each came from. The workspace's own skills are authored in
[`dev-skills`](https://github.com/dynamicagents/dev-skills): `superproject`, which is how this
workspace works and the scripts `npm run` calls, `pull-requests`, and the discovery runs
below. The platform skills come from Cloudflare's and Vercel's own repositories.

`security-audit-discovery` goes looking for work rather than doing it: it
researches how parts of the train behave when they are composed, confirms what it can
evidence, files the best few findings as private advisories in the repository that owns the
code, and changes no code itself. A caller names it in the prompt and hands it the
threshold and the recent history to work against; it cannot be picked up off its
description. [`AGENTS.md`](AGENTS.md#discovery-runs) carries the rules any discovery run
follows.

`issue-discovery` is the second such run: where Claude Code's
`simplify` and `code-review` look at the code a branch changed, this reads every repository
at rest and changes nothing. It looks for bugs, behaviour no test would catch breaking, docs
that say something the code does not, and maintenance surface the train no longer needs, in
small waves of hypotheses drawn from angles that rotate between runs. It keeps three
standalone findings, goes deep on those so each names every site, and files each once as a
public issue in the repository that holds the root cause; the small items it met on the way
go into one bundle issue per repository. Being honest about it: the run files issues and
fixes nothing by itself, so its report carries a count of what earlier findings actually
became.

`restructure-discovery` is the third, and it looks for a better way rather than a wrongness.
Nothing it files is broken: what it files is a decision the train made once, under facts that
have since moved, where a different direction would serve the long term better. It reads the
decisions these repositories write down, re-checks each stated premise against the code at
`HEAD` and against what has shipped upstream, reads outside this workspace, and files at most
three proposals as public issues in the repository that owns the decision. Each one carries
where we are now, a forecast of the gain against the loss with the class of evidence behind
every claim, a metric chosen for that proposal and how it is re-evaluated later, the reversal
cost, and a favourable and a skeptical reading. It proposes and never implements: taking the
decision, and carrying it out, are the owner's.

## Commands

| | |
| --- | --- |
| `npm run bootstrap` | submodules, `node_modules`, and skill links. Safe to re-run. |
| `npm run check` | skill links, submodule structure and the specs all hold |
| `npm run skills` | re-link `.claude/skills/` after adding or removing a skill |
| `npm run sync` | put every submodule on its branch and fast-forward it — run after merging a submodule PR |
| `node .agents/skills/superproject/scripts/submodules.mjs --pushed` | every pinned commit is on a remote. Needs the network, so it is not in `check` |

## The submodule pointers

A pointer is a known-good combination, not a mirror, and `bootstrap` and `sync` leave every
submodule on its branch rather than a detached HEAD. The
[`superproject`](.agents/skills/superproject/SKILL.md) skill has both rules and why.

## License

Apache 2.0. Each submodule carries its own copy.
