# Task workflows, part 0: the design, and the spike that tests it

This is part 0 of a series, and each part runs in its own clean session launched from `dev-agents`:
- **Part 0, this file:** the design, the facts behind it, and a spike that proves it. The results are written back here before part 1 starts.
- [`TASK-WORKFLOWS-1-CORE.md`](TASK-WORKFLOWS-1-CORE.md): the core change.
- [`TASK-WORKFLOWS-2-STARTER.md`](TASK-WORKFLOWS-2-STARTER.md): starter on it.

**This file is the one home for the design.** Parts 1 and 2 point here rather than restating it. What the spike finds corrects this file, not theirs.

## Why

Phase 3 (starter#75, branch `feat/think`) puts each agent on `@cloudflare/think`, with the agent owning its A2A task:
- core's `A2AAgent.acceptTask` submits a turn;
- the agent pushes progress from `onChunk`;
- the agent settles the task and delivers the callback itself.

The goal is bigger than one agent answering. **A task is a pipeline of steps**, some mechanical and some run by an agent:
- triage or retrieval before the main agent;
- a planner before a coder;
- a judge or eval after the main agent.

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
   - `acceptTask` → `runWorkflow(<tenant's pipeline>, params, { id: taskId })`, idempotent on the gatekeeper's `messageId` as today. Starting is not idempotent by itself (see the facts below), so the host runs a start protocol that recovers at every boundary. It is in part 1.
   - `onWorkflowProgress` → pushes `working`.
   - `onWorkflowComplete` → the guarded terminal write, then the callback. `onWorkflowError` → a failed task in this deployment's words.
   - `answerTask` → `sendWorkflowEvent`, answering the question the workflow parked on.
   - `cancelTask` → the guarded write. Then it terminates the instance and stops each running job, **keeping its work**. Stopping never clears work: the agent that picks the task up again decides.
   - An expired question takes the same stop path, then fails the task in its words. Otherwise the instance would go on waiting, and its job would stay open, after the task had ended.
   - A task whose instance ended without reaching the host is reconciled against the instance's status. This is the backstop for a completion report that ran out of retries.
2. **Task workflow** — owns the sequence of steps and the state between them.
   - Core's `A2ATaskWorkflow<Env> extends AgentWorkflow<TaskHost<Env>, TaskParams, TaskProgress, Env>`. Forwarding `Env` is what types `this.env`, where the agents' namespaces come from. It adds step helpers through `extendStep`, the hook `ThinkWorkflow` uses:
     - `step.agent(name, { agent, input, output? })` runs a job on a step agent and returns its reply. With `output` (a Zod schema), the reply is validated.
     - `step.say(text)` pushes a progress line through the host.
     - `step.ask(question)` asks at the workflow level: it parks the task `input-required` and resumes on the answer.
     - `step.do`: mechanical steps, as Workflows already have.
   - **The base class owns `run()`, and a subclass writes `pipeline()`.**
     - Its result, the reply and a small verdict (1 MiB cap), reaches the host through `step.reportComplete`, then becomes the instance output. The verdict is there because a task that failed as a value otherwise reads `complete / success` in Workflow status (see the lessons below).
     - A throw goes through `step.reportError` before it propagates.
     - Returning from `run()` notifies no agent, and the SDK's own report of a throw is best-effort. So both reports are durable steps, and a pipeline cannot forget either.
3. **Step agents** — own a job and their conversation.
   - Today's Think agents (Reactive, CfCoder, ClaudeCoder, and new ones such as a planner and a judge), with no A2A of their own.
   - `A2AAgent`'s ledger semantics stay, re-keyed from *A2A task* to *job*. A job spans turns while it has open work: background sub-agent runs, `check_back` wakes, its own questions. It reports **once**, when it settles.
   - It reports by `sendWorkflowEvent`, through the same kind of outbox that delivers callbacks today. Its progress goes to the host over RPC, never to the gatekeeper.
   - Plugins, workspaces, sub-agents and souls are unchanged. A step agent may still delegate inside itself.

How `step.agent` runs a job — the `ThinkWorkflow._promptStep` pattern, generalised to any agent and to jobs that span turns:

```
step.do("<name>:start")  → host.noteJob(…); agent.startJob({ jobId, taskId, input, schema?, workflow: { name, id, eventType }, host })
loop:
  step.waitForEvent("<name>:wait:<n>", { type: eventType })
    input-required → step.do: host parks the task (push input-required)
                   → step.waitForEvent(answer) → step.do: agent.answerJob(jobId, reply) → next n
    completed      → validate against the schema if given → return the reply
    failed         → the step fails, and the task fails in this deployment's words
```

The job id is `<instanceId>:<name>`, plus a hash of `key` in a loop, as `ThinkWorkflow` derives its idempotency key. A re-run of `:start` after a crash finds the job and starts nothing.

What a pipeline could look like. This is illustrative; the spike settles the names:

```ts
export class CfCoderTask extends A2ATaskWorkflow<Env> {
  async pipeline(event, step) {
    const plan = await step.agent("plan", { agent: (env) => env.CfPlanner, input: event.payload.text });
    let work = await step.agent("code", { agent: (env) => env.CfCoder, input: plan });
    let verdict = await step.agent("judge", { agent: (env) => env.CfJudge, input: work, output: Verdict });
    if (!verdict.accept) {
      await step.say("The review asked for changes; the coder is on them.");
      work = await step.agent("code:again", { agent: (env) => env.CfCoder, input: verdict.feedback });
      verdict = await step.agent("judge:again", { agent: (env) => env.CfJudge, input: work, output: Verdict });
    }
    if (!verdict.accept) {
      return { reply: `${work}\n\nNot published: the review still asks for changes.\n\n${verdict.feedback}`, outcome: "rejected" };
    }
    const published = await step.agent("publish", {
      agent: (env) => env.CfCoder,
      input: "The review accepted this branch. Push it and open the pull request."
    });
    return { reply: published };
  }
}
```

**One send-back is the policy.** A second rejection is an answer, not a fault. The task completes, and its reply names the unpublished branch and the review's remaining feedback. The work stays on its branch for the next request to decide, and the verdict's `rejected` outcome keeps it visible in Workflow status.

A step agent is addressed per caller, as today: `step.agent` takes the namespace and uses the caller's key from the workflow's params. The agent keeps one conversation and one memory per caller across tasks and steps.

### Decisions already taken

- **An agent step is a job that spans turns**, not one Think turn. A Claude Code session stays inside one coder step.
- **Both kinds of structure stay.** The fixed pipeline lives in the workflow, as in LangGraph. Inside a step, an agent may still delegate to sub-agents it chooses, as in DeepAgents. cf-coder's `code` and claude-coder's sessions stay.
- **Every tenant is a pipeline.** A single-agent tenant is a one-step pipeline, and there is no path where an agent owns a task (opinionated defaults).
- **The first real pipeline is cf-coder's planner → coder → judge.** The judge may send the work back to the coder once.
- **starter#75 is held.** Part 2 stacks on `feat/think`.

### The facts behind it

Each was checked against the Think and agents releases that starter's `feat/think` installs. Re-check any that a bump touches.

- **`ThinkWorkflow`** (`@cloudflare/think/workflows`; docs in `node_modules/@cloudflare/think/docs/workflows.md`, code in `dist/workflows.js`) extends `AgentWorkflow` with `step.prompt(name, { prompt, output, timeout, key })`.
  - **How it works:**
    - `step.do("<name>:submit")` → `this.agent.submitMessages`, idempotent on `think-workflow:<workflow>:<id>:<step>`;
    - Think queues a notification when the submission is terminal, and delivers it with `sendWorkflowEvent`, retrying with backoff for twelve hours;
    - then `step.waitForEvent("<name>:wait")`, a second Zod validation, and a cancel on timeout.
  - **It is anchored to one agent.** `this.agent` is whichever agent called `runWorkflow()`, and `step.prompt` always prompts it. A pipeline of different agents cannot be written with it.
  - **It covers one turn.** It resolves when the submission is terminal, so a turn that dispatches a background run, or asks the user, ends the step early.
  - **Structured output forces a tool call while streaming.** Think's docs name models that reply in plain text instead, and GLM once ended a turn without the tool it announced (G1 in `THINK-FINDINGS.md`).
  - **Delivery is not tied to the starting agent.** The target workflow is read from the submission's metadata, under a **private** key (`__thinkWorkflowPrompt`), and `_cfDeliverWorkflowNotification` sends it through `env[workflowName]`. So the *pattern* generalises, but depending on that key would be depending on Think internals. Core builds its own on its ledger instead.
- **`AgentWorkflow`** (`agents/workflows`; `node_modules/agents/docs/workflows.md`):
  - `runWorkflow` tracks the instance in the originating agent's SQLite;
  - callbacks go to that agent: `onWorkflowProgress`, `onWorkflowComplete`, `onWorkflowError`, `onWorkflowEvent`;
  - control: `sendWorkflowEvent`, `terminateWorkflow`, `pauseWorkflow`, `resumeWorkflow`, `restartWorkflow`;
  - `this.reportProgress` is not durable; `step.reportComplete` and `step.reportError` are.
  - **`run()`'s return value is only the instance output.** `onWorkflowComplete` fires from `step.reportComplete` alone. A throw from `run()` is reported by `_autoReportError`, which swallows its own failure (`dist/workflows.js`).
  - **`runWorkflow` is not idempotent.** It calls `create({ id })`, which throws on an id that exists, then inserts a tracking row under a unique constraint, which throws too. `terminateWorkflow` and its siblings look the instance up through that row.
  - **Callbacks re-resolve the origin with `getAgentByName`**, and class names must survive bundling (wrangler's `keep_names`). Core's edge addresses agents with `ns.get(ns.idFromName(identity.key))` (`src/worker/define-agent.ts`), which G1 has to reconcile.
  - When started from a sub-agent, `options.agentBinding` is the *root* binding.
- **agents Tasks** (`this.tasks`, `node_modules/agents/docs/tasks.md`) is an in-object step journal. It is experimental, has **no `waitForEvent`**, and cannot run on sub-agents, so it cannot park on a person's answer or on another agent. Ruled out.
- **Cloudflare Workflows limits**, Workers Paid (developers.cloudflare.com/workflows/reference/limits):
  - steps per instance: 10,000 by default, 25,000 on request;
  - CPU per step: 30 s by default, 5 min on request; wall-clock time per step is unlimited;
  - 1 MiB per step result and per event payload; 1 GB of state per instance;
  - waits and sleeps up to 365 days;
  - 50,000 running instances, and **a waiting instance does not count**;
  - completed state kept 30 days.
- **What the pre-Think Workflow design learned.** It lives in the `core` submodule at the commit dev-agents pins: `src/round/workflow.ts` and `src/platform.ts`.
  - A Workflow cannot reach a Durable Object's SQLite. Inputs travel as the payload, and state is reached over DO RPC.
  - An instance id derived from the gatekeeper's `messageId` makes a re-dispatch start nothing.
  - **A task that fails as a value reads `complete / success` in Workflow status.** That cost an incident; the verdict has to ride on the instance output.
  - A step re-run after a crash, before its result was recorded, must recover from the agent's durable rows rather than redo the work.
  - A step holding a long RPC is the wrong shape. Start in a step, then wait for an event.
  - A step is bounded by CPU, not wall clock. Measured over a 59-minute task, its steps used about 100 ms of CPU against 3,146 s of wall.
  - Parked on `waitForEvent`, an instance holds no concurrency.
- **The edge contract.** `TaskAgent` in core's `src/a2a/agent-stub.ts` is everything the edge calls, so a host that implements it leaves the edge unchanged.
- **Testing.** The vitest pool's `@cloudflare/vitest-plugin` exports `introspectWorkflowInstance` and `introspectWorkflow` (`types/cloudflare-test.d.ts`).
- **Prior art** (the `langgraph-*` and `deep-agents-*` skills; consult, never import). LangGraph's runtime owns the steps, the state between them, checkpoints and `interrupt()`, which is this design's workflow level. DeepAgents' `task` tool is model-chosen delegation, which is what a step agent keeps inside itself.

### Costs accepted

- Every task, even a one-step one, pays an extra hop and a Workflow instance.
- There are two durable engines. The one-owner-per-state split above is what keeps that sane.
- `cf.mjs` gets its `wf` command back.

## The spike

### Setup

Side-by-side worktrees, so starter's `link:local` resolves its siblings:

```bash
W=~/dev/dynamicagents/worktrees/task-workflows
git -C ~/dev/dynamicagents/dev-agents/core    worktree add $W/core    -b spike/task-workflows origin/main
git -C ~/dev/dynamicagents/dev-agents/starter worktree add $W/starter -b spike/task-workflows origin/feat/think
(cd $W/core && npm ci) && (cd $W/starter && npm ci && npm run link:local)
```

- Everything stays local. Push a spike branch only if asked.
- Leave `~/dev/dynamicagents/worktrees/think/*` alone: `think/starter` holds spike notes beside a `.secrets.env`.
- Prototype core's pieces where part 1 will put them (`src/task/`, `src/workflow/`, and `A2AAgent`'s job path), as little as each gate needs.
- In starter, wire the cf-coder pipeline with a minimal planner and judge.
- Drive every gate through core's A2A harness (`createAgentHarness` in `src/testing/harness.ts`) on scripted models (`scriptedModel`): a signed `SendMessage` in, push callbacks out.
- G6 and G8 run under `wrangler dev`. `THINK-FINDINGS.md` records why a local http gatekeeper can never be trusted, so drive the host below the edge there. The `AI` binding always calls Cloudflare, so G8 spends real tokens.

### Gates

| Gate | Passes when |
| --- | --- |
| G1: the edge → the host → `runWorkflow` | A `SendMessage` makes one instance with id = task id, and a redelivered `messageId` makes none. A crash after the ledger row, after `create`, and after the tracking row each recovers to one tracked instance on redelivery. The edge is unchanged. The workflow's callbacks reach the host by name, with class names intact in the bundle. |
| G2: a pipeline of different agents | One instance runs planner → coder → judge. Each step is start + `waitForEvent`, and no step holds an RPC open while an agent works. |
| G3: a job that spans turns | The coder's job dispatches its background `code` child, stays open across the follow-up turn, and reports once. |
| G4: a step agent's question | The coder's `ask_user` goes: job → workflow → host (`input-required` pushed) → `answerTask` → workflow → `answerJob` → the job completes, with one terminal callback. |
| G5: cancel | `CancelTask` mid-step terminates the instance and stops the running job, keeping its work (no reset). The task is `canceled`, with no terminal callback. |
| G6: interruption | `kill -9` of the local runtime mid-step, and a restart mid-step, each recover with exactly one terminal callback, and a re-run `:start` starts nothing. |
| G7: tests | Workflow specs run under the vitest pool with `introspectWorkflowInstance`, in both repos' suites. |
| G8: structured output | The judge's verdict comes back from GLM-5.3 as a validated schema through a forced tool call, across repeated runs. If it does not hold, the verdict is text with a marker line, and this file records which. |
| G9: the send-back | The judge rejects once, the coder `continue`s on the same branch, the judge accepts, and the coder's `publish` step opens the pull request, which one reply carries. A second rejection completes the task with the branch unpublished and the feedback in the reply. |

### Questions the spike answers

Record each answer under Results.

- **How the host knows a task's running jobs**, so cancel reaches them. Proposed: `step.agent`'s start step calls `host.noteJob`.
- **The end-of-task notice to step agents.** ClaudeCoder releases worktrees and containers in `onTaskSettled`. Proposed: the host tells each agent that ran a job for the task, through its outbox.
- **Progress.** A step agent's `onChunk` goes to the host over RPC, and so does `step.say`. Settle the durability each needs, and the text format of a step's lines.
- **Handoff between steps.** Text by default. What the coder hands the judge (branch, summary). The pull request is the coder's, opened in the `publish` step once the review accepts. Confirm it, or record a different owner.
- **The planner's and the judge's tools.** Read-only eyes on the checkout, as cf-coder's parent has. Can the judge run the project's gate, or does it ask `code` to?
- **The transcript.** It stays one per A2A task, fed by every step agent's sub-agent notes.
- **Gateway attribution.** A job carries its A2A task id, so AI Gateway rows still name the task.
- **Naming**, for core's exports: `TaskHost`, `A2ATaskWorkflow`, and whether `A2AAgent` is renamed now that it speaks no A2A.

### Results

_To be filled by the spike: per gate, pass or fail and what was measured. Then what parts 1 and 2 must change._

## Rules for every part

- Never merge; stop at push + PR. No version bumps.
- One Copilot review per PR, answered in one pass, with every thread resolved and every review body read.
- Comments state a constraint, a measurement or a coupling: no history, versions, dates or counts.
- HTTPS remotes.
- Stopping never clears work.
