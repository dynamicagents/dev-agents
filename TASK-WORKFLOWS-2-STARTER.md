# Task workflows, part 2: starter

Part 2 of the series:
- [`TASK-WORKFLOWS-0-SPIKE.md`](TASK-WORKFLOWS-0-SPIKE.md) holds the design and the spike's results;
- [`TASK-WORKFLOWS-1-CORE.md`](TASK-WORKFLOWS-1-CORE.md) is the core change this builds on.

Read part 0 first; this file does not restate the design.

**Before starting, part 1's core PR must be open**, and ideally merged into core's `main`: it is [core#66](https://github.com/dynamicagents/core/pull/66). The spike's starter branch (`spike/task-workflows` in `~/dev/dynamicagents/worktrees/task-workflows/starter`) built claude-coder's half of this and passed its gates; port it, leaving its `spike/` and `src/spike/` behind.

## Outcome

- Every tenant is a pipeline behind a task host, and each agent is a step agent.
- **claude-coder runs plan → approve → code**, both steps on ClaudeCoder, the approval looping until the caller approves.
- **reactive and cf-coder are one-step pipelines.** cf-coder stays out of the multi-step flow for now.
- One PR into **`feat/think`**, starter#75's branch, stacked on it. #75 is held, so it carries both changes when it merges, and `next` never ships agents that own their own tasks.

## Setup

```bash
W=~/dev/dynamicagents/worktrees/task-workflows
cd $W/starter && git fetch origin && git switch -c feat/task-workflows origin/feat/think && npm ci
npm update @dynamicagents/core   # moves the #main git ref; `npm install` does not re-resolve it
```

- While core's PR is in review, iterate with `npm run link:local` against `$W/core` (it needs `$W/plugins` beside it). Before committing, run `npm ci` so the lock names what is on `main`.
- If `feat/think` moves meanwhile, rebase onto it.

## What changes

### Step agents

- **Reactive, CfCoder and ClaudeCoder** (`src/agents/<tenant>/agent.ts`) extend core's `StepAgent` in place of `A2AAgent`.
  - `copy` moves to their hosts, and `src/copy.ts` imports `A2ACopy` from `@dynamicagents/core/task`.
  - A `beforeTurn` that sets `activeTools` — ClaudeCoder's by role, CfCoder's without Think's writers — keeps core's empty list for a job that has ended. Core's `beforeToolCall` refuses the calls either way.
  - ClaudeCoder's `onTaskSettled` (release worktrees, forget kept notes, release containers) stays; the host's end-of-task notice reaches it.
  - `formatDetachedCompletion`'s kept-work note stays.
- **Their sub-agents are unchanged**: ReactiveGeneral, CfCoderCode, ClaudeCoderSession and ClaudeCoderReader, in `children.ts`.
- **ClaudeCoder's roles** (the spike's `src/agents/claude-coder/roles.ts` and `soul.ts`):
  - `activeToolsFor(role, names)` in `beforeTurn`: a `plan` turn keeps only the tools named in `PLAN_TOOLS` — Think's readers, `repo_clone`, `repo_fetch`, `repo_status`, `repo_diff`, the forge readers, the browser, `claude_code_read`, `ask_user`, `search_history`. Named rather than filtered, so a tool added later stays out of a plan until it is put there.
  - `formatStepJobInput(job)` puts `ROLE_BRIEFS[role]` ahead of the input: a plan changes nothing and is written for the caller to approve; the code step keeps to the approved plan and says so when the work proves it wrong.
  - `formatStepJobInput` also puts `RETRY_BRIEF` ahead of a retry: the first attempt's work is kept, so look at what it left — `repo_worktrees`, anything pushed — and carry on from it.
  - The pull request stays the code step's: nothing between approval and the pull request needs another step.
  - **Two brief fixes G11 found.** A plan names no branch: a writing session commits to its own run branch, and that branch is the pull request's head. And the code step pushes and opens the pull request from the branch the session reports, in the turn it reads the diff — a review that runs on can be cut by the runtime's execution limit.

### Hosts and pipelines, one of each per tenant

