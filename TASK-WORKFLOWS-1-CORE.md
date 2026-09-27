# Task workflows, part 1: core

Part 1 of the series. [`TASK-WORKFLOWS-0-SPIKE.md`](TASK-WORKFLOWS-0-SPIKE.md) holds the design (the task host, the task workflow, step agents) and the facts behind it. Read it first; this file does not restate it.

**Before starting, check part 0's Results section.** It has to be filled, with every gate decided. Where a result contradicts this file, the result wins: correct this file first, in the same dev-agents PR as the results or a new one.

## Outcome

One PR into core's `main`, with no version bump. starter takes it by git ref in part 2. After it:
- the task host owns the A2A task;
- `A2ATaskWorkflow` owns the steps;
- today's `A2AAgent` is a step agent that runs **jobs** and reports them to the workflow.

There is no path where an agent owns a task.

## Setup

```bash
W=~/dev/dynamicagents/worktrees/task-workflows
cd $W/core && git switch -c feat/task-workflows origin/main && npm ci
```

The spike's branch stays local for reference. Port what it proved, not its code wholesale. Leave `~/dev/dynamicagents/worktrees/think/*` alone.

## What changes

### `/task` (new, `src/task/`): the task host

`TaskHost<Env> extends Agent<Env>` (agents, not Think), implementing `TaskAgent` from `src/a2a/agent-stub.ts`.

**Moves out of `src/agent/agent.ts`:**
- the edge surface: `acceptTask`, `getTask`, `listTasks`, `saveTask`, `cancelTask`, `answerTask`, `submitAnswer`, `expireTask`;
- settlement:
  - `#finish`;
  - `#enqueueDelivery`, `deliverTask` and `DELIVERY_RETRY`;
  - `runSettleHooks` and `#settled`;
  - `settleTranscript`;
- the cancel ordering (`#cancel`, `#stopCanceled`);
- `onStart`'s sweep of owed deliveries, hooks and answers;
- the self-origin, the push channel (`#channel`) and `nextPushKey`;
- retention: `a2aRetention` for the task rows;
- `A2ACopy` (`failed`, `emptyReply`, `questionExpired`), because these are now the host's words;
- the task table of `A2ATasks` (`src/agent/tasks.ts`). The open-work table (`da_a2a_work`) stays with the step agent as part of its job ledger. Split the class along that line.

**New in the host:**
- An abstract member naming the workflow binding that runs this tenant's tasks.
- `acceptTask` → `ledger.accept` → start the workflow, with `id: taskId`.
  - Params: `taskId`, `contextId`, `messageId`, `text`, and the verified caller (key, name, kind, workspace id), plus the caller context string agents render today.
  - **A start protocol that recovers at every boundary.** `runWorkflow` alone is not idempotent: `create({ id })` throws on an id that exists, then a unique tracking insert throws too. The protocol:
    1. the ledger row records the instance it is starting;
    2. an instance that already exists is adopted, not an error;
    3. the tracking row is written only if missing, because `terminateWorkflow` and its siblings look the instance up there;
    4. the row is bound last.

    A redelivered `messageId` finds the row bound and returns. A crash between any two steps finds it unbound and runs the protocol again. Whether the host wraps `runWorkflow` or calls the binding with the same origin params is the spike's G1 finding.
- `onWorkflowProgress` → push `working`.
- `onWorkflowComplete(result)` → `#finish` completed, with `result.reply` or `copy.emptyReply`. `onWorkflowError` → `#finish` failed, with `copy.failed`.
- **Reconciliation.** A task whose instance is terminal while the task is not is settled from `getWorkflowStatus`. This is the backstop for a completion report that ran out of retries. It runs on the retention sweep and on `getTask`.
- RPC the workflow calls from its steps:
  - `park(taskId, request)`: `ledger.park`, then the `input-required` callback through the outbox;
  - `say(taskId, text, key)`: a progress line;
  - `noteJob(taskId, { binding, jobId })`: the task's running jobs, in a table the host owns.
- `answerTask` → the ledger → `sendWorkflowEvent(binding, taskId, { type: <the question's event type>, payload: reply })`.
- **`expireTask` takes the cancel stop path**: terminate the instance, then `cancelJob` each noted job, keeping its work. Only then does the task fail with `copy.questionExpired`. Settling the row alone would leave the instance waiting and its job open after the task had ended.
- `cancelTask` → the guarded write → `terminateWorkflow(taskId)` → `cancelJob(jobId)` on each noted job → the hooks. A stopped job keeps its work.
- `progress(taskId, text)`: RPC from step agents, replacing their direct push.
- **The end-of-task notice.** Once a task is terminal, the outbox calls `onTaskSettled(taskId, state)` on every agent that ran one of its jobs, with retries. claude-coder frees its worktrees and containers there.
- `onTaskCanceled` and `onTaskSettled` stay overridable on the host.

### `/workflow` (new, `src/workflow/`): the task workflow

`A2ATaskWorkflow<Env> extends AgentWorkflow<TaskHost<Env>, TaskParams, TaskProgress, Env>`. The last generic is what types `this.env`, which `step.agent`'s namespaces and the workflow bindings come from. `extendStep` adds three helpers; `step.do` is unchanged.

**The base class owns `run()`; a subclass implements `pipeline(event, step)`.** `run()` calls it, then:
- on a result: `step.reportComplete(result)`, then return it. Returning alone notifies no agent: `onWorkflowComplete` fires from `reportComplete` only.
- on a throw: `step.reportError(reason)`, then rethrow. The SDK's own report of a throw (`_autoReportError`) is best-effort and swallows its failure.

Both are durable steps, so no pipeline can leave its task unsettled by forgetting one.

