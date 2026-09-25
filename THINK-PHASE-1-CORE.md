# Phase 1: core on Think

Read `THINK-FINDINGS.md` first: decisions, verified Think facts, the old→new map, and the working rules. Then read `core/AGENTS.md`.

**Needs:** G10 passing (`THINK-PHASE-0-SPIKE.md`).

**Produces:** one PR into core `main` that replaces the harness with Think. Plugins (Phase 2) and starter (Phase 3) consume it by git ref before it merges.

## Setup

```
git -C ~/dev/dynamicagents/dev-agents/core fetch origin
git -C ~/dev/dynamicagents/dev-agents/core worktree add ~/dev/dynamicagents/worktrees/think/core -b feat/think origin/main
cd ~/dev/dynamicagents/worktrees/think/core && npm ci
npm install --save-dev @cloudflare/think@0.19.0
```

Also add Think as a peer: `"@cloudflare/think": ">=0.19.0 <0.20.0"`, with a ceiling like `agents`, because it is experimental. Keep `verify:peer-ranges` green. Do not bump `version`.

The spike (`~/dev/dynamicagents/worktrees/think/starter/src/spike/`) is a working reference for most of this: `agent.ts`, `tasks.ts`, `outcome.ts`, `child.ts`, `fake-model.ts`. Port what it proved; don't re-derive it.

## Delete

- `src/round/`, `src/subtasks/`, `src/subagent/`, `src/host/`, `src/db/`, together with:
  - `drizzle-orm`;
  - `drizzle-kit`;
  - `drizzle.config.ts`;
  - `scripts/build-migrations.mjs`;
  - the `db:generate` script.
- `src/config.ts`, `src/platform.ts`, and their specs.
- `src/runtime/bound-tools.ts`, `src/runtime/tool-families.ts`, `src/runtime/fail.ts`.
- `src/contract/recipe.ts`, `src/contract/validation.ts`.
- From `src/agent/`:
  - `budget`, `control`, `final-reply`, `ask-user`, `check-back`, `window`, `session`, `tool-input`, `history`;
  - `fallback`, `model`, `inference`;
  - `errors`' `CredentialRejectedError`.
  - `gateway-log` and `workers-ai/` move to `/model`; see below.
- `src/testing/fake-session.ts`.
- `src/a2a/deliver.ts`: it takes a `WorkflowStep`; the outbox below replaces it.
- In `src/a2a/hitl.ts`: `humanEventType`, `TurnWake`, and the round-based `humanRequestId`.
- In `src/a2a/executor.ts`: `workflowIdForMessage`, `ignoreAlreadyExists`, `TurnResumer`.
- In `src/worker/index.ts`: `wakeAnswered`, `wakeCanceled`, and the `resumeTurn` plumbing.
- `src/alarm/` and `src/job/`. Their only user is plugins' workspace object, which absorbs them in Phase 2 by copying them from core `main`.
- `FINGERPRINT_VERSION`, and everything that reads it.

Remove the deleted subpaths from `package.json` `exports`. The new set is:
- root: contract, env slices, `withAbort`;
- `/think`, `/model`, `/a2a`, `/worker`, `/artifacts`;
- `/testing`, `/testing/node`, `/testing/fixtures`, `/testing/vcr-global-setup`;
- `/eslint`.

## Keep, untouched in substance

- `src/a2a/verify.ts`. **Never weaken it**; see `core/AGENTS.md`.
- The rest of `src/a2a/`: card, JWKS, notify builders, `createPushChannel`, `parts`, `task`, `caller`, `SelfOrigin`, `signCallerToken`, `task-store`.
- `src/artifacts/` (`transcribeNote`, `settleTranscript`, `assertArtifactsBound`, the object and viewer).
- `src/env.ts`, `src/abort.ts`.
- `src/testing/` VCR, fixtures, auth, harness.

## Add

### `src/think/agent.ts`: `A2AAgent<Env> extends Think<Env>`

The per-caller Durable Object, keyed by the gatekeeper `identity.key`. It replaces `DynamicAgent` and `RoundAgentBase`.

- **Class fields.**
  - `static options = { agentToolReattachNoProgressTimeoutMs: Infinity }`.
  - `maxSteps = Infinity`.
  - `chatRecovery = { maxRecoveryWork: Infinity }`.
  - `contextOverflow = { reactive: true }`.
  - `classifyChatError = defaultContextOverflowClassifier`.
  - `submissionRecoveryStaleMs` is **not** touched.
