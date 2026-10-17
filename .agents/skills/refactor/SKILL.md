---
name: refactor
description: >-
  Reshape existing, committed code in the Dynamic Agents train without changing what it
  does — extracting a helper, removing duplication, renaming for the pattern a repo
  already uses. Proposes the change first and edits only once the invoking agent says
  to. Use for "refactor this module", "remove this duplication", "extract a helper".
  Not for tidying code you just wrote — that is `simplify` — and not for moving code
  between repos or directories, which is `restructure`.
---

# Refactor

Changes the shape of code that already works. Behaviour stays identical; if a change
alters behaviour it is a feature or a fix, and it belongs in a task of its own.

**Proposal first, edits second.** Read the code, say what you would change and why, and
wait for the invoking agent to authorize it. The authorization is per proposal, not
standing: a second refactor needs a second yes.

## Where a change belongs

The workspace `AGENTS.md` table — "Where a change goes" — decides which repository a
change lands in before anything else. A refactor that moves durable-execution logic out
of `starter` into `core`, or a capability's Durable Object into `plugins`, is a
cross-repo change: it is a release train, not an edit, and it needs that said out loud
in the proposal.

Each repo's own `AGENTS.md` is authoritative for its conventions, and a repo's existing
pattern beats a generically better one — a tenant's classes are `<Tenant>Host`,
`<Tenant>Workflow`, `<Tenant>Agent`, and matching that matters more than a name you
would pick fresh.

## How to work

1. **Read before proposing.** The file, its tests, and the `AGENTS.md` of the repo it
   lives in. Comments there record constraints that were expensive to learn; a refactor
   that deletes one has removed the reason, not the clutter.
2. **Name the smallest unit that is worth it.** One extraction, one rename, one
   collapsed duplication per proposal. A proposal nobody can review is one nobody can
   authorize.
3. **Say what it costs.** Which call sites move, what a consumer has to change, whether
   a published package's surface shifts. In `core`, `plugins` and `g2a-protocol` a
   surface change is a release, and `starter` pins those versions.
4. **Once authorized, verify in the repo you touched** — `npm run check` there, not
   `npm test`: Vitest transpiles specs without typechecking them, so a type error
   passes a green suite. Where wrangler config moved, `npm run types` first and commit
   the regenerated `worker-configuration.d.ts`.
5. **Commit inside the submodule.** Each is its own repository; only its own commits are
   kept. Recording a new submodule commit in the superproject is a separate decision
   nobody takes unprompted.

## Not this skill

- **Bugs and vulnerabilities.** A security finding goes to `security-audit`, which files
  it privately. Never describe a vulnerability in a commit message or a public issue.
- **Moving modules or changing a repo's layout** — that is `restructure`.
- **Reviewing a diff for defects** — that is `code-review`.
- **Applying quality cleanups to work you just did** — that is `simplify`.

## Comments are held to the code's bar

A comment states a constraint, a measurement or a coupling. No changelog, no package
versions or dates, no counts, one home per fact, and every path in a comment checked
before it is written. A refactor is exactly when a stale comment becomes visible —
update it or delete it, and never leave it describing code that no longer exists.
