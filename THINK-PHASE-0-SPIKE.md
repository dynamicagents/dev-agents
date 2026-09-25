# Phase 0: spike (G10 open)

Read `THINK-FINDINGS.md` first. It has the decisions, the verified Think facts, and the results of gates G1–G9.

**What is left:** one gate, G10. It proves that detached delegation works end to end before Phase 1 builds it into core:
- a sub-agent running longer than 15 minutes is dispatched with `runAgentTool({ detached: { onFinish } })`;
- the A2A task stays `working`;
- a follow-up turn settles it with the child's result.

If G10 fails, stop and report. Do not start Phase 1.

## Where the spike is

- **Worktree:** `~/dev/dynamicagents/worktrees/think/starter`, branch `spike/think`, off starter `next`.
  - It is **uncommitted**. Commit it locally to `spike/think` before you change anything.
  - Never push or merge it: it is throwaway.
- **Code:** `src/spike/`:
  - `agent.ts`: `SpikeReactive extends Think`;
  - `child.ts`: `SpikeGeneral`;
  - `tasks.ts`: the guarded ledger;
  - `outcome.ts`;
  - `fake-model.ts`;
  - `tools.ts`;
  - `worker.ts`: the tenant is mounted by hand, and `/spike/debug/*` routes are gated on `SPIKE_DEBUG_TOKEN`;
  - `env.ts`.
- **Config:** `wrangler.spike.jsonc`, the Worker `da-think-spike`.
- **Tests:** `vitest.spike.config.ts` + `test/spike/spike.spec.ts`. They run through core's real A2A harness, with `SPIKE_FAKE_MODEL=1`.
- **Tools:** `spike/`:
  - `devctl.sh start|kill|restart`: `wrangler dev` with state in `spike/.state`, where `kill` is SIGKILL;
  - `gatekeeper.mjs`: a push sink on `:8788`. With `DEBUG=1` its `send`/`answer`/`cancel`/`get` go through the debug routes, because core's allowlist is https-only and a local gatekeeper can never pass it;
  - `inspect.sh`;
  - `FINDINGS.md`: the detailed G1–G9 notes.
- **Deployed:** `https://da-think-spike.loopingai.workers.dev`, account "Looping AI".
  - It runs the fake model, and its gatekeeper allowlist is `https://gatekeeper.invalid`, so it takes no real traffic.
  - Its secrets, including `SPIKE_DEBUG_TOKEN`, are in `spike/.secrets.env` (gitignored).
  - Redeploying keeps the secrets:
    ```
    npx wrangler deploy -c wrangler.spike.jsonc --var SPIKE_FAKE_MODEL:1
    ```
    Add `--secrets-file spike/.secrets.env` to re-send them.
- **Logs:** the worktree has no `.cf.env`, so run this from the main checkout:
  ```
  cd ~/dev/dynamicagents/dev-agents/starter && node scripts/cf.mjs logs --worker da-think-spike --since 30m
  ```
  `--grep <text>` and `--raw` are available.

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
     - then `await this.runAgentTool(SpikeGeneral, { input: { task }, runId, parentToolCallId: toolCallId, detached: { onFinish: "onSubAgentFinish" } })`;
     - return `{ started: runId }`.
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
- The existing 8 specs still pass. Then run `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p test/tsconfig.json`, and `npx eslint src/spike test/spike`.

## The deployed G10 run

Redeploy with the fake model. Drive it with:
```
curl -X POST "$U/spike/debug/accept?token=$T&name=g10-a" -d '{"text":"…","pushUrl":"https://push.invalid/a2a/push"}'
```
Poll `/spike/debug/task?taskId=…` and `/spike/debug/inspect?name=…` about once a minute. A Monitor with an until-loop works well. Each scenario uses its own `name`, so each gets its own Durable Object.

| Scenario | Pass when |
| --- | --- |
| `bgdelegate:sleep:960` | The first submission completes within seconds, and the task stays `working`. At about 16 minutes the task becomes `completed`, with the child's result in the reply. `spike_deliveries` holds one terminal state. |
| `bgdelegate:sleep:960`, cancel at about 5 min | The task is `canceled`, the run row is not `completed`, and no later `completed` is recorded |
| `checkback:960` | The task stays `working`, then completes after the wake at about 16 minutes |

## When it passes

1. Add G10 to `spike/FINDINGS.md`.
2. In a dev-agents PR, update the G10 row and the Phase 0 status in `THINK-FINDINGS.md`. Phase 1 can start.
3. Ask the user whether to delete the deployed Worker (`npx wrangler delete -c wrangler.spike.jsonc`). Never delete it without asking.
