---
name: refactor-discovery
description: >-
  Find the best next in-place reshaping of committed code in the Dynamic Agents train
  (duplication across modules, a dead export, a helper that wants extracting, a name
  that fights the pattern its repo already uses), and file each one as a GitHub issue in
  the repository that owns the code. Discovery only: it proposes nothing to run, edits
  no source and opens no pull request. Use when asked where a refactor would pay, or to
  go looking for refactoring work. Not for reshaping a named module on request, not for
  tidying code just written (that is `simplify`), not for reviewing a diff or a pull
  request (that is `code-review`), and not for moving code between repos or directories,
  which is `restructure-discovery`.
disable-model-invocation: true
---

# Refactor discovery

A run goes looking for the reshaping that would pay most, establishes that it is real,
and files it where whoever does the work will find it. **It changes no code.** The
output of a run is issues and a report, not a diff.

The workspace `AGENTS.md`, under "Discovery runs", carries the gate, the ranking axes,
the disposition table, the citation rule, the cap and the rule against edits. Read it
first; this file carries what is specific to a reshaping.

A reshaping keeps behaviour identical. A candidate that would change what the code does
is a bug or a feature and belongs to neither this skill nor a refactor: report it and
file nothing.

---

## 1. Check the credential, and the destination

A finding is filed in the repository that owns the code, so the run has to be able to
write issues there. Probe each repository it could file in, before reading anything.
None of these creates anything, because the body is missing a required field: a `422` is
the green light, a `403` is a refusal.

```bash
echo '{}' | gh api -i --method POST repos/dynamicagents/<repo>/issues --input -
```

`-i` is load-bearing: without it `gh` prints the body and the status and swallows the
response headers, and `X-Accepted-Github-Permissions`, the permission GitHub says the
endpoint wanted, is the only thing that separates a missing permission from a missing
role.

On a `403`, **stop** and report which endpoint refused and what that header asked for.
Never read, echo, log or copy a credential.

---

## 2. Choose where to look

A run reads whole modules, not a diff, so where it reads is most of what decides whether
it finds anything. Choose from signal the run can compute, not from memory:

- **Churn since the last discovery issue in that repository.** What has been edited a
  lot since anyone looked is where duplication accumulates.
- **Prior-record density.** A module with several closed `bug` issues is a module whose
  structure is costing something.
- **Size outliers**, by tracked line count: `(cd <repo> && git ls-files src | xargs wc -l)`.
  The subshell is the point: `git -C` leaves the shell where it was, `ls-files` prints
  paths relative to the repository, and `wc` then reads them against the workspace root
  and reports every one as missing while exiting 0.
- **What a repository's own `AGENTS.md` says has already broken**: those paragraphs are
  the project's own account of where its shape hurts.
- **A fairness floor.** No repository goes many runs unvisited; which repositories recent
  discovery issues name is derivable from the issues themselves.

Say in the report which of these chose the area, and at which commit it was read.

---

## 3. The passes, in order

Each pass has to establish its own thing before the next may start. How to run them
(one reader or several, in parallel or not) is the session's own decision: it is the only
party that knows its concurrency budget, and this skill is not preloaded into subagents
(`AGENTS.md`, "The Coordinator names the skill"), so a subagent gets whatever the prompt
that starts it carries.

1. **Read the area.** The modules, their specs, and the `AGENTS.md` of the repository
   they live in. A constraint recorded in a comment is a decision already taken.
2. **Name candidates.** Each as a one-sentence claim about what is there now, with the
   locations it is at.
3. **Verify, with a reader that did not propose.** The failure mode of discovery is a
   plausible-sounding structural opinion, and this is the pass that catches it. The
   verifier's job is to re-run the evidence, not to agree with the claim.
4. **Gate**, then **rank**, then **file at most three**, then **report**. All four are
   `AGENTS.md`'s.

---

## 4. What Confirmed means here

The gate is in `AGENTS.md`; these are the artifacts that satisfy it for a reshaping.
Anything that cannot be put in one of these forms is Supported at best, and a Supported
candidate is reported and never filed, whatever its value.

