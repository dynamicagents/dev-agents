---
name: restructure
description: >-
  Reorganize where code lives in the Dynamic Agents train — moving a module between
  repos, splitting or merging directories, changing a package's exports or a repo's
  layout. Proposes the move and its release consequences first, and edits only once the
  invoking agent says to. Use for "restructure", "move this into core", "reorganize
  these modules".
---

# Restructure

Moves code rather than reshaping it. The unit here is a module, a directory or a
package's surface — and in this workspace a move is rarely confined to one repository,
which is the whole reason this is its own skill.

**Proposal first, edits second**, and the proposal has to carry the release consequence.
Authorization is per proposal, not standing. The guardrail block in
`../security-audit/SKILL.md` is the shared rule and this skill works the same way.

## The question that decides every move

The workspace `AGENTS.md` asks it: not "does an agent vary here" but **"could an agent
vary here and still be correct"**. A cancellation ordering could not, so it is `core`'s.
A sentence the model reads always could, so it is the owning plugin's or `starter`'s.
Its "Where a change goes" table is the answer for the common cases:

- a value two repos must spell identically → `g2a-protocol`
- cancellation, retries, idempotency, durable execution → `core`
- a Durable Object mechanism any object may use → `core`
- a capability an agent may or may not have, or the object it lives in → `plugins`
- which steps a tenant's task runs, what an agent *is*, model ids and budgets → `starter`
- what `npm create dynamicagents` asks or writes → `create-dynamicagents`

Dependencies run `g2a-protocol` → `core` → `plugins` → `starter`, and never back. A move
that would make a dependency point the other way is not a restructure; it is a
redesign, and it stops for a person.

## What a proposal must say

1. **The move.** Which paths, from which repo to which, and what the new names are. A
   repo's existing shape wins over a cleaner one invented here.
2. **The release train.** Core ships first, then `plugins` with its peer range moved,
   then `starter` pinning both. Each step waits for the one before it to be on npm. A
   move across repos is therefore several pull requests in order, and the proposal says
   so before anyone starts.
3. **What breaks at a consumer.** A published package's exports are a contract; a
   subpath export removed or renamed is a breaking change for anyone installing it.
   `PLUGIN_CONTRACT_VERSION` is asserted at Durable Object start, so a skew fails loudly
   rather than subtly — mention it when a move touches that boundary.
4. **Durable Objects do not move freely.** Deleting or renaming a class means a
   migration: the old class goes into `deleted_classes` in a *new* migration tag, never
   by editing a deployed one. `starter/wrangler.jsonc`'s migration comments hold the
   rules.
5. **What the local install needs.** A cross-repo install is `npm run link:local` —
   `npm pack` plus a tarball install — never `npm link`: a symlinked checkout brings its
   own copy of every peer, and two copies of `agents` in one Worker bundle break
   `Session` types and every `instanceof` at runtime.

## Once authorized

Work repo by repo, in dependency order, committing inside each submodule — each is its
own repository and only its own commits are kept. Verify with `npm run check` in every
repo touched, not `npm test`. Leave the superproject's submodule pointers alone: a
pointer bump is a deliberate act that waits to be asked for.

## Not this skill

- **Reshaping code in place** — extracting a helper, renaming a local, collapsing
  duplication — is `refactor`.
- **A security finding** goes to `security-audit`, which files it privately. A
  restructure proposal never describes a vulnerability.
- **Reviewing a diff** is `code-review`.

## Comments move with the fact

One home per fact: when a module moves, the explanation moves with it and what stays
behind is a pointer, not a copy. Copies do not stay in step, and then nobody can tell
which is current. A path in a comment must resolve from the repo that holds it — a path
into another repo of the train does not resolve from a consumer's checkout, so name the
module in prose instead.