- **`step.agent(name, { agent, input, key?, output? })`** follows the algorithm in part 0:
  - start → `noteJob` + `startJob`;
  - wait for the job's event;
  - relay a question through `park`, wait for the answer, then `answerJob`;
  - loop until the job completes or fails.

  Details:
  - The job id and the event type derive from the instance id, the step name and the hashed `key`, the way `ThinkWorkflow`'s `_idempotencyKeyForPrompt` and `_eventTypeForPrompt` do, so a re-run `:start` starts nothing.
  - `agent` resolves a namespace; the instance is the caller's, taken from the params.
  - `output` is a Zod schema. The reply is validated against it, and the agent is handed its JSON Schema on whichever path G8 decided.
- **`step.say(text)`**: a durable `step.do` that calls the host's `say`, keyed so a replay does not repeat the line.
- **`step.ask(question)`**: `park`, then wait for the answer.
- **No default timeout.** The gatekeeper's hour and the question's expiry bound a task already; add no speculative cap.
- **A failed job throws** with the job's reason. `run()` reports it through `step.reportError`, and the host's `onWorkflowError` answers in this deployment's words.
- **`pipeline()` returns `{ reply, outcome? }`.** `run()` adds the verdict (the outcome, the steps that ran) and reports it all. The verdict is what makes a failed-as-value task visible in Workflow status.

### `/agent`: `A2AAgent` becomes the step agent

Rename it if part 0 decided a name. Starter, the only consumer, is updated in part 2.

- **`startJob(job)`**, idempotent on `jobId`:
  - a job row;
  - `runTurn({ mode: "submit", idempotencyKey: jobId, … })`, with `jobId` and the A2A `taskId` in `turnMetadata`.

  The job carries the workflow's name, instance id and event type, and the host's binding and name.
- **Settlement** is the logic of today's `#settleCompleted`, per job:
  - a pending `ask_user` → an `input-required` event carrying the question;
  - open work → the interim reply goes to the host as progress, and the job stays open;
  - otherwise → a `completed` event with the reply, plus the structured output when `output` asked for it;
  - a turn that errored → a `failed` event.
- **Delivery**: `this.queue("deliverJobEvent", …, { id, retry })` → `sendWorkflowEvent(name, id, event)`. It is the same outbox pattern callbacks use today, and every agent in the Worker has the workflow bindings in `env`.
- **`answerJob(jobId, reply)`** submits the answer as the next turn: today's `submitAnswer` path, keyed by job.
- **`cancelJob(jobId)`** aborts the turn, then `cancelAgentTool` for each background run and `cancelSchedule` for each wait. It sends no event, because the host already settled the task. **It resets nothing.**
- **Progress**: `onChunk`'s flush goes to the host's `progress`, best-effort as `#push` is today.
- **`turnTaskId()`** still answers the A2A task id, now taken from the job, so AI Gateway attribution and transcript keys still name the task. Add `turnJobId()`.
- **Keyed by job instead of task:**
  - follow-ups (`onSubAgentFinish`, `submitFollowUp`);
  - `check_back` wakes;
  - `onChatRecovery`'s canceled check;
  - milestone replay.
- **`onTaskSettled(taskId, state)`** becomes the step agent's hook for the host's end-of-task notice.

### Everything else

- **`/worker`:** `defineAgent({ tenant, manifest, agent })` names the host's namespace. Rename the field if that reads better. The resolver keeps `idFromName(identity.key)`, plus whatever G1 found about by-name resolution for workflow callbacks.
- **`/subagent`:** unchanged, except where it reads the task: notes and gateway fields now read the job's task id.
- **`/testing`:** `createAgentHarness` drives a tenant through its host and workflow. Add helpers to mount scripted step agents, and wrappers over `introspectWorkflowInstance`.
- **plugins:** `PluginContext` carries nothing task-keyed today (`src/contract/plugin.ts`), so no plugins change is expected. If the spike found one, it is a separate plugins PR with a `PLUGIN_CONTRACT_VERSION` bump, after this.
- **Docs:** core's `README.md` and `AGENTS.md`:
  - the roles, and what each owns;
  - `step.agent`, `step.say` and `step.ask`;
  - core's "where a change goes".

  The design's explanation lives here; starter points at it.

## Specs

- **Workflow start, settlement, expiry:**
  - a redelivery recovers after a crash at each start boundary (after the row, after `create`, after the tracking row), to one tracked instance;
  - a pipeline that returns, and one that throws, each settle the task through `reportComplete` and `reportError`;
  - reconciliation settles a task whose report never arrived;
  - question expiry terminates the instance and stops the job, keeping its work.
- **Port `src/agent/agent.spec.ts`'s task lifecycle** to host plus workflow:
  - accept idempotency;
  - ask and answer;
  - cancel mid-step;
  - question expiry;
  - delivery retries;
  - the restart sweep;
  - exactly one terminal callback.
- **The job:** a job spanning a background run reports once; a question relays and completes; `cancelJob` keeps work; a re-run `:start` starts nothing.
- **A pipeline of scripted agents** through the A2A edge: the part-0 gates that belong to core (G1–G7, G9 in miniature).

## Verification

```bash
npm run check && npm test && npm run build
```

Then check starter against it before the PR:
- `cd $W/starter && npm run link:local`, and run starter's suite on the spike branch;
- `npm ci` afterwards, to unlink.

## Hand-over

- Push `feat/task-workflows`, and open a PR into core's `main`.
- The description names the breaking API: `A2AAgent` → the step agent, plus the host and the workflow. It also says starter takes it by git ref (part 2), with no version bump.
- Answer Copilot's one review in one pass, reading its body too. Never merge.

## Rules

As in part 0: never merge; no version bumps; one Copilot review; comments state a constraint, a measurement or a coupling; stopping never clears work.
