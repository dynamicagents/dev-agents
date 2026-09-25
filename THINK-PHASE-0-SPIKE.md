# Phase 0: spike (done)

Read `THINK-FINDINGS.md` first. It has the decisions, the verified Think facts, and the results of gates G1–G9.

**G10**, the last gate, passes on the local checks below. It is what proves detached delegation works end to end before Phase 1 builds it into core:
- a sub-agent running longer than 15 minutes is dispatched with `runAgentTool({ detached: { onFinish } })`;
- the A2A task stays `working`;
- a follow-up turn settles it with the child's result.

The rest of this file is the specification Phase 1 ports from: what G10 is, how the spike implements it, and how it is checked.

## Where the spike is

- **Branch `claude-coder/0ca01723-882c-40ed-8c68-ad0fa498f863/130`** in the **starter** repo, off `next`, committed and pushed to origin — the first spike died with the local worktree that held it, and a pushed branch cannot. Never merge it into `next` or `main`: it is spike code, not production code.
- **Running the gates** needs only `npm ci` in a starter checkout on that branch; everything below is local. Nothing is deployed.
- **Code:** `src/spike/`:
  - `agent.ts`: `SpikeReactive extends Think`;
  - `child.ts`: `SpikeGeneral`;
  - `tasks.ts`: the guarded ledger;
  - `outcome.ts`;
  - `fake-model.ts`;
  - `tools.ts`;
  - `worker.ts`: the tenant is mounted by hand, and `/spike/debug/*` routes are gated on `SPIKE_DEBUG_TOKEN`;
  - `env.ts`.
- **Config:** `wrangler.spike.jsonc`, the Worker `da-think-spike`. It is a Worker of its own — a different `main`, different Durable Objects, its own migration tag — which is why `vitest.config.ts` excludes `test/spike/**` and why the spike's classes can never reach the real deployment's tags.
- **Tests:** `vitest.spike.config.ts` + `test/spike/spike.spec.ts`. They run through core's real A2A harness, with `SPIKE_FAKE_MODEL=1`. Every scenario goes in as a gatekeeper-signed `SendMessage` and comes out as a push callback; the object is read only for what a callback cannot carry.
- **Tooling and the deployed Worker are gone.** The `spike/` directory — `devctl.sh`, the local `gatekeeper.mjs` push sink, `inspect.sh`, `FINDINGS.md` — and the deployed `da-think-spike` belonged to the worktree the spike was first written in, and did not survive it. What replaces them is the local suite: the deployed run is waived (below), and `wrangler dev` plus `/spike/debug/*` are still there if a later phase wants them.

## Build G10 into the spike

Mirror what Phase 1 will put in core (`THINK-PHASE-1-CORE.md`), so the spike exercises that design.

1. **Lifecycle.** Call `await this.__unsafe_ensureInitialized()` at the top of every RPC method that `worker.ts` or core's executor calls. A raw RPC does not start Think's lifecycle.
2. **Work ledger.** In `tasks.ts`, add `spike_a2a_work(work_id PK, task_id, kind, schedule_id, open, created_at)`:
   - `kind` is `detached` or `wait`;
   - add `addWork`, `closeWork` (guarded: only while `open = 1`; returns whether it closed), `openWork(taskId)` and `taskOfWork(workId)`.
3. **Detached tool.** In `agent.ts`, add a `general_long` tool:
   - `execute: async ({ task }, { toolCallId })`:
     - set `runId = "detached:" + toolCallId`;
     - record the work first;
     - then `const r = await this.runAgentTool(SpikeGeneral, { input: { task }, runId, parentToolCallId: toolCallId, detached: { onFinish: "onSubAgentFinish" } })`;
     - return `{ started: runId }` only when `r.status === "running"`.
     - A dispatch rejected synchronously (`r.status === "error"`, for example over the concurrency cap) wires no `onFinish`. So close the work and return the error to the model; otherwise the task would stay `working` forever.
   - The description tells the model that the result arrives in a later turn.
4. **`onSubAgentFinish(run, result)`:**
   - ignore `result.status === "interrupted" && result.childStillRunning`;
   - ignore a run whose task is terminal;
   - `closeWork(run.runId)`;
   - then `runTurn({ mode: "submit", input: { id: "finish:" + runId, role: "user", parts: [{ type: "text", text: this.formatDetachedCompletion(run, result) }], metadata: { turnMetadata: { taskId, contextId } } }, idempotencyKey: "finish:" + runId, metadata: { taskId } })`.
5. **`check_back` tool** (`{ seconds, why }`):
   - `const s = await this.schedule(seconds, "onCheckBack", { taskId, workId, seconds, why })`;
   - record the work with `schedule_id = s.id`;
   - `beforeTurn` returns `{ stopWhen: hasToolCall("check_back") }`.
   - `onCheckBack` closes the work, then submits a follow-up turn the same way, with the text `Waited <seconds>s: <why>`.