- **Abstract** (starter supplies these; core ships no numbers and no copy):
  - `getModel()`;
  - `copy: { failed, emptyReply, questionExpired }`;
  - `compactAfterTokens`, `keepRecentTokens`.
- **`getPlugins(): AgentPlugin<Env>[]`** and **`getSubAgents(): SubAgentClass[]`**, both defaulting to `[]`.
- **`configureSession(session)`:** `session.onCompaction(createCompactFunction({ summarize: (p) => generateText({ model: this.getModel(), prompt: p }).then((r) => r.text), keepRecentTokens })).compactAfter(compactAfterTokens)`.
- **`configureContext()`:** the plugins' blocks (a label is namespaced by the plugin name), plus a read-only `caller` block from `this.getConfig()`, set on `acceptTask` from `callerContext(identity)`. Starter overrides it as `[soul, memory, ...super.configureContext()]`.
- **`getTools()`:**
  - the plugins' tools;
  - a `subAgentTool` per child;
  - `ask_user`;
  - `search_history` (`this.session.search(query, { limit })`).
  - Starter adds `check_back: this.checkBackTool()` where it is wanted.
- **`getActions()`:** the plugins' actions.
- **`beforeTurn`:** `stopWhen: [hasToolCall("ask_user"), hasToolCall("check_back")]`, and `maxOutputTokens` if starter sets it.
- **`onChunk`:** buffer `text-delta`. On the step's first `tool-call` chunk, push the buffered text as `working` for the active task, so it lands before the tool runs. Reset in `onStepEnd`.
- **`repairInterruptedToolPart(part)`:** a `tool-ask_user` part becomes `{ type: "text", text: <the question> }`; everything else defers to `super`.
- **`onSubmissionStatus(s)`:** see *Settlement* below.
- **`onProgress(run, p)`:** the live fast path for transcript notes.
  - A milestone `note` → `transcribeNote(env, { taskId, origin, source: { type: run.agentType, ordinal: run.displayOrder }, text: p.message, key: p.data.key }, post)`.
  - It is best-effort, and not replayed after an eviction. So both finish paths (`onAgentToolFinish` for awaited runs, `onSubAgentFinish` for detached ones) also call `replayNotes(run)`.
- **`replayNotes(run)`:**
  - reads the child's persisted milestones: `(await this.dynamicAgents.get(Cls, run.runId)).inspectAgentToolRun(run.runId)`, then `.milestones`;
  - passes every `note` through the same `transcribeNote`.
  - Artifacts dedupes on the note key, so a replay never double-writes. Notes land before the task settles its transcript.
  - The task comes from `da_a2a_work` by `run.runId`, since a detached run reports with no active turn.
- **`onAgentToolFinish(run, result)`:** `replayNotes(run)`, then call the spec's `settle`, for both modes.
- **`onSubAgentFinish(run, result)`:** the `onFinish` target of every detached run.
  - Ignore a soft `interrupted` (`childStillRunning`).
  - Ignore a run whose task is already terminal.
  - Otherwise `closeWork(runId)` (guarded), `replayNotes(run)`, then submit a follow-up turn:
    ```
    runTurn({ mode: "submit",
      input: userMessage("finish:" + runId, this.formatDetachedCompletion(run, result), { turnMetadata: { taskId, contextId } }),
      idempotencyKey: "finish:" + runId, metadata: { taskId } })
    ```
- **`checkBackTool()`:** `{ seconds (≥ 10, ≤ 3600), why }` →
  - `const s = await this.schedule(seconds, "onCheckBack", { taskId, workId, seconds, why })`;
  - `addWork(workId, taskId, "wait", s.id)`;
  - return.

  The turn ends on the `stopWhen`. `onCheckBack` closes the work, then submits a follow-up turn the same way.
- **`onChatRecovery(ctx)`:** `{ continue: false }` when the task is canceled.
- **`getScheduledTasks()`:** `{ a2aRetention: { schedule: "every week on sunday at 01:00 in UTC", handler } }`. The handler:
  - deletes task and work rows older than 30 days;
  - calls `deleteSubmissions({ completedBefore })` in a loop, because it caps at 500 per call;
  - calls `clearAgentToolRuns({ olderThan })`.
- **`onStart`:**
  - `assertArtifactsBound(this.env)`;
  - sweep ledger rows that are `pending_delivery` into the outbox.
