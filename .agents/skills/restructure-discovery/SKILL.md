---
name: restructure-discovery
description: >-
  Find the best next move of code in the Dynamic Agents train — a module living in the
  wrong repository, an import against the documented dependency direction, a package
  surface that should split or merge, a directory whose shape no longer matches what it
  holds — and file each one as a GitHub issue in the repository the change would start
  in. Discovery only: it edits no source, moves nothing and opens no pull request. Use
  when asked where the train's layout is wrong, or to go looking for restructuring work.
  Not for carrying out a move on request, not for reshaping code in place — that is
  `refactor-discovery` — and not for reviewing a diff or a pull request, which is
  `code-review`.
disable-model-invocation: true
---

# Restructure discovery

A run goes looking for code that is in the wrong place, establishes that it is, and files
it where whoever moves it will find it — with the release consequence stated, because in
this train a move is rarely confined to one repository. **It changes no code and moves
no file.**

The workspace `AGENTS.md`, under "Discovery runs", carries the gate, the ranking axes,
the disposition table, the citation rule, the cap and the rule against edits. Read it
first; this file carries what is specific to a move.

---

## 1. The question that decides every candidate

The workspace `AGENTS.md` asks it: not "does an agent vary here" but **"could an agent
vary here and still be correct"**. A cancellation ordering could not, so it is `core`'s.
A sentence the model reads always could, so it is the owning plugin's or `starter`'s. Its
"Where a change goes" table is the answer for the common cases, and it is the standard a
finding is measured against — together with each repository's own `AGENTS.md`, which is
authoritative for itself.

Dependencies run `g2a-protocol` → `core` → `plugins` → `starter`, and never back. A move
that would make a dependency point the other way is not a restructure but a redesign:
report it, file nothing, and say that it needs a person.

---

## 2. Check the credential, and the destination

A finding is filed in the repository the change would **start** in, by dependency order,
because that is the first pull request of the train. Probe each repository the run could
file in before reading anything; the body is missing a required field, so none of these
creates anything, and a `422` is the green light.

```bash
echo '{}' | gh api -i --method POST repos/dynamicagents/<repo>/issues --input -
```

`-i` is load-bearing: `gh` otherwise prints the body and the status and swallows the
response headers, and `X-Accepted-Github-Permissions` is the only thing that separates a
missing permission from a missing role. On a `403`, **stop** and report the endpoint and
that header. Never read, echo, log or copy a credential.

---

## 3. Choose where to look

The signals for a move are different from a reshaping's. Compute them rather than recall
them:

- **The dependency graph against the documented direction.** Every import that crosses a
  repository boundary, read against `g2a-protocol` → `core` → `plugins` → `starter`.
- **A subpath's module graph against its own promise.** `plugins` fails any subpath whose
  graph reaches a sibling's, and `starter` fails an agent importing a sibling agent's
  module; those scripts (`verify:exports`, `verify:isolation`) name what they allow, and
  the interesting candidates are the ones they allow and the layout does not want.
- **Durable-execution logic in `starter`**, and a Durable Object body in `starter` or
  `core` rather than `plugins`: the workspace `AGENTS.md` says each belongs elsewhere, and
  says it because both have happened.
- **A module in no slice of the audit's rotation**, or in a catch-all — a module nobody
  wrote a row for is often a module nobody decided the home of either.
- **A fairness floor.** No repository goes many runs unvisited.

Say in the report which signal chose the area, and at which commit it was read.

---

## 4. The passes, in order

How to run them — one reader or several — is the session's decision; this skill is not
preloaded into subagents, so a subagent gets what the prompt that starts it carries.

1. **Read the area and both `AGENTS.md`s** — the workspace's table and the repository's
   own conventions. A comment stating why something lives where it does is a decision
   already taken.
2. **Name candidates**, each as a claim about where code is and where it belongs.
3. **Verify with a reader that did not propose**, whose job is to re-run the evidence:
   the import, the export, the consumer. A structural opinion that nobody can re-check is
   what this pass exists to drop.
4. **Gate**, then **rank**, then **file at most three**, then **report** — `AGENTS.md`'s.

---

## 5. What Confirmed means here

