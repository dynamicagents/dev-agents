# Task workflows, part 0: the design, and the spike that tests it

This is part 0 of a series, and each part runs in its own clean session launched from `dev-agents`:
- **Part 0, this file:** the design, the facts behind it, and the spike that proved it. Its results are below.
- [`TASK-WORKFLOWS-1-CORE.md`](TASK-WORKFLOWS-1-CORE.md): the core change.
- [`TASK-WORKFLOWS-2-STARTER.md`](TASK-WORKFLOWS-2-STARTER.md): starter on it.

**This file is the one home for the design.** Parts 1 and 2 point here rather than restating it. What the spike found has corrected this file, and parts 1 and 2 where they contradicted it.

## Why

Phase 3 (starter#75, branch `feat/think`) puts each agent on `@cloudflare/think`, with the agent owning its A2A task:
- core's `A2AAgent.acceptTask` submits a turn;
- the agent pushes progress from `onChunk`;
- the agent settles the task and delivers the callback itself.

The goal is bigger than one agent answering. **A task is a pipeline of steps**, some mechanical, some run by an agent, and some a person's:
- a plan the caller approves before anything is built;
- triage or retrieval before the main agent;
- a judge or eval after it.

So a task's steps, and every word the gatekeeper hears, belong at the **workflow level**, never in an underlying agent. **starter#75 is held** until this lands, so `next` never ships agents that own their own tasks.

## The design

### The roles

Each role is the only owner of its state.

1. **Task host** — owns the A2A task.
   - A plain agents `Agent`, not Think. There is one per caller per tenant, addressed `idFromName(identity.key)` as agents are today.
   - It implements core's `TaskAgent` edge surface (`acceptTask`, `getTask`, `listTasks`, `saveTask`, `cancelTask`, `answerTask`), so **core's edge and g2a-protocol do not change**.
   - It holds what `A2AAgent` holds today for the task:
     - the ledger (`A2ATasks`);
     - the signed push channel;
     - the delivery outbox with retries;
     - the cancel ordering;
     - retention;
     - the transcript's settle.
   - `acceptTask` → the ledger, idempotent on the gatekeeper's `messageId` as today → the **start protocol**, which recovers at every boundary:
     1. the params are recorded beside the row, so a start cut short can be run again;
     2. `runWorkflow(<tenant's pipeline>, params, { id: taskId, agentBinding })`, where an instance that already exists, or is already tracked, is adopted rather than an error;
     3. the row is bound last, then marked `working`.

     A redelivered `messageId` finds the row bound and returns. The start-up sweep re-runs any start an eviction cut short. The host controls an instance **through the binding** (`get(id).terminate()`, `.status()`), never through the SDK's tracking row, which a start cut between `create` and the insert never wrote.
   - `onWorkflowComplete` → the guarded terminal write, then the callback. `onWorkflowError` → a failed task in this deployment's words. Both callbacks repeat, because the SDK runs them as steps, so both are guarded.
   - `answerTask` → the ledger (`resume` owes the relay) → `sendWorkflowEvent`, answering the question the workflow parked on.
   - `cancelTask` → the guarded write, then it terminates the instance and stops each running step job, **keeping its work**. Stopping never clears work: the agent that picks the task up again decides.
   - An expired question takes the same path: the guarded write fails the task in its words, then the run is stopped. The write comes first, so an answer that won stays won.
   - **Reconciliation.** A task still open whose instance is terminal is settled from the instance's status on `getTask`. This is the backstop for a completion report that never arrived.
   - **The end-of-task notice.** Once a task is terminal, the outbox tells each agent that ran a step job for it, once per agent, through `stepTaskSettled(taskId, state)`. ClaudeCoder frees its worktrees and containers there.
2. **Task workflow** — owns the sequence of steps and the state between them.
   - Core's `TaskWorkflow<Env> extends AgentWorkflow<TaskHost<Env>, TaskParams, DefaultProgress, Env>`. It adds step helpers through `extendStep`, the hook `ThinkWorkflow` uses:
     - `step.agent(name, { agent, input, role?, key? })` runs a step job on a step agent and returns its reply. `agent` is the **binding name**: the host needs it to reach the agent again for a cancel or the notice, and a namespace object does not say its name. `key` tells repeats of one name apart, as a loop makes.
     - `step.ask(name, { kind, prompt, options?, allowFreeform? })` parks the task `input-required` on a question of the pipeline's own, and returns the answer.
     - `step.say(text)` pushes a progress line through the host, as a durable step.
     - `step.do`: mechanical steps, as Workflows already have.
   - **The base class owns `run()`, a subclass writes `pipeline()`, and every subclass declares `override run(event, step) { return super.run(event, step); }`.** The SDK wraps `run()` only on the class it is constructed as, and only when that class defines `run` itself (G0). The base constructor refuses a subclass that does not, by name, rather than leaving it with no host and no helpers.
   - **A failed step is retried once.** A job that reports `failed` — a turn that errored — is run again as `<name>:retry`, on the same agent, with `attempt: 2`. Its first attempt's work is kept, so the retry can carry on from it; what the model is told about the retry is the agent's to say, in `formatStepJobInput`. A second failure fails the task. Anything but a failed report — a closed task, a start that cannot be made — fails at once.
   - `run()` reports the pipeline's result through `step.reportComplete` and a throw through `step.reportError`. The result is the reply and a small verdict (outcome, steps that ran), which also becomes the instance output, because a task that ended as a value other than success otherwise reads `complete` in Workflow status.
3. **Step agents** — own a step job and their conversation.
   - Today's Think agents, with no A2A of their own. **`StepJob`** is the unit of work: `startStepJob`, `answerStepJob`, `cancelStepJob`. The name keeps clear of core's `/job` (`JobLifecycle`) and of agents' `onJob` / `this.jobs`.
   - `A2AAgent`'s ledger semantics stay, keyed by the step job instead of the A2A task. A job spans turns while it has open work: background sub-agent runs, `check_back` wakes, its own questions. It reports **once** when it settles, and once per question it asks.
   - Its turns carry both ids: `turnTaskId()` still answers the A2A task, so gateway attribution, the transcript and a sub-agent's `prepare` and `settle` are unchanged, and `turnStepJobId()` answers the job.
   - It reports by `sendWorkflowEvent`, from an outbox of numbered reports written in the same synchronous block as the ledger transition that owes each. A report to an instance that is no longer running is dropped: `sendEvent` refuses it, and retrying would go on for as long as the queue does.
   - Its progress goes to the host over RPC, never to the gatekeeper. Its sub-agents' notes go on the A2A task's transcript, their links resolving from the origin the job carries.
   - **A recovered turn whose row has ended is not continued**, a turn for such a row has no tools, and every call it makes is refused. Part 1 has each of these. A turn cut at the ceiling is continued while its job is open, and long work stays out of the turn (part 3).
   - A job's `role` is the agent's to interpret: the agent maps it to the tools a turn may call (`beforeTurn`) and to a brief ahead of the input (`formatStepJobInput`).
   - Plugins, workspaces, sub-agents and souls are unchanged. A step agent may still delegate inside itself.

How `step.agent` runs a job — the `ThinkWorkflow._promptStep` pattern, generalised to any agent and to jobs that span turns:

```
step.do("<label>:start")  → host.noteStepJob(taskId, { stepJobId, binding }); agent.startStepJob(job)
for n = 0, 1, …:
  step.waitForEvent("<label>:wait:<n>", { type: sj-<hash(stepJobId)>-<n>, timeout: WAIT_CEILING })
    input-required → step.do("<label>:<n>:park"): host.park(taskId, request)
                   → step.waitForEvent("<label>:<n>:reply", { type: ans-<hash(requestId)> })
                   → step.do("<label>:answer:<n>"): agent.answerStepJob(stepJobId, answer)
    completed      → return the reply
    failed         → run the step once more as "<name>:retry" (attempt 2); failing again, throw,
                     and the task fails in this deployment's words
```

- The job id is `<instanceId>:<name>`, plus a hash of `key`, so a re-run `:start` finds the job and starts nothing (G6). A job that has already settled sends its reports again, because a restarted instance waits for them from the first.
- Each report has an event type of its own, because Workflows buffers an event sent before its wait begins, and two reports under one type would be taken by whichever wait came first.
- `noteStepJob` refuses a closed task, checked and written with no await between, so a cancel either sees the job or the start fails. A cancel that reaches the agent before its start leaves a canceled row, and the start then starts nothing.
- Every wait passes `WAIT_CEILING`, the platform's ceiling. Unset, a wait gives up after a day and fails the instance; the task's own bounds (the question's expiry, a cancel) end it sooner by stopping the instance.

The first real pipeline, as the spike built it (starter's `src/agents/claude-coder/task.ts`):

```ts
export class ClaudeCoderTask extends TaskWorkflow<Env> {
  override run(event, step) { return super.run(event, step); }

  protected async pipeline(event, step) {
    const request = event.payload.text;
    const turnedDown: string[] = [];
    for (let n = 0; ; n++) {
      const plan = await step.agent("plan", { agent: "ClaudeCoder", role: "plan", key: String(n), input: planInput(request, turnedDown) });
      const answer = await step.ask(`approve:${n}`, { kind: "approval", prompt: `${plan}\n\n${PIPELINE_COPY.approveHint}`, allowFreeform: true });
      if (answer.optionId === HITL_APPROVE_OPTION_ID) {
        return { reply: await step.agent("code", { agent: "ClaudeCoder", role: "code", input: codeInput(request, plan, answer.text) }) };
      }
      turnedDown.push(answer.text ?? PIPELINE_COPY.noReason);
      await step.say(PIPELINE_COPY.replanning);
    }
  }
}
```

**The approval loops until the caller approves.** A plan turned down is written again with every refusal's reply; the question's expiry or a cancel is what ends it otherwise. Both steps run on the caller's ClaudeCoder, so the plan and the work share its checkout, worktrees and conversation, and no two objects contend for one container.

### Decisions already taken

- **An agent step is a job that spans turns**, not one Think turn. A Claude Code session stays inside one step.
- **Both kinds of structure stay.** The fixed pipeline lives in the workflow, as in LangGraph. Inside a step, an agent may still delegate to sub-agents it chooses, as in DeepAgents.
- **Every tenant is a pipeline.** A single-agent tenant is a one-step pipeline, and there is no path where an agent owns a task (opinionated defaults). reactive and cf-coder become one-step pipelines.
- **The first real pipeline is claude-coder's plan → approve → code**, on ClaudeCoder itself. The plan is a job with the `plan` role: it reads, through `claude_code_read` for anything beyond a quick look, and writes nothing.
- **A failed step is retried once**, with the agent telling the model it is a retry. The job stays fail-fast; the retry is the pipeline's.
- **A turn recovered after its job has settled does nothing** (G11). A turn cut at the ceiling is continued while its job is open, and long work stays out of the turn (part 3), not behind a deadline.
- **cf-coder stays out of the multi-step flow for now**, and there is **no judge** yet. When a judge comes, G8's facts below say how its verdict can be structured.
- **starter#75 is held.** Part 2 stacks on `feat/think`.

### The facts behind it

Each was checked against the Think and agents releases that starter's `feat/think` installs. Re-check any that a bump touches.

- **`ThinkWorkflow`** (`@cloudflare/think/workflows`; docs in `node_modules/@cloudflare/think/docs/workflows.md`, code in `dist/workflows.js`) extends `AgentWorkflow` with `step.prompt(name, { prompt, output, timeout, key, cancelOnTimeout })`.
  - **How it works:** `step.do("<name>:submit")` → `this.agent.submitMessages`, idempotent on `think-workflow:<workflow>:<id>:<step>[:<hash>]`; Think queues a notification in the same transaction as the terminal status and delivers it with `sendWorkflowEvent`, backing off up to ten minutes and giving up after twelve hours; then `step.waitForEvent("<name>:wait", { type: think-prompt-<hash> })`, a second Zod validation, and a best-effort cancel on any wait error.
  - **It is anchored to one agent.** `this.agent` is whichever agent called `runWorkflow()`, and its type must be a Think. A plain-`Agent` host cannot use it, and a pipeline of different agents cannot be written with it.
  - **It covers one submission.** A turn that asks the person, or dispatches a background run, ends its submission `completed`. For a job that spans turns, "submission terminal" is not "job done", so the report has to be the agent's own.
  - **Structured output is reachable only through a private key.** Think adds its forced `think_final_answer` tool only when the submission's metadata carries `__thinkWorkflowPrompt` naming a workflow, a step and an event type, which also switches Think's own notifier on. `beforeTurn` can set `tools`, `toolChoice`, `stopWhen` and `output` publicly, so a verdict can be forced without the key.
  - **A restart hangs it.** `restartWorkflow` keeps the id, so the idempotency key matches, `submitMessages` returns the old submission unaccepted, and no notification is sent again.
- **A turn's ceiling is its alarm invocation's.** Think runs a submitted turn inside an agents queue job (`_cfRunSubmission`), which the alarm drives after every job due before it, and a job's retry backoff sleeps inside the same invocation. The platform stops an alarm invocation after fifteen minutes, so time spent before the turn began is the turn's too.
  - `submissionRecoveryStaleMs` (900 s) is measured from the chat fiber's creation. The start-up sweep marks a running submission older than that `error`, and a fiber recovery scheduled after it continues the turn with no submission — which is how G11's turn ran on. `onChatRecovery` is consulted before that continuation is scheduled. `StepAgent` lifts the cutoff, so the ledger decides.
  - `beforeToolCall` gates every call a turn makes, and can `block` one. Unlike `activeTools`, it reaches a turn that is already running.
- **`AgentWorkflow`** (`agents/workflows`; `node_modules/agents/docs/workflows.md`):
  - **`run()` is wrapped only on the constructed class, and only when it defines `run` itself** (`Object.hasOwn(Object.getPrototypeOf(this), "run")` in the constructor). An inherited `run()` gets no `this.agent`, no step helpers, and keeps the `__agent*` params in its payload.
  - **`run()`'s return value is only the instance output.** `onWorkflowComplete` fires from `step.reportComplete` alone. A throw is reported by `_autoReportError`, which swallows its own failure.
  - **Callbacks repeat.** `step.reportComplete` and its siblings are steps named from a counter; a hook that throws is re-run with its step.
  - **`runWorkflow` is not idempotent.** It calls `create({ id })`, then inserts a tracking row under a unique constraint that throws on a repeat. `terminateWorkflow` and its siblings look the instance up through that row; `sendWorkflowEvent` and `getWorkflowStatus` do not need it, and callbacks only update it.
  - **Callbacks re-resolve the origin with `getAgentByName`**, which is `idFromName(name)` plus an initialising RPC, so a host addressed `idFromName(identity.key)` receives them. `runWorkflow` finds the host's binding by class name, exact or kebab-equal, unless `agentBinding` names it. Wrangler's `keep_names` defaults to on, and the bundle keeps every class name.
  - When started from a sub-agent, `options.agentBinding` is the *root* binding.
- **The agents queue** (`this.queue`) runs one job at a time per object, and an `id` **replaces** a pending item. A step job's report queues behind whatever that agent is dispatching; Think warns once a dispatch passes thirty seconds.
- **agents Tasks** (`this.tasks`, `node_modules/agents/docs/tasks.md`) is an in-object step journal. It is experimental, has **no `waitForEvent`**, and its docs rule out sub-agents. Ruled out.
- **Cloudflare Workflows limits**, Workers Paid (developers.cloudflare.com/workflows/reference/limits):
  - steps per instance: 10,000 by default, 25,000 on request;
  - CPU per step: 30 s by default, 5 min on request; wall-clock time per step is unlimited;
  - 1 MiB per step result and per event payload; 1 GB of state per instance;
  - waits and sleeps up to 365 days, and **a wait defaults to 24 hours** and then fails the instance;
  - 50,000 running instances, and **a waiting instance does not count**;
  - completed state kept 30 days;
  - **an instance id and an event type** match `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` and fit in 100 characters: no `:`, no `.`;
  - `create()` throws on an id already in use; `sendEvent` throws once an instance is not running; an event sent before its wait begins is buffered by type.
- **The local engine differs.** Miniflare's `create()` on an existing id resumes rather than throwing, so the adopt path's production branch cannot be exercised locally; the start protocol handles both. `step.do` defaults locally to five retries and a ten-minute timeout.
- **What the pre-Think Workflow design learned.** It lives in the `core` submodule at the commit dev-agents pins: `src/round/workflow.ts` and `src/platform.ts`.
  - A Workflow cannot reach a Durable Object's SQLite. Inputs travel as the payload, and state is reached over DO RPC.
  - **A task that fails as a value reads `complete / success` in Workflow status.** That cost an incident; the verdict has to ride on the instance output.
  - A step re-run after a crash, before its result was recorded, must recover from the agent's durable rows rather than redo the work.
  - A step holding a long RPC is the wrong shape. Start in a step, then wait for an event.
  - A stub is resolved inside each step and never held across one: a stub whose connection broke never reconnects.
  - A step is bounded by CPU, not wall clock. Measured over a 59-minute task, its steps used about 100 ms of CPU against 3,146 s of wall.
- **The edge contract.** `TaskAgent` in core's `src/a2a/agent-stub.ts` is everything the edge calls, so a host that implements it leaves the edge unchanged.
- **Testing.** `@cloudflare/vitest-plugin` exports `introspectWorkflowInstance` and `introspectWorkflow` (`types/cloudflare-test.d.ts`). An introspector's `dispose` aborts its instance. The harness observes pushes by stubbing `fetch` in the test isolate, so every push stays in the host.
- **Prior art** (the `langgraph-*` and `deep-agents-*` skills; consult, never import). LangGraph's runtime owns the steps, the state between them, checkpoints and `interrupt()`, which is this design's workflow level. DeepAgents' `task` tool is model-chosen delegation, which is what a step agent keeps inside itself.

### Costs accepted

- Every task, even a one-step one, pays an extra hop and a Workflow instance.
- There are two durable engines. The one-owner-per-state split above is what keeps that sane.
- `cf.mjs` gets its `wf` command back.

## The spike

### Where it is

Local branches, committed and never pushed, in side-by-side worktrees under `~/dev/dynamicagents/worktrees/task-workflows/`:
- `core` on `spike/task-workflows`, off core's `main`: `src/task/` (the host), `src/workflow/` (the workflow, its keys and types), the step job path in `src/agent/agent.ts` with `src/agent/step-jobs.ts`, and `src/workflow/workflow.spec.ts` over a test host and pipeline in `test/worker.ts`.
- `plugins` on `spike/task-workflows`, off plugins' `main`, unchanged. `link:local` refuses to run without it beside `core`.
- `starter` on `spike/task-workflows`, off `feat/think`: claude-coder's host, pipeline and roles (`src/agents/claude-coder/{host,task,roles}.ts`), `test/claude-coder-pipeline.spec.ts`, and under `spike/` and `src/spike/` a scripted tenant, token-gated debug routes that skip only the edge, a push sink, and the interruption runs (`spike/g6.mjs`).

### Gates

| Gate | Passes when |
| --- | --- |
| G0: the base class owns `run()` | A pipeline that writes only `pipeline()` gets its host and helpers, or fails loudly by name. |
| G1: the edge → the host → the workflow | A `SendMessage` makes one instance with id = task id, and a redelivered `messageId` makes none. A start cut after the ledger row, after `create`, and after the tracking row each recovers to one tracked instance. A lost completion report is reconciled. The edge is unchanged, and callbacks reach the host by name, with class names intact in the bundle. |
| G2: a pipeline of different agents | One instance runs steps on two agent classes, each step start + `waitForEvent`, and no step holds an RPC open while an agent works. |
| G3: a job that spans turns | A job dispatches a background run, stays open across the follow-up turn, and reports once. |
| G4: a step agent's question | A job's `ask_user` goes: job → workflow → host (`input-required` pushed) → `answerTask` → workflow → `answerStepJob` → the job completes, with one terminal callback. |
| G5: stopping | A cancel mid-job, a cancel at a question and a question's expiry each end the instance and stop the job, keeping its work, with no terminal callback on a cancel. A cancel before the job's start starts nothing; a report to an ended instance is dropped. |
| G6: interruption | `kill -9` of the local runtime, and a graceful stop, at each point in a step's life each recover with exactly one terminal callback, and a re-run `:start` starts nothing. A restarted instance does not hang. |
| G7: tests | Workflow specs run under the vitest pool with `introspectWorkflowInstance`, in both repos' suites. |
| G8: structured output | Deferred with the judge. |
| G9: the approval loop | Plan → approve → code, with one reply carrying the pull request; a refusal's reply is planned again, for as long as the caller answers. |
| G10: a plan writes nothing | The `plan` role's turns can call no writer: no writing session, commit, push, pull request or file write. |
| G11: live | plan → approve → code on `dynamicagents/starter` under `wrangler dev`, with the real container, Claude Code and GLM, ends in one terminal callback carrying the pull request. |

### Results

Every gate that ran passed except G11, which proved every mechanism live and did not deliver its pull request; the retry above is what the spike built in answer. G8 is deferred with the judge.

| Gate | Result |
| --- | --- |
| G0 | **Pass.** The merged design's shape alone would have failed silently: a subclass that writes only `pipeline()` is never wrapped. The base constructor now refuses one — the instance errors with "`NoRunTask` must declare run()" — and a subclass that declares the one-line `run()` gets its host and helpers. |
| G1 | **Pass.** One instance per task, its id the task id, its output `{ reply, verdict: { outcome, steps } }`. A redelivered `messageId` returns the same task with one tracked instance. A start cut after the row, after `create` (no tracking row) and after the tracking row each recover on redelivery to one instance and one terminal callback. A completion report dropped on purpose is settled by the next `GetTask`, from the instance's status. Nothing under core's `src/a2a` or `src/worker` changed. The dry-run bundle keeps every class name (`__name(this, "ClaudeCoderTasks")`). The production branch of the adopt path — `create` throwing on an existing id — cannot run locally, where `create` resumes; the protocol handles both. |
| G2 | **Pass.** One instance ran a step on `TestAgent` then one on `TestStepB`, the second fed the first's reply. With the job sleeping three seconds, `:start`'s result was recorded in under two and a half seconds. |
| G3 | **Pass.** A job that dispatched a background run stayed open through the follow-up turn and sent one report. Live, the plan job ran a Claude Code reading session and the code job a writing session, each in the background, each job reporting once. |
| G4 | **Pass.** A job's `ask_user` reached the caller as `input-required`; the answer came back through `answerTask`, was mapped to its option's label in the agent, and the job completed. Two reports (`input-required`, `completed`), one terminal callback. |
| G5 | **Pass.** Cancel mid-job: the instance terminated, the job's row canceled with its background run stopped and its work rows closed, its conversation kept, the end-of-task notice delivered, no terminal callback. Likewise at a question. Expiry: `failed` in `copy.questionExpired`, instance terminated, job canceled. A cancel before the start left a canceled row, and the start submitted nothing. A report to an ended instance was dropped. In starter: cancel while planning, at the approval and while writing, and the approval's expiry. |
| G6 | **Pass.** Under `wrangler dev`, on a scripted tenant (`spike/g6.mjs`); every trial ended with exactly one terminal push, one Think submission per job and one report per job: `kill -9` early and mid-tool, near the report and after it; `kill -9` inside `:start` after the job had started, where the re-run start started nothing; a graceful stop mid-tool and near the report; `kill -9` while parked on an approval, then the answer; `restart()` mid-job; `restart()` parked with the plan's job done, where the job sent its report again and the instance went on (the question was pushed a second time, under the same request id); `restart()` of a finished task, which errors at its first step — the host refuses to note a job for a closed task — rather than running twice. The scripted replies after an eviction read Think's recovery prompt back, as the Think spike found: a scripted model's artifact, not the pipeline's. |
| G7 | **Pass.** `introspectWorkflowInstance` in both suites: core's whole suite, the workflow specs included, and starter's, the claude-coder pipeline spec included, all green. `npm run check` clean in both. |
| G8 | Deferred with the judge. The facts above record how a verdict can be forced without Think's private key. |
| G9 | **Pass.** In core's miniature and starter's pipeline spec: a refusal's reply, with the option or without one, is planned again, for as long as it takes, and approval with a note hands the note to the code step. Live: a plan sent back with "fix all five findings" came back rescoped to all five. |
| G10 | **Pass.** `PLAN_TOOLS` pinned against the real agent's tools, exactly; each scripted turn recorded its role and active tools, a plan's without `claude_code`, a code step's with it. Live, the plan used `repo_clone`, reads, `grep` and `claude_code_read`, and changed nothing. |
| G11 | **Mechanisms pass; the pull request was not delivered.** On `dynamicagents/starter`, with the real container, Claude Code and GLM: plan 0 → the caller sent it back with feedback → plan 1 → approved → the code step's writing session made the five fixes, and the agent's review verified the diff. The task then **failed cleanly**: one terminal push, the instance `errored` with the reason, the end-of-task notice releasing both containers, the work kept — committed and pushed on the session's run branch. Two causes, neither the pipeline's: the plan had named a branch of its own, the agent pushed that name from a checkout where it still pointed at the base, and the pull request was refused as empty; retrying that inside one long review turn, the turn was cut by the runtime's alarm execution limit after 11 m 50 s, and Think ended the submission `error`. The old task-owning agent fails the same way. The run's own state then showed Think recovering the cut turn after the task had failed: it ran twelve more minutes, wrote to the caller's memory and tried to start two writing sessions, refused only because the job was closed. Part 1 answers both: a turn of a settled row does nothing, and a cut turn is continued while its job is open. |

**Measured live**, with the workspace image running under emulation, so each is an upper bound:
- the request to plan 0's question: 22 min, a container start, a clone, a 161 s dependency install and a Claude Code audit among it;
- the refusal to plan 1's question: 13 min, with no new session — the audit was in the conversation;
- the approval to the writing session's report: 12 min; the review turn after it: cut at 11 m 50 s;
- 27 pushes in all, two of them questions, one terminal;
- the plans ran to 5.3 KB and 7.5 KB: far under the contract's 256 KiB, but more than one Slack section block holds, so a gatekeeper splits them;
- Think warned of every long GLM dispatch starving the object's queue, which is the queue a job's report waits in.

**The questions, answered.**
- **How the host knows a task's running jobs:** `noteStepJob`, in the start step before `startStepJob`, refused on a closed task with no await between the check and the write. A cancel that reaches the agent first leaves a canceled row (`tombstone`), so no race starts orphaned work.
- **The end-of-task notice:** once per agent binding that ran a job, not per job, through the host's outbox. Live, ClaudeCoder's `onTaskSettled` released both of its containers.
- **Progress:** `step.say` is a durable, numbered step, pushed exactly once. A step agent's lines — `onChunk`'s flush, an interim reply, a sub-agent's note — are best-effort RPC to the host, keyed `<stepJobId>:<prefix>:<seq>` so the gatekeeper's dedupe keeps them apart. The agent's own text, with no step prefix, read naturally live.
- **Handoff:** text. The plan becomes the approval's prompt with the pipeline's hint; the code step gets the approved plan, the original request and the approval's note. The repository needs no parameter, because both steps run on one ClaudeCoder and share its checkout and conversation.
- **The planner's tools:** the plan role's allow-list (`PLAN_TOOLS`), enforced by `activeTools`, briefed by `ROLE_BRIEFS.plan`. There is no judge.
- **The transcript:** one per A2A task; the reading and writing sessions' notes landed on it. A facet posts its own link, so under `wrangler dev` the link names the deployed origin rather than the local one.
- **Gateway attribution:** unchanged. `turnTaskId()` answers the A2A task inside a job's turn, which a spec and starter's attribution spec both assert.
- **Naming:** `TaskHost`, `TaskWorkflow`, `StepJob`, and `A2AAgent` becomes `StepAgent`.

**Found along the way, outside the design:**
- **A plan that names a branch misleads the code step.** A claude-coder writing session commits to its own run branch, which is the pull request's head. The plan's brief says it names no branch (part 2), and claude-coder's soul says to push the branch under the name the session's report gives (starter#81).
- **The container checkout flattens symlinks.** starter's `CLAUDE.md` arrived as a nine-byte file holding `AGENTS.md`, which fails `prettier --check` there. A workspace matter for plugins, not this series.
- **`wrangler deploy --dry-run` builds the container images**, so it needs Docker running.

## Rules for every part

- Never merge; stop at push + PR. No version bumps.
- One Copilot review per PR, answered in one pass, with every thread resolved and every review body read.
- Comments state a constraint, a measurement or a coupling: no history, versions, dates or counts.
- HTTPS remotes.
- Stopping never clears work.