| candidate | what Confirmed requires |
| --------- | ----------------------- |
| **Duplication** | two or more named spans, shown, that a reader can compare: permalinks, and the lines that differ |
| **A dead export** | the search, named, over every repository in the train, with no hit outside the module itself and its spec |
| **A helper worth extracting** | the call sites, named, each of which would use it |
| **A name against the repo's pattern** | the pattern, quoted from that repository's `AGENTS.md` or shown in its siblings, and the names that depart from it |
| **A spec written around the shape** | the test, named, whose setup exists only because of the structure |

A dead export in a **published** package is a narrower claim than it looks: `core`,
`plugins` and `g2a-protocol` are consumed from outside this workspace, so "no caller
here" is not "no caller". Say so in the finding, and let the cost axis carry it:
removing it is a breaking change for anyone who imports it.

---

## 5. What is not a finding

- Anything `simplify` or a formatter would do: import order, a local's name, a comment's
  wording.
- An opinion with no benefit anyone can measure. "This would be cleaner" is Speculative.
- A shape a comment at the location already explains, unless the run shows the stated
  constraint no longer holds.
- A repository's existing pattern, disliked. A pattern beats a generically better
  alternative here: a tenant's classes are `<Tenant>Host`, `<Tenant>Workflow`,
  `<Tenant>Agent`, and matching that matters more than a name picked fresh.
- A move between repositories or directories. That is `restructure-discovery`, and the
  workspace `AGENTS.md` table, "Where a change goes", is what tells the two apart.
- A security weakness. That goes to `security-audit-discovery`, which files it privately,
  and it is never described in a public issue.

---

## 6. Filing

One issue per opportunity, in the repository that owns the code, shaped as `AGENTS.md`
describes, labelled `refactor-discovery`, created only if a lookup says it is absent,
and never with `--force`.

```bash
# Is the label there? Only create it on `false`.
gh label list --repo dynamicagents/<repo> --limit 100 --json name \
  --jq 'any(.name == "refactor-discovery")'
gh label create refactor-discovery --repo dynamicagents/<repo> \
  -d "Found by a refactor discovery run: an in-place reshaping, with its evidence" -c 1D76DB

# Prior records, both ways: the label, and a search that does not depend on it.
gh issue list --repo dynamicagents/<repo> --label refactor-discovery --state all \
  --limit 100 --json number,title,state,stateReason,labels,url,body
gh issue list --repo dynamicagents/<repo> --state all --limit 100 \
  --search 'in:body "<path>"' --json number,title,state,stateReason,url,body

# Then each close candidate in full. `stateReason` is `NOT_PLANNED`, never why:
# the stated reason is in the closing comment, and the disposition table turns on
# quoting it.
gh issue view <n> --repo dynamicagents/<repo> \
  --json number,title,state,stateReason,body,comments
```

`--repo` on every call: a run arrives here having read other repositories, and `gh`
resolves a bare invocation against the current directory's remote, so an issue can land
in the wrong repository.

The key on the issue's last line is
`Discovery-Key: refactor-discovery/<repo>/<path from the repo root>#<class>`, where the
class is a kebab-case noun phrase for the reshaping (`duplicated-egress-plan`,
`dead-export`, `helper-inlined-twice`), and the path carries **no line number**.

The body carries the evidence that made it Confirmed, the three cost answers, and the
prior context the lookups found. Where the reshaping would cross a published surface or
a release train, say which: `core`, `plugins` and `g2a-protocol` publish, `starter` pins
them, and the dependency order is `g2a-protocol` → `core` → `plugins` → `starter`.

```bash
gh issue create --repo dynamicagents/<repo> --label refactor-discovery \
  --title "<what is there now, stated>" --body-file <draft>.md
```

`--body-file` rather than `--body`: a record carries permalinks and a fenced key line,
and a body typed at the prompt is one the shell has had an opinion about.

---

## 7. Report back

To the invoking agent, in the session: what was read and at which commits, what chose
that area, every Confirmed finding with its issue URL, what was ranked below the cap and
why, every Supported candidate (which is the only place one is ever stated), what the
prior-record lookups found, and what the run could not see.