| candidate | what Confirmed requires |
| --------- | ----------------------- |
| **A layering violation** | the import, named file to named file, shown, against the direction the docs state |
| **A module in the wrong repository** | the rule it falls under, quoted from the workspace or repository `AGENTS.md`, and the code it applies to |
| **A surface that should split or merge** | the subpath's own module graph, and the consumers that import part of it |
| **Duplicated ownership** | the same fact stated in two repositories, both shown, with no pointer between them |
| **A directory whose shape no longer matches** | the files, and the convention they depart from, quoted |

A claim that a module "feels like it belongs elsewhere" is Supported at best: it is
reported to the Coordinator and never filed, whatever its value. Impact never promotes a
class.

---

## 6. What a finding has to say about the cost

A move's cost is rarely an edit, and this is where a finding earns its place in the
ranking:

1. **The release train.** Core ships first, then `plugins` with its peer range moved,
   then `starter` pinning both; each step waits for the one before it to be on npm. A
   move across repositories is therefore several pull requests in order, and the finding
   says which.
2. **What breaks at a consumer.** A published package's exports are a contract: a subpath
   removed or renamed is a breaking change for anyone installing it.
   `PLUGIN_CONTRACT_VERSION` is asserted at Durable Object start, so a skew fails loudly
   rather than subtly — mention it when a move touches that boundary.
3. **Durable Objects do not move freely, and the two migrations that look alike are
   not.** `renamed_classes` carries a class's objects and their storage to the new name.
   `deleted_classes` frees them, irreversibly — and a class merely leaving the code frees
   nothing: every object it made keeps its storage, unreachable and still billed. So a
   move that renames a class names `renamed_classes`, and a finding that would need
   `deleted_classes` says that in as many words, because the two are not interchangeable
   and the destructive one has to be chosen on purpose. Either way it is a **new**
   migration tag, never an edit to a deployed one. `starter/wrangler.jsonc` reaches for
   `deleted_classes` rather than a rename throughout, and its comments say which case
   each tag is — a class that left the code, whose objects would otherwise keep their
   storage unreachable and billed, or a tenant re-created under a new name and meant to
   start empty. Read the tag, not the pattern.
4. **What the work would need locally.** A cross-repo install is `npm run link:local`,
   never `npm link`; the workspace `AGENTS.md`, under "Working across the repos", says
   what the symlink breaks. A finding whose move cannot be exercised without it says so.

---

## 7. What is not a finding

- Reshaping code in place — extracting a helper, collapsing duplication, a rename inside
  a module. That is `refactor-discovery`.
- A move a comment at the location already explains, unless the run shows the stated
  constraint no longer holds.
- A move that would invert a dependency. Report it; it needs a person, not an issue.
- A layout preference with no measurable benefit. Speculative, and dropped.
- A security weakness: `security-audit-discovery` files that privately, and a restructure
  finding never describes one.
- The superproject's submodule pointers. A pointer bump is a deliberate act that waits to
  be asked for, and no discovery run proposes one.

---

## 8. Filing

One issue per opportunity — one *opportunity*, even when it spans repositories — in the
repository the change starts in, shaped as `AGENTS.md` describes, labelled
`restructure-discovery`, created only if a lookup says it is absent and never with
`--force`. The body names the rest of the train.

```bash
gh label list --repo dynamicagents/<repo> --limit 100 --json name \
  --jq 'any(.name == "restructure-discovery")'
gh label create restructure-discovery --repo dynamicagents/<repo> \
  -d "Found by a restructure discovery run: a move, with its evidence and release cost" -c 5319E7

gh issue list --repo dynamicagents/<repo> --label restructure-discovery --state all \
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
resolves a bare invocation against the current directory's remote.

The last line is
`Discovery-Key: restructure-discovery/<repo>/<path from the repo root>#<class>`, with a
kebab-case class — `durable-object-in-consumer`, `upward-import`, `subpath-reaches-sibling`
— and **no line number** in the path.

A path in the issue body has to resolve from the repository that holds it: a path into
another repository of the train does not resolve from a consumer's checkout, so name that
module in prose and link it as a permalink instead.

```bash
gh issue create --repo dynamicagents/<repo> --label restructure-discovery \
  --title "<what is where now, stated>" --body-file <draft>.md
```

`--body-file` rather than `--body`: a record carries permalinks and a fenced key line,
and a body typed at the prompt is one the shell has had an opinion about.

---

## 9. Report back

To the invoking agent, in the session: what was read and at which commits, which signal
chose it, every Confirmed finding with its issue URL and the train it implies, what was
ranked below the cap and why, every Supported candidate, what the prior-record lookups
found, and anything the run could not check.