- **Hooks for subclasses:** `onTaskCanceled(taskId)` and `onTaskSettled(taskId, state)`. Both are no-ops by default, and keyed on the guarded write's verdict.
- **Identity helpers:**
  - `callerKey() = this.name`;
  - `selfOrigin()` / `requireSelfOrigin()`, pinned from the first accepted turn's `jku` (`SelfOrigin`);
  - `pluginContext()`.
- **RPC methods** called by core's executor and task store: `acceptTask`, `getTask`, `listTasks`, `saveTask`, `cancelTask`, `answerTask`.
  - **Each starts the lifecycle first**, through one small core helper that wraps the internal `__unsafe_ensureInitialized()`, so the internal name has one home.

### `src/think/tasks.ts`: `A2ATasks`, held as `this.ledger`

Not `this.tasks`: `Agent` already has `this.tasks`. It uses `this.ctx.storage.sql`, with idempotent `CREATE TABLE IF NOT EXISTS`.

- **`da_a2a_tasks`:**
  - `task_id` PK and `message_id` UNIQUE;
  - `context_id`, `state`, `task_json`, `text`;
  - `push_json` (url, token, `jku`), `identity_json`;
  - `submission_id`, `request_json` (the pending question), `pending_delivery`;
  - timestamps.
- **Guarded writes, ported one for one from `src/db/models/tasks.ts`:**
  - Every transition is `UPDATE … WHERE state IN (…)`, and its `rowsWritten` is the verdict.
  - Nothing overwrites `canceled`.
  - `markWorking` returns `"ok" | "canceled"`.
  - There is exactly one terminal transition.
  - `settle` sets `pending_delivery` in the same statement.
- **`da_a2a_work`:**
  - `work_id` PK, `task_id`;
  - `kind` (`awaited | detached | wait`), `name`, `schedule_id`, `open`, `created_at`.
  - Every sub-agent run is recorded; only `detached` and `wait` rows keep a task open.
  - Methods: `addWork`, `closeWork` (guarded; returns whether it closed), `openWork(taskId)`, `taskOfWork(workId)`.

### Intake, answer, cancel, settlement, delivery

```ts
async acceptTask(turn: AcceptedTurn): Promise<PlainTask> {   // replaces beginTask + Workflow create
  await ensureStarted(this);
  const row = this.ledger.accept(turn);                      // INSERT OR IGNORE on message_id; stores push + identity
  if (row.state !== SUBMITTED || row.submissionId) return row.task;
  this.configure({ caller: callerContext(turn.identity) });
  const s = await this.runTurn({ mode: "submit",
    input: userMessage(turn.messageId, turn.text, { turnMetadata: { taskId: row.taskId, contextId: row.contextId } }),
    idempotencyKey: turn.messageId, metadata: { taskId: row.taskId } });
  this.ledger.bindSubmission(row.taskId, s.submissionId);
  return row.task;
}
```

- **`answerTask({ taskId, messageId, reply })`:**
  - Refused unless the task is input-required and `reply.requestId` matches the stored question.
  - A timeout is settled from the queue (`queue("expireTask", …)`) as failed with `copy.questionExpired`, not inline. Failing it inside the call makes the SDK refuse the very message that reports it.
  - Otherwise flip to `working`, then submit the answer as a user message: `idempotencyKey: "answer:" + messageId`, same `turnMetadata`.
  - Return the task (`PlainTask | null`); there is no wake any more.
- **`cancelTask(taskId)`:** do the guarded flip first. Then:
  - `cancelSubmission`, plus `abortAllRequests()` if this task is the running one;
  - `cancelAgentTool(runId)` for open detached work;
  - `cancelSchedule` for open waits;
  - close the work;
  - `settleTranscript`, then `onTaskCanceled`.
- **Settlement (`onSubmissionStatus`).** Key on `s.metadata.taskId`, and ignore submissions without one.
  - `running`: if `markWorking` returns `"canceled"`, call `cancelSubmission`.
  - `completed`: read the turn with `await this.getMessages()`. The turn is every assistant message after the task's latest user message. Then, in order:
    1. a pending `tool-ask_user` part → `park` with `HitlRequestData` (`requestKind: "choice"`, `requestId: <taskId>:<toolCallId>`, options, `allowFreeform: true`), and deliver the input-required task;
    2. `openWork(taskId) > 0` → push the turn's text as `working` and stay open;
    3. otherwise, the text after the last tool part → `buildCompletedTask`, or `copy.emptyReply` if that is empty.
  - `error` / `skipped`: `buildFailedTask(copy.failed)`.
  - `aborted`: a guarded no-op.