- **A host**, in `src/agents/<tenant>/host.ts`: `ReactiveTasks`, `CfCoderTasks`, `ClaudeCoderTasks`. Each extends core's `TaskHost` with the copy from `src/copy.ts`, its workflow's binding and its own. Type the two bindings `string`, so a test host can override them.
- **A pipeline**, in `src/agents/<tenant>/task.ts`, each declaring `run()` as core requires:
  - `ReactiveTask`: one `step.agent` on `Reactive`.
  - `CfCoderTask`: one `step.agent` on `CfCoder`.
  - `ClaudeCoderTask`: part 0's example. The step agent's binding is a protected `coder` member, so the test worker points it at the scripted agent. The words the caller reads between steps (`approveHint`, `replanning`, `noReason`) are `PIPELINE_COPY` in `src/copy.ts`.
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
- **The migration.** Fold the hosts into **`v10`'s `new_sqlite_classes`** rather than adding a tag. `next` is still at `v9`, so `v10` has never been deployed. Confirm that with `git show origin/next:wrangler.jsonc` before relying on it.
- Then `npm run types`, and commit the regenerated `worker-configuration.d.ts`.

### Scripts

- **`scripts/cf.mjs`** gets `wf` back. Adapt the version on `origin/next` to the new workflow names; its `verdict:` line reads `output.verdict`.
- **`scripts/verify-isolation.mjs`:**
  - add each tenant's `host.ts` and `task.ts` to its entries;
  - a pipeline reaches agents by binding name, so ban its module from importing any agent class;
  - re-baseline the ceilings from the new builds, with the reason. The spike's claude-coder graph grew by a few KiB with the host, the pipeline and the roles.

### Tests

- **`test/worker.ts`:** the `Test*` step agents on scripted models, under test hosts and pipelines that override their bindings (and `coder`). The test-only Durable Objects and workflows go in `vitest.config.ts`, the workflows under miniflare's `workflows` option beside the ones `wrangler.jsonc` binds.
  - `TestClaudeCoder` scripts by its turn's role: it strips the role brief, and in a code step the approved plan is the script. It gains `TestClaudeCoderReader`, so a plan can read in the background.
- **`test/lifecycle.spec.ts`**, through each one-step tenant's host: a turn completes with one terminal callback; a failed turn fails in this deployment's words; ask and answer; cancel, which keeps work and sends no terminal callback.
- **`test/claude-coder-pipeline.spec.ts`** (the spike's, plus a failed step's retry): approve and build in a writing session; a refusal planned again, for as long as it takes; a plan read in the background; a code step's question relayed; the plan surface, exact; each turn's tools by role; cancel while planning, at the approval and while writing; the approval's expiry.
- **`test/gateway-attribution.spec.ts`** still finds the A2A task id on every step agent's calls.

### Docs

- **`README.md` and `AGENTS.md`:**
  - a task is a pipeline;
  - the host, the pipeline and the step agents, and where each lives in starter;
  - claude-coder's plan and approval, and what the plan role may do;
  - the "where a thing goes" table gains "a step in a tenant's pipeline → `src/agents/<tenant>/task.ts`".

  Point at core's docs for the mechanism rather than restating it.
- **The manifests.** claude-coder's card describes the planned and approved flow.
- **dev-agents' `CLAUDE.md`** "Where a change goes" table gains rows: the task host and workflow mechanism → core; a tenant's pipeline → starter. That is a dev-agents PR of its own.

## Verification

```bash
npm run types && npm run check && npm test && npm run verify:isolation
npx wrangler deploy --dry-run --outdir dist   # deploy nothing; builds the container images, so Docker must be running
```

- Once on the pinned deps (`npm ci`).
- Once after `npm run link:local` against `$W/core`, then `npm ci` again.

## Hand-over

1. Push `feat/task-workflows`, and open a PR into `feat/think`.
2. Update #75's description:
   - its cutover gains the hosts, the pipelines and the new Workflows;
   - the deletion of the old Workflows and the Vectorize index stays;
   - a note that #75 now carries the task workflows.
3. Answer Copilot's one review on the new PR in one pass, reading its body too.
4. Never merge, and never run the cutover. Both are the user's, as is the deployed smoke test:
   - claude-coder's plan → approve → code end to end;
   - a Claude Code step longer than fifteen minutes.

## Rules

As in part 0: never merge; no version bumps; one Copilot review; comments state a constraint, a measurement or a coupling; stopping never clears work.
