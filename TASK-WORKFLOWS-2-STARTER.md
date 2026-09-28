# Task workflows, part 2: starter

Part 2 of the series:
- [`TASK-WORKFLOWS-0-SPIKE.md`](TASK-WORKFLOWS-0-SPIKE.md) holds the design and the spike's results;
- [`TASK-WORKFLOWS-1-CORE.md`](TASK-WORKFLOWS-1-CORE.md) is the core change this builds on;
- [`TASK-WORKFLOWS-3-LONG-WORK.md`](TASK-WORKFLOWS-3-LONG-WORK.md) is why a cut turn is continued, and what that leaves for starter: nothing.

Read part 0 first; this file does not restate the design.

Part 1 is on core's `main`: [core#66](https://github.com/dynamicagents/core/pull/66). The spike's starter branch (`spike/task-workflows` in `~/dev/dynamicagents/worktrees/task-workflows/starter`) built claude-coder's half of this and passed its gates; port it, leaving its `spike/` and `src/spike/` behind. It predates core's names: its `A2ATaskWorkflow` is `TaskWorkflow`, and `A2AAgent` is `StepAgent`.

## Outcome

- Every tenant is a pipeline behind a task host, and each agent is a step agent.
- **claude-coder runs plan → approve → code**, both steps on ClaudeCoder. Approve builds the plan, a comment revises it, and reject stops at it (part 0).
- **reactive and cf-coder are one-step pipelines.** cf-coder stays out of the multi-step flow for now.
- One PR into **`feat/think`**, starter#75's branch, stacked on it. #75 is held, so it carries both changes when it merges, and `next` never ships agents that own their own tasks.

## Setup

```bash
W=~/dev/dynamicagents/worktrees/task-workflows
cd $W/starter && git fetch origin && git switch -c feat/task-workflows origin/feat/think && npm ci
# Both git refs move: `npm install` does not re-resolve a #main ref.
npm update @dynamicagents/core @dynamicagents/plugins
```

- **`feat/think` first takes `next`**, by a merge rather than a rebase, so #75's branch is never force-pushed. `next` carries #81, the half of G11's brief fix that is claude-coder's soul.
- **plugins' `main` has not run on core's `main` since core#66.** In plugins, move its core ref first — `npm update @dynamicagents/core`, since `npm ci` keeps the lock's commit — then run its `npm run check` and `npm test`; a failure is a plugins PR ahead of this one. plugins#72 moves the lock there for good. Its `main` carries workspace fixes G11 found: a clone keeps symlinks (#69), a push that adds nothing is refused (#70), and the container session is hung up before a stop (#71).
- If `feat/think` moves meanwhile, rebase onto it.

## What changes

### Step agents

- **Reactive, CfCoder and ClaudeCoder** (`src/agents/<tenant>/agent.ts`) extend core's `StepAgent` in place of `A2AAgent`.
  - `copy` moves to their hosts, and `src/copy.ts` imports `A2ACopy` from `@dynamicagents/core/task`.
  - A `beforeTurn` that sets `activeTools` — ClaudeCoder's by role, CfCoder's without Think's writers — keeps core's empty list for a job that has ended: `activeTools: base?.activeTools ?? <its own list>`. Spreading `base` and then setting the list, as `feat/think`'s CfCoder and the spike's ClaudeCoder do, undoes it. Core's `beforeToolCall` refuses the calls either way.
  - **Every agent briefs a retry.** A failed step runs once more as attempt 2, in the same conversation, so without a brief the model meets its request twice. `RETRY_BRIEF` in `src/copy.ts` names no domain: the previous attempt stopped, its work is kept above, carry on from it. Reactive and CfCoder put it ahead of a retry's input in `formatStepJobInput`.
  - ClaudeCoder's `onTaskSettled` (release worktrees, forget kept notes, release containers) stays; the host's end-of-task notice reaches it.
  - `formatDetachedCompletion`'s kept-work note stays.
