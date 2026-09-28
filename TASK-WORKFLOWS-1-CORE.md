# Task workflows, part 1: core

Part 1 of the series. [`TASK-WORKFLOWS-0-SPIKE.md`](TASK-WORKFLOWS-0-SPIKE.md) holds the design (the task host, the task workflow, step agents), the facts behind it and the spike's results. Read it first; this file does not restate it.

**Built: [core#66](https://github.com/dynamicagents/core/pull/66).** Where building it changed this file, the file says so below.

**The spike's code is the reference.** `spike/task-workflows` in `~/dev/dynamicagents/worktrees/task-workflows/core` built every piece below and passed every gate against it. Port what it proved, not its code wholesale: it keeps today's task path beside the step job path, which this part deletes.

## Outcome

One PR into core's `main`, with no version bump. starter takes it by git ref in part 2. After it:
- the task host owns the A2A task;
- `TaskWorkflow` owns the steps;
- today's `A2AAgent` is **`StepAgent`**, which runs step jobs and reports them to the workflow. It speaks no A2A any more, so the name goes.

There is no path where an agent owns a task.

## Setup

```bash
W=~/dev/dynamicagents/worktrees/task-workflows
cd $W/core && git fetch origin && git switch -c feat/task-workflows origin/main && npm ci
```

`$W/plugins` stays beside it: starter's `link:local` refuses to run without both siblings. Leave `~/dev/dynamicagents/worktrees/think/*` alone.

## What changes

### `/task` (new, `src/task/`): the task host

`TaskHost<Env> extends Agent<Env>` (agents, not Think), implementing `TaskAgent` from `src/a2a/agent-stub.ts`. Abstract members: `copy`, `workflowBinding`, and `hostBinding` — the env binding a workflow's callbacks and steps reach the host through. Named rather than found: left to itself, the SDK looks for a binding matching the class name, so a host whose binding is named otherwise would leave callbacks nowhere.

**Moves out of `src/agent/agent.ts`:**
- the edge surface: `acceptTask`, `getTask`, `listTasks`, `saveTask`, `cancelTask`, `answerTask`, `expireTask`;
- settlement: `#finish`, `#enqueueDelivery`, `deliverTask` and `DELIVERY_RETRY`, `runSettleHooks` and `#settled`, `settleTranscript`;
- the cancel ordering;
- `onStart`'s sweep of owed deliveries, hooks and answers;
- the push channel. The self-origin and `nextPushKey` stay with the step agent, which files notes and posts progress; the host reads neither;
- retention for the task rows;
- `A2ACopy`, because these are now the host's words;
- the task table of `A2ATasks`, now `src/task/tasks.ts`. The step agent's half is `StepJobs` (`src/agent/step-jobs.ts`): the job rows, their numbered reports and the work table, in tables of its own. Each transition commits with the report it owes in one transaction (`transactionSync`, as Think does for a submission's status and its notification), so no delivery key stands in for one.

