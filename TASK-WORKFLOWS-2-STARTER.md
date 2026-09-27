# Task workflows, part 2: starter

Part 2 of the series:
- [`TASK-WORKFLOWS-0-SPIKE.md`](TASK-WORKFLOWS-0-SPIKE.md) holds the design and the spike's results;
- [`TASK-WORKFLOWS-1-CORE.md`](TASK-WORKFLOWS-1-CORE.md) is the core change this builds on.

Read part 0 first; this file does not restate the design.

**Before starting, check two things.** Part 1's core PR must be open, and ideally merged into core's `main`. And part 0's Results must say what the planner and the judge hold, how the judge's verdict comes back (G8), and who opens the pull request. Where a result contradicts this file, the result wins: correct this file first.

## Outcome

- Every tenant is a pipeline behind a task host, and each agent is a step agent.
- cf-coder runs planner → coder → judge, and the judge may send the work back once.
- One PR into **`feat/think`**, starter#75's branch, stacked on it. #75 is held, so it carries both changes when it merges, and `next` never ships agents that own their own tasks.

## Setup

```bash
W=~/dev/dynamicagents/worktrees/task-workflows
cd $W/starter && git fetch origin && git switch -c feat/task-workflows origin/feat/think && npm ci
npm update @dynamicagents/core   # moves the #main git ref; `npm install` does not re-resolve it
```

- While core's PR is in review, iterate with `npm run link:local` against `$W/core`. Before committing, run `npm ci` so the lock names what is on `main`.
- If `feat/think` moves meanwhile, rebase onto it.

## What changes

### Step agents

- **Reactive, CfCoder and ClaudeCoder** (`src/agents/<tenant>/agent.ts`) extend core's step agent in place of `A2AAgent`.
  - `copy` moves to their hosts.
  - ClaudeCoder's `onTaskSettled` (release worktrees, forget kept notes, release containers) stays, as the step agent's hook for the host's end-of-task notice.
  - `formatDetachedCompletion`'s kept-work note stays.
- **Their sub-agents are unchanged**: ReactiveGeneral, CfCoderCode, ClaudeCoderSession and ClaudeCoderReader, in `children.ts`.
- **New for cf-coder:** `CfPlanner` and `CfJudge`, in `src/agents/cf-coder/planner.ts` and `judge.ts`.
  - Their plugin lists go in `plugins.ts`, with the read-only surfaces part 0 settled (as cf-coder's parent: `restrictTools` to `grep`, `workspaceBash = false`, writers filtered out of `activeTools`).
  - Their souls go in `soul.ts`.
  - Their model and compaction values go in `src/config.ts`.
- **CfCoder's soul follows the pipeline.** It implements the plan it is handed and reports its branch. It opens the pull request only when told the judge accepted (or whatever part 0 settled). A send-back arrives as its next job, with the judge's feedback and a `continue` on the same branch.

### Hosts and pipelines, one of each per tenant

- **A host**, in `src/agents/<tenant>/host.ts`: `ReactiveTasks`, `CfCoderTasks`, `ClaudeCoderTasks`. Each extends core's task host with the copy from `src/copy.ts` and its workflow's binding.
- **A pipeline**, in `src/agents/<tenant>/task.ts`:
  - `ReactiveTask`: one `step.agent` on Reactive.
  - `ClaudeCoderTask`: one `step.agent` on ClaudeCoder.
  - `CfCoderTask`: plan → code → judge. If the judge sends it back, a `step.say` and a second code step on the same branch, then a second judge step. The reply carries the pull request.
- `definition.ts`: `defineAgent`'s `agent` names the host's namespace.
- `src/index.ts` exports the hosts, the pipelines and the new agents.

### `wrangler.jsonc`

- **`workflows`:**

  | name | binding | class |
  | --- | --- | --- |
  | `reactive-task` | `REACTIVE_TASK` | `ReactiveTask` |
  | `cf-coder-task` | `CF_CODER_TASK` | `CfCoderTask` |
  | `claude-coder-task` | `CLAUDE_CODER_TASK` | `ClaudeCoderTask` |

  The names must differ from the pre-Think Workflows (`handle-task`, `cf-coder`, `claude-coder`), which #75's cutover deletes.
- **Durable Object bindings** for the hosts, `CfPlanner` and `CfJudge`.
- **The migration.** Fold the new classes into **`v10`'s `new_sqlite_classes`** rather than adding a tag. `next` is still at `v9`, so `v10` has never been deployed. Confirm that with `git show origin/next:wrangler.jsonc` before relying on it.
- **Class names survive the bundle** (`keep_names`), as G1 found.
- Then `npm run types`, and commit the regenerated `worker-configuration.d.ts`.

### Scripts

- **`scripts/cf.mjs`** gets `wf` back. Adapt the version on `origin/next` to the new workflow names.
- **`scripts/verify-isolation.mjs`:**
  - add each tenant's `host.ts` and `task.ts` to its entries;
  - a pipeline reaches agents through namespaces, so ban its module from importing any agent class;
  - re-baseline the ceilings from the new builds, with the reason.

### Tests

- **`test/worker.ts`:** the `Test*` step agents on scripted models, mounted under the real hosts and pipelines. The test-only bindings go in `vitest.config.ts`.
- **`test/lifecycle.spec.ts`**, through each tenant's host, per tenant:
  - a turn completes, with one terminal callback;
  - a failed turn fails in this deployment's words;
  - ask and answer;
  - cancel, which keeps work and sends no terminal callback.
- **A cf-coder pipeline spec:** plan → code → judge accepts; and plan → code → judge sends back → code `continue`s → judge accepts. Each ends in one reply, checked with `introspectWorkflowInstance`.
- **`test/gateway-attribution.spec.ts`** still finds the A2A task id on every step agent's calls, the new agents included.

### Docs

- **`README.md` and `AGENTS.md`:**
  - a task is a pipeline;
  - the host, the pipeline and the step agents, and where each lives in starter;
  - the "where a thing goes" table gains "a step in a tenant's pipeline → `src/agents/<tenant>/task.ts`".

  Point at core's docs for the mechanism rather than restating it.
- **The manifests.** cf-coder's card may describe the planned and reviewed flow.
- **dev-agents' `CLAUDE.md`** "Where a change goes" table gains rows: the task host and workflow mechanism → core; a tenant's pipeline → starter. That is a dev-agents PR of its own.

## Verification

```bash
npm run types && npm run check && npm test && npm run verify:isolation
npx wrangler deploy --dry-run --outdir dist   # deploy nothing
```

- Once on the pinned deps (`npm ci`).
- Once after `npm run link:local` against `$W/core`, then `npm ci` again.

## Hand-over

1. Push `feat/task-workflows`, and open a PR into `feat/think`.
2. Update #75's description:
   - its cutover gains the hosts, the pipelines, `CfPlanner`, `CfJudge` and the new Workflows;
   - the deletion of the old Workflows and the Vectorize index stays;
   - a note that #75 now carries the task workflows.
3. Answer Copilot's one review on the new PR in one pass, reading its body too.
4. Never merge, and never run the cutover. Both are the user's, as is the deployed smoke test:
   - planner → coder → judge end to end;
   - a Claude Code step longer than fifteen minutes.

## Rules

As in part 0: never merge; no version bumps; one Copilot review; comments state a constraint, a measurement or a coupling; stopping never clears work.