6. **Settlement.** In `onSubmissionStatus` `completed`, check in this order:
   1. `ask_user` pending → park;
   2. **open work** → push the turn's text as `working` and leave the task open;
   3. otherwise settle `completed`.

   Read the turn with `await this.getMessages()`, not `this.messages`.
7. **Cancel.** `cancelTask` also calls `cancelAgentTool(runId)` for open detached work and `cancelSchedule(schedule_id)` for open waits, then closes them.
8. **`onProgress` for detached runs** finds the task through `taskOfWork(run.runId)`, because no turn is active.
   - `onProgress` is best-effort and not replayed after an eviction. So `onSubAgentFinish` also replays the child's persisted milestones (`inspectAgentToolRun(runId).milestones`, read through the child's stub) through `transcribeNote`.
   - That replay is idempotent: Artifacts dedupes on the note key.
9. **Delivery record.** In `deliverTask`, before posting, record `(task_id, state, at)` in `spike_deliveries`. On the deployed Worker there is no reachable push sink, so this table is the evidence. Expose it on `/spike/debug/inspect`.
10. **Fake-model rules** in `fake-model.ts`:
    - `bgdelegate:<task>` → text `Started in the background.` + a `general_long` call;
    - `bgdelegate2:<a>|<b>` → two `general_long` calls in one step;
    - `checkback:<s>` → a `check_back` call with `{ seconds: s, why: "spike" }`.
    - Follow-up turns fall through to the existing `echo:` rule.

## Local checks (vitest, `npx vitest run -c vitest.spike.config.ts`)

- `bgdelegate:sleep:2`:
  - pushes `working` "Started in the background.";
  - pushes the first turn's text as `working`;
  - then exactly one `completed`, whose text contains `Background task "SpikeGeneral"` and `child did: sleep:2`.
- `bgdelegate:sleep:20`, cancel while the child runs:
  - the task ends `canceled`;
  - the agent-tool run is not `completed`;
  - no `completed` or `failed` callback.
- `bgdelegate2:sleep:1|sleep:3`: the task settles only after both children have reported.
- `checkback:2`: the turn ends at once, and the task completes after the wake.
- The existing 8 specs still pass. Then run `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p test/tsconfig.json`, and `npx eslint src/spike test/spike`, and starter's own `npm run check`.

**These are G10's acceptance evidence.** The suite is twelve specs — the A2A lifecycle, then the four scenarios above — and all of them pass, alongside starter's `npm test` and `npm run check`.

## The deployed G10 run — waived

The owner waived it. The local checks above stand in: they drive the same paths through core's real A2A edge — detached dispatch, the work ledger holding the task `working` while the parent turn ends, settlement deferred until every run has reported, cancel reaching the child, the scheduled wake, the milestone replay — with seconds where a deployed run would have slept for sixteen minutes.

What seconds cannot show is a real turn boundary being crossed. That claim rests on G3, G4 and G5 in `THINK-FINDINGS.md`: a turn is interrupted and recovered, an awaited child does not survive the interruption, and a detached run's `onFinish` is delivered durably across one. Detached delegation is the design those facts force, and the local checks prove it is wired the way Phase 1 will port.

The scenarios a deployed run would have driven are kept below, for a later phase that wants them once core is on Think. They need a redeploy with the fake model, driven with:
```
curl -X POST "$U/spike/debug/accept?token=$T&name=g10-a" -d '{"text":"…","pushUrl":"https://push.invalid/a2a/push"}'
```
Poll `/spike/debug/task?taskId=…` and `/spike/debug/inspect?name=…` about once a minute. A Monitor with an until-loop works well. Each scenario uses its own `name`, so each gets its own Durable Object.

| Scenario | Pass when |
| --- | --- |
| `bgdelegate:sleep:960` | The first submission completes within seconds, and the task stays `working`. At about 16 minutes the task becomes `completed`, with the child's result in the reply. `spike_deliveries` holds one terminal state. |
| `bgdelegate:sleep:960`, cancel at about 5 min | The task is `canceled`, the run row is not `completed`, and no later `completed` is recorded |
| `checkback:960` | The task stays `working`, then completes after the wake at about 16 minutes |

## It passed

G10's row and Phase 0's status in `THINK-FINDINGS.md` are updated, and Phase 1 can start.

`spike/FINDINGS.md` and the deployed `da-think-spike` are gone with the worktree that held them, so neither the G10 write-up that step asked for nor the delete-the-Worker question has anywhere to land. Nothing is deployed and nothing is billing.