**New in the host** (the spike's `src/task/host.ts` and `runs.ts`):
- **The start protocol.** The params are recorded beside the row (`da_task_runs`), then `runWorkflow(workflowBinding, params, { id: taskId, agentBinding: hostBinding })`. A failed start whose instance exists — `get(id).status()` answers — means an earlier start got that far, and adopts it. It is checked by status, not by the error's words, because production `create()`'s duplicate error cannot run locally. The row is bound last, then marked `working`; a cancel that landed during the start stops the run there. The start-up sweep re-runs any row accepted and never bound.
  - `acceptTask` answers with the task as accepted: the edge publishes it as the `submitted` ack.
  - **No tracking row of the host's own.** The host controls an instance through the binding (`get(id).terminate()`, `get(id).status()`), which needs no row, so a start cut between `create` and the SDK's insert costs nothing.
  - Params: `taskId`, `contextId`, `messageId`, `text`, the verified caller (`identity`, and its key as `callerKey`), the caller context string, the `jku`, and `hostBinding`.
- `onWorkflowComplete(result)` → `#finish` completed, with `result.reply` or `copy.emptyReply`. `onWorkflowError` → `#finish` failed, with `copy.failed`. Both repeat, and both are guarded.
- **Reconciliation** on `getTask`: a task still open whose instance is `complete` or `errored` is settled from its status, through the same private settle the callbacks use. One whose instance was `terminated` fails: the host terminates only after its own guarded write, so it was stopped from outside.
- **Retention** is a weekly cron `schedule`, armed in `onStart`, idempotent: a plain `Agent` has no `getScheduledTasks`. It reconciles every open bound task, then sweeps.
- RPC the workflow calls from its steps:
  - `noteStepJob(taskId, { stepJobId, binding })` → whether the task is open, checked and written with no await between (`da_task_step_jobs`);
  - `park(taskId, request)` → whether the task is parked on it. A question already answered is not asked again (`da_task_answered`): a replayed park step would otherwise put it back;
  - `progress(taskId, text, key)`: a progress line, best-effort. `step.say` and step agents both use it.
- `answerTask` relays an answer an earlier call left owed first, then validates as today, with one addition: an `approval` that names no options takes the protocol's `approve` and `reject` ids. `ledger.resume` owes the relay; `deliverAnswer` sends `sendWorkflowEvent(workflowBinding, taskId, { type: ans-<hash(requestId)>, payload: { optionId?, text? } })` and clears it. The start-up sweep finishes a relay an eviction cut short.
- `cancelTask` → the guarded write → terminate the instance → `cancelStepJob` on each noted job → the hooks.
- **`expireTask`: the guarded write first** (failed, `copy.questionExpired`), then the same stop. Written first so an answer that won stays won, and so a task that already finished is not stopped.
- **Both owe the stop in the guarded write** (`stop_pending`), and the start-up sweep finishes a stop an eviction cut short. The spike's sweep stopped only `canceled` rows, which left an expired task's instance waiting.
- **The stop is cleared only once every part of it held:** the terminate, or an instance already ended, and every job's cancel. A failed one is retried from the queue. A status read that fails counts as an ended instance only for a task never bound, because a bound task's instance exists. A step agent likewise closes a work row only once its stop held.
- **The end-of-task notice.** `#settled` queues `notifyStepAgent` once per agent binding that ran a job, which calls `stepTaskSettled(taskId, state)` on the caller's instance, with retries.
- `onTaskSettled` stays overridable on the host.

### `/workflow` (new, `src/workflow/`): the task workflow

`TaskWorkflow<Env extends Cloudflare.Env & CoreEnv> extends AgentWorkflow<TaskHost<Env>, TaskParams, DefaultProgress, Env>` (the spike's `workflow.ts`, `keys.ts` and `types.ts`).

- **`run()` is the base class's, and every subclass declares it too:** `override run(event, step) { return super.run(event, step); }`. The constructor throws a `TypeError` naming a subclass that does not (G0). `run()` calls `pipeline()`, adds the verdict, and reports through `step.reportComplete`, or reports a throw through `step.reportError` and rethrows.
- **`step.agent(name, { agent, input, role?, key? })`** — `agent` is a binding name. The start step (`noteStepJob` then `startStepJob`, with retries) refuses a closed task with a `NonRetryableError`; then one `waitForEvent` per report, typed `sj-<hash(stepJobId)>-<n>`; a question relays through `park`, a wait for the answer, and `answerStepJob`; a `failed` report throws.
- **A failed report retries the step once**: the job runs again as `<name>:retry`, with `attempt: 2`, and a second failure throws. Only a `failed` report does; a closed task or a start that cannot be made fails at once.
- **`step.ask(name, request)`** — a question of the pipeline's own, with the request id `<instanceId>:<name>`.
- **`step.say(text)`** — a numbered `say:<n>` step, so saying one thing twice is two lines and a replay is none.
- **Every wait passes `WAIT_CEILING`** (`"365 days"`, the platform's ceiling). Unset, a wait gives up after a day and fails the instance.
- Stubs are resolved inside each step with `getAgentByName`, never held across one — the host's too. `this.agent` is one stub per `run()` invocation, and stays only in the SDK's own `reportComplete` and `reportError`.
- **Step names carry the helper's prefix** (`agent:`, `ask:`, `say:`), and **a label run twice in one run fails the task by name.** Workflows hands a repeated step name the first one's result.
- **No `output`.** Nothing in the train needs a structured verdict yet; part 0's facts say how one is forced when a judge comes.
- The job id, the event types and the hash (`digest`: SHA-256, base64url, cut to Think's length) live in `keys.ts`, the one place both sides derive them from.

### `/agent`: `A2AAgent` becomes `StepAgent`

- **`startStepJob(job)`**, idempotent on the job id:
  - a job that settled sends its reports again (a restarted instance waits for them from the first); a canceled one starts nothing; one already submitted does nothing;
  - otherwise the job's row (`StepJobs`, `src/agent/step-jobs.ts`) and a ledger row keyed by the job id, then `runTurn({ mode: "submit", idempotencyKey: stepjob:<id> })` with `formatStepJobInput(job)` as the message and `{ taskId, stepJobId, contextId }` as `turnMetadata`.
- **`formatStepJobInput(job)`** — a subclass briefs the model on the job's `role` here, and on a retry (`job.attempt > 1`): core writes no prompt copy. `turnStepJob()` gives a turn its job, so `beforeTurn` can shape the tools by role.
- **Settlement** is today's `#settleCompleted` order, with a report in place of the callback. The ledger transition, its acknowledgement and the numbered report are written with no await between; `deliverStepJobReport` sends it, and drops it when the instance has ended.
- **`answerStepJob(stepJobId, answer)`** maps the option to its label and takes today's `submitAnswer` path.
- **`cancelStepJob(stepJobId)`** aborts the turn, cancels background runs and waits, drops unsent reports, and runs no hooks. A job with no row yet gets a canceled one (`tombstone`), so its start starts nothing. **It resets nothing.**
- **`stepTaskSettled(taskId, state)`** runs `onTaskSettled`: the host's end-of-task notice. It first stops any job of the task still open, keeping its work: a pipeline that throws beside a parallel step would otherwise orphan it.
- **A turn for a row that has ended does nothing.** Think marks a submission cut at its ceiling `error`, and then recovers the same turn anyway. In G11 the recovered turn ran on for twelve minutes after its job had reported `failed`: it wrote to the caller's memory and tried to start two writing sessions. These changes stop it:
  - `onChatRecovery` declines any turn whose ledger row is terminal — `failed` and `completed` as well as `canceled`;
  - `beforeTurn` gives a turn for such a row no tools (`activeTools: []`), so nothing it says can act;
  - `beforeToolCall` refuses every call, and a stop condition ends the turn at its next step. Starter's `beforeTurn` overrides replace `activeTools`, and a turn already running when its job ended is past `beforeTurn`;
  - the sub-agent tool's refusal says the task has ended, not that it was canceled.

  A job that fails also stops its background runs and wakes, keeping their work, so its retry does not work beside them. Its report waits until that stop has held, because the workflow starts the retry as soon as the report lands; a restart retries the stop before sending it.

  This is what makes the retry safe: without it, the retried job queues behind a recovered turn still working on the first attempt.
- **A turn cut at the runtime's ceiling fails its job, and the step is retried once.** Core sets no deadline of its own. A step includes its tool calls, and one command can take a whole alarm invocation — whose fifteen minutes also cover whatever the alarm ran before the turn: G11's turn was cut at 11 m 50 s of its own time — so no margin short of the ceiling is safe. Long work leaves the turn instead, planned as its own series.
- **Two ids per turn.** `turnTaskId()` answers the A2A task (gateway attribution, the transcript, a sub-agent's envelope, `prepare` and `settle`); `turnStepJobId()` answers the job. The ledger, work rows, follow-ups, `check_back` and recovery key on `stepJobId ?? taskId` — which, once the task path is gone, is `stepJobId`.
- **Progress and notes.** `onChunk`'s flush and an interim reply go to the host's `progress`; a sub-agent's notes go on the A2A task's transcript, with lines to the host. `onStart` re-learns the origin from open jobs' `jku`, or a note after an eviction would carry no link.

### Everything else

- **`/worker`:** `defineAgent`'s `agent` names the host's namespace. The resolver keeps `idFromName(identity.key)`; `getAgentByName` resolves the same instance, as G1 found.
- **`/subagent`:** unchanged. The envelope already carries the A2A task id.
- **`/testing`:** `createAgentHarness` drives a tenant through its host and workflow unchanged. The test worker gains a host, a pipeline, a second step agent class, and a pipeline that does not declare `run()`, with a `workflows` block and a migration in core's test `wrangler.jsonc`.
- **`package.json`:** `./task` and `./workflow` exports.
- **plugins:** `PluginContext` carries nothing task-keyed, so no plugins change.
- **Docs:** core's `README.md` and `AGENTS.md`: the roles and what each owns; `step.agent`, `step.say`, `step.ask`; the `run()` rule; core's "where a change goes". The design's explanation lives here; starter points at it.

## Specs

Port the spike's `src/workflow/workflow.spec.ts`, and `src/agent/agent.spec.ts`'s task lifecycle onto host plus workflow:
- **G0:** a pipeline that inherits `run()` is refused, by name; one that declares it completes.
- **G1:** one instance per task, its verdict in the output; a redelivered `messageId` starts nothing; a start cut after the row, after `create` and after the tracking row each recover to one tracked instance; a lost completion report is reconciled on `GetTask`; a throw fails the task in `copy.failed`.
- **G2:** steps on two agent classes, fed one to the next; `:start` returns while the job still works.
- **G3:** a job with a background run stays open across its follow-up and reports once.
- **G4:** a job's question relays through the host and the job completes on the answer.
- **G5:** cancel mid-job and at a question; expiry; a cancel before the start; a report to an ended instance dropped.
- **Retry:** a step that fails once runs again, told so, and completes; one that fails twice fails the task.
- **A settled row's turn:** a recovered turn for a job that has reported is not continued, and a turn for a closed row has no tools.
- **G9 in miniature:** a refusal's reply planned again, then approval.
- **Attribution and role:** a job's turn sees the A2A task id, its job id and its role; `step.say` pushes once.
- Delivery retries, the start-up sweep, and exactly one terminal callback throughout.
- **The host's own bookkeeping:** a stop an expiry cut short; a `terminated` instance reconciled; retention reconciling and sweeping; an owed answer relayed first.
- **A pipeline's own guards:** an orphaned job stopped by the notice; a label run twice refused by name.

## Verification

```bash
npm run check && npm test && npm run build
```

Then check starter against it before the PR: `cd $W/starter && npm run link:local`, run starter's suite on the spike branch, and `npm ci` afterwards to unlink.

The spike's starter extends `A2AAgent`, so the check runs under a throwaway patch — the rename and `copy` onto the hosts — discarded afterwards. With it, everything passed but `reactive` and `cf-coder`: their tenants still point at their agents, whose edge surface is gone. Part 2 gives them hosts.

## Hand-over

- Push `feat/task-workflows`, and open a PR into core's `main`.
- The description names the breaking API: `A2AAgent` → `StepAgent`, plus the host and the workflow. It says starter takes it by git ref (part 2), with no version bump.
- Answer Copilot's one review in one pass, reading its body too. Never merge.

## Rules

As in part 0: never merge; no version bumps; one Copilot review; comments state a constraint, a measurement or a coupling; stopping never clears work.