- **`finish(row, task)`:**
  - `ledger.settle` (the guarded write; it also sets `pending_delivery`);
  - then `queue("deliverTask", { taskId, task }, { id: "deliver:" + taskId + ":" + state, retry: { maxAttempts: 8, baseDelayMs: 2_000, maxDelayMs: 300_000 } })`;
  - then `settleTranscript` and `onTaskSettled`.
- **`deliverTask`:** `createPushChannel(A2A_SIGNING_KEY, push).deliver(task)`, which throws on non-2xx so the queue retries; then clear `pending_delivery`. Input-required uses the same outbox.

### `src/think/sub-agent.ts`: `SubAgent`, `SubAgentSpec`, `subAgentTool`

```ts
interface SubAgentSpec<I> {
  name: string; description: string; inputSchema: FlexibleSchema<I>; soul: string;
  detached?: boolean;                 // may run past 15 min → detached
  formatInput?(input: I): string;
  prepare?(c: { input: I; taskId: string; runId: string; parent: PluginContext }): Promise<Record<string, unknown>>; // was resolveRuntime
  settle?(c: { runId: string; runtime?: Record<string, unknown>; result: AgentToolLifecycleResult }): Promise<void>; // was onAbort/onFail/onSettled
}
```

- **`subAgentTool(host, Cls)`**, an AI SDK `tool()` whose `execute(input, { toolCallId, abortSignal })`:
  1. takes `taskId` from `host.activeTurnMetadata`;
  2. sets `runtime = await spec.prepare?.(…)`;
  3. records the work (`awaited` or `detached`);
  4. then:
     - **awaited:** `host.runAgentTool(Cls, { input: { input, taskId, runtime }, runId: "agent-tool:" + toolCallId, parentToolCallId: toolCallId, signal: abortSignal })`, returning the same envelope `agentTool` returns (the summary, or an `AgentToolFailure`);
     - **detached:** the same, with `detached: { onFinish: "onSubAgentFinish" }` and no `signal`.
       - Return `{ started: runId }` only when the dispatch result's `status` is `"running"`.
       - A dispatch rejected synchronously (`status: "error"`) wires no `onFinish`. So close the work and return the error to the model; otherwise the task would stay `working` forever.
       - The description tells the model that the result arrives in a later turn.
       - No `maxBudgetMs` or `noProgressBudgetMs` is set: Think's backstops sit above the gatekeeper's hour.
- **`SubAgent<Env> extends Think<Env>`:**
  - `static spec: SubAgentSpec`;
  - `maxSteps = Infinity`;
  - `chatRecovery = { maxRecoveryWork: Infinity }`;
  - `contextOverflow = { reactive: true }`;
  - `classifyChatError = defaultContextOverflowClassifier`;
  - abstract `getModel()`, and `getPlugins()`;
  - `configureContext()`: a `soul` block from `spec.soul`, plus the plugins' blocks;
  - `getTools()` / `getActions()`: the plugins';
  - `formatAgentToolInput(envelope)`: a user message with `spec.formatInput?.(input) ?? JSON`, stamped with `turnMetadata: { taskId, runtime }`;
  - `onChunk`: the same buffer-and-flush as the parent, but flushing `reportProgress({ milestone: "note", message, data: { key: this.name + ":" + seq } }, { persist: true })`.

### `src/model/`

- `workersAIModel(env, { modelId, gatewayId?, reasoningEffort?, metadata?, sessionAffinity? }): LanguageModel`: `createWorkersAI({ binding: env.AI })(modelId, { gateway: { id, metadata, eventId }, sessionAffinity, reasoning_effort })`.
- `gatewayLogFields`, moved from `src/agent/gateway-log.ts`. `getModel()` calls it per turn, with `taskId` from `activeTurnMetadata`.
- One model. There is no fallback.

### `src/contract/plugin.ts`, v3