- **Their sub-agents are unchanged**: ReactiveGeneral, CfCoderCode, ClaudeCoderSession and ClaudeCoderReader, in `children.ts`.
- **ClaudeCoder's roles** (the spike's `src/agents/claude-coder/roles.ts` and `soul.ts`):
  - `activeToolsFor(role, names)` in `beforeTurn`: a `plan` turn keeps only the tools named in `PLAN_TOOLS` — Think's readers, `repo_clone`, `repo_fetch`, `repo_status`, `repo_diff`, the forge readers, the browser, `claude_code_read`, `ask_user`, `search_history`. Named rather than filtered, so a tool added later stays out of a plan until it is put there.
  - `formatStepJobInput(job)` puts `ROLE_BRIEFS[role]` ahead of the input: a plan changes nothing and is written for the caller to approve; the code step keeps to the approved plan and says so when the work proves it wrong.
  - ClaudeCoder's retry note for a code step, or a whole task, is `RETRY_BRIEF` plus where its work is: `repo_worktrees` lists its branches, and anything pushed is on the remote. A plan's is `RETRY_BRIEF` alone, since a plan can neither start a writing session nor call `repo_worktrees`.
  - The pull request stays the code step's: nothing between approval and the pull request needs another step.
  - **A plan names no branch** (G11): a writing session commits to its own run branch, and that branch is the pull request's head. The plan's brief says so. Pushing that branch under the name the session's report gives is the soul's, from #81, so the code step's brief does not repeat it.

### Hosts and pipelines, one of each per tenant

- **A host**, in `src/agents/<tenant>/host.ts`: `ReactiveTasks`, `CfCoderTasks`, `ClaudeCoderTasks`. Each extends core's `TaskHost` with the copy from `src/copy.ts`, its workflow's binding and its own. Type the two bindings `string`, so a test host can override them.
- **A pipeline**, in `src/agents/<tenant>/task.ts`, each declaring `run()` as core requires:
  - `ReactiveTask`: one `step.agent("main", …)` on `Reactive`.
  - `CfCoderTask`: one `step.agent("main", …)` on `CfCoder`.
  - `ClaudeCoderTask`: part 0's example.
  - Each names its step agent's binding in a protected member typed `string` — ClaudeCoderTask's is `coder` — so the test worker points it at the scripted agent.
  - **A rejection ends the task on the answer itself**, which core's edge must answer with the task rather than refuse as terminal: [core#67](https://github.com/dynamicagents/core/pull/67). Until starter's core ref moves past it, the rejection spec can meet the refusal.
  - The words claude-coder's caller reads between steps (`approveHint`, `replanning`, `noComment`, `stopped`) are `PIPELINE_COPY` in `src/copy.ts`. A rejected plan completes with `stopped` as its reply and `rejected` as its verdict's outcome; the plan itself is already in the thread.
  - The plan's brief says a request that asks a question rather than for a change is answered in the plan, in full.
- `definition.ts`: `defineAgent`'s `agent` names the host's namespace.
- `src/index.ts` exports the hosts and the pipelines.

### `wrangler.jsonc`

- **`workflows`:**

  | name | binding | class |
  | --- | --- | --- |
  | `reactive-task` | `REACTIVE_TASK` | `ReactiveTask` |
  | `cf-coder-task` | `CF_CODER_TASK` | `CfCoderTask` |
  | `claude-coder-task` | `CLAUDE_CODER_TASK` | `ClaudeCoderTask` |

  The names must differ from the pre-Think Workflows (`handle-task`, `cf-coder`, `claude-coder`), which #75's cutover deletes.
- **Durable Object bindings** for the hosts. A host's `hostBinding` names its binding, and a workflow's callbacks and steps reach it through that key. Naming it as the class is a convention here, not a requirement.
- **The migration.** Fold the hosts into **`v10`'s `new_sqlite_classes`** rather than adding a tag. `next`'s tags end at `v9`, so `v10` has never been deployed; confirm it again with `git show origin/next:wrangler.jsonc` before committing.
- Then `npm run types`, and commit the regenerated `worker-configuration.d.ts`.

### Scripts

- **`scripts/cf.mjs`** gets `wf` back. Adapt the version on `origin/next` to the new workflow names; its `verdict:` line reads `output.verdict`.
- **`scripts/verify-isolation.mjs`:**
  - add each tenant's `host.ts` and `task.ts` to its entries;
  - a pipeline reaches agents by binding name, so ban its module from importing any agent class;
  - re-baseline the ceilings from the new builds, with the reason. The spike's claude-coder graph grew by a few KiB with the host, the pipeline and the roles.

### Tests

- **`test/worker.ts`:** the `Test*` step agents on scripted models, under test hosts and pipelines that override their bindings (and `coder`). The test-only Durable Objects and workflows go in `vitest.config.ts`, the workflows under miniflare's `workflows` option beside the ones `wrangler.jsonc` binds.
  - `TestClaudeCoder` scripts by its turn's role: it strips the retry and role briefs, and in a code step the approved plan is the script. It gains `TestClaudeCoderReader`, so a plan can read in the background.
- **`test/lifecycle.spec.ts`**, through each one-step tenant's host: a turn completes with one terminal callback; a failed turn is retried once, its input led by `RETRY_BRIEF`; one that fails twice fails in this deployment's words; ask and answer; cancel, which keeps work and sends no terminal callback.
- **`test/claude-coder-pipeline.spec.ts`** (the spike's, plus a failed step's retry and a rejection): approve and build in a writing session; a comment planned again, for as long as it takes; a rejection stopping at the plan, with no code step; a plan read in the background; a code step's question relayed; the plan surface, exact; each turn's tools by role; cancel while planning, at the approval and while writing; the approval's expiry.
- **`test/gateway-attribution.spec.ts`** still finds the A2A task id on every step agent's calls.

### Docs

- **`README.md` and `AGENTS.md`:**
  - a task is a pipeline;
  - the host, the pipeline and the step agents, and where each lives in starter;
  - claude-coder's plan and approval, and what the plan role may do;
  - the "where a thing goes" table gains "a step in a tenant's pipeline → `src/agents/<tenant>/task.ts`".

  Point at core's docs for the mechanism rather than restating it.
- **The manifests.** claude-coder's card describes the planned and approved flow, and its `investigate` skill becomes `planning`: research and a plan, which the caller may stop at.
- **slack-gatekeeper, a follow-up of its own:** label an approval's typed-answer button "Comment" rather than "Something else…". That is its rendering, not the protocol's.
- **Every `A2AAgent` mention goes**, comments included: `git grep -n "A2AAgent\|A2ATaskWorkflow"` finds nothing.
- **plugins' README** and its `src/computer/README.md` still show an agent that `extends A2AAgent`: a docs PR into plugins' `main`, with no bump.

## Verification

```bash
npm run types && npm run check && npm test && npm run verify:isolation
npx wrangler deploy --dry-run --outdir dist   # deploy nothing; builds the container images, so Docker must be running
```

On the pinned deps, after `npm ci`.

## Hand-over

1. Push `feat/task-workflows`, and open a PR into `feat/think`.
2. Update #75's title and description. "With no Workflows" stops being true:
   - its cutover gains the hosts, the pipelines and the new Workflows;
   - the deletion of the old Workflows and the Vectorize index stays;
   - a note that #75 now carries the task workflows.
3. Answer Copilot's one review on the new PR in one pass, reading its body too.
4. Never merge, and never run the cutover. Both are the user's, as is the deployed smoke test:
   - claude-coder's plan → approve → code end to end, and a comment and a rejection;
   - a Claude Code step longer than fifteen minutes.

## Rules

As in part 0: never merge; no version bumps; one Copilot review; comments state a constraint, a measurement or a coupling; stopping never clears work.