```ts
export const PLUGIN_CONTRACT_VERSION = 3;
interface PluginContext<Env> {
  env: Env; storage: DurableObjectStorage; agentName: string; callerKey(): string;
  workspace(): WorkspaceLike; runtime(): Record<string, unknown> | undefined; // SubAgent: from turnMetadata
}
interface AgentPlugin<Env = Cloudflare.Env> {
  name: string; contractVersion: number;
  tools?(ctx: PluginContext<Env>): ToolSet;              // sync: Think's getTools() is
  actions?(ctx: PluginContext<Env>): Record<string, Action>;
  context?: ContextConfig[];                             // was `capability`
  workspace?(ctx: PluginContext<Env>): WorkspaceLike;    // at most one plugin; replaces workspaceBacking
  requires?: { secrets?: readonly string[]; bindings?: readonly string[] };
}
```

- `definePlugin` stamps `contractVersion`.
- A slimmed plugin assembly (from `src/runtime/index.ts`) checks at DO start:
  - a duplicate plugin name;
  - a contract-version mismatch, as a sentence naming the plugin;
  - more than one `workspace`;
  - a missing required secret or binding.
- `restrictTools(plugin, allow)` replaces `restrictMainAgentTools`.
- Do not add hook fields until a plugin needs one. When one does, mirror Think's extension hook names.

### Worker and executor

- `defineAgent({ tenant, manifest, agent })`: the `workflow` option is gone.
- `resolveAgent` → `ns.get(ns.idFromName(identity.key))`, refusing a keyless caller.
- `startTurn` is gone. `A2AExecutor.execute` makes one `stub.acceptTask(turn)` call and publishes the returned task.
- `TaskAgent` becomes `acceptTask`, `getTask`, `saveTask`, `cancelTask`, `listTasks?`, and `answerTask(): Promise<PlainTask | null>`.
- A continuation (a reply on an existing task) is accepted for every agent, and `recordReply` calls `answerTask`.
- Pass `DefaultRequestHandler` a no-op push sender as its 6th constructor argument. Otherwise the SDK pushes the accepted task itself, read at send time, and a fast turn duplicates the terminal callback. Core owns delivery.

### Testing (`src/testing/`)

- `mockModel` gains `doStream`, via `simulateReadableStream`. Its steps are `reply(text)`, `call(name, input)` and `askUser(question, options)`. The spike's `fake-model.ts` shows the stream parts.
- `createAgentHarness` gains `waitForTerminal(taskId)`.
- `makeDoHelpers` drops `withDb`, or rebases it on the ledger.
- `test/worker.ts` and `wrangler.jsonc` (dev-only) bind a `TestAgent`, and a `TestChild` facet as a test-only binding in `vitest.config.ts`.

### Docs

Rewrite `README.md` and `AGENTS.md` for the new shape:
- Delete the platform bounds, migration journal and fingerprint sections.
- "The line core does not cross" becomes: core owns the A2A↔Think lifecycle, guarded writes and delivery, and ships no prompt copy.
- "Model providers" becomes: a provider returns one `LanguageModel` for `getModel()`.
- The contract section describes v3.

Keep the zero-trust and VCR sections. Follow the comment rules.

## Verify

- `npm run types` if wrangler moved, then `npm run check && npm test`.
- Port every invariant from `src/db/db.spec.ts` to `tasks.spec.ts`.
- `agent.spec.ts` covers:
  - accept → exactly one terminal callback (count distinct status message ids);
  - a redelivered `messageId` → one turn;
  - cancel racing completion;
  - the `ask_user` round trip, plus a timeout and a foreign `requestId`;
  - error → failed;
  - a child milestone → exactly one Artifacts entry, including when `onProgress` was missed and `replayNotes` delivers it;
  - a detached dispatch rejected synchronously → the work closes, the model sees the error, and the task still settles;
  - parent abort → the awaited child is aborted;
  - detached: dispatch → `working` → `onFinish` → follow-up → one `completed`;
  - detached: a soft `interrupted` then `completed` delivers once;
  - detached: cancel mid-run → `canceled`, with the late `onFinish` ignored;
  - two detached runs → the task settles only after both;
  - `check_back` → the turn ends, the wake fires, and the task settles;
  - an RPC on a cold object works (lifecycle started).
- `harness.spec.ts` passes.
- `npm run verify:exports` passes.

## Hand-over

1. Commit to `feat/think` and push.
2. Open a PR into core `main`. Say it is breaking (contract v3) and that plugins and starter follow.
3. Answer Copilot's one review in one pass.
4. Do not merge. Tell the user that Phase 2 can start against `feat/think`.
