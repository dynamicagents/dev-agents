# Moving the train onto `@cloudflare/think`: findings and decisions

This is the shared reference for the phase files (`THINK-PHASE-*.md`). Read it before any phase. It holds:
- why the migration is happening;
- the decisions, which are binding;
- the Think facts we verified;
- what the spike proved;
- how the old pieces map onto Think;
- the working rules every phase follows.

Each phase file holds only its own work.

## Why

Core hand-writes an agent harness:
- a Workflow-driven round loop of `generateText` rounds, with control tools, budgets, no-progress and final rounds, and a repair ladder;
- chunked, fingerprinted subagent facets;
- round observations;
- drizzle task and subtask tables.

Plugins and starter are shaped around it.

`@cloudflare/think`'s release that pairs with the `agents` release the train already uses (the exact pin is in Phase 1's install command) ships most of that harness as a maintained framework:
- durable, recoverable turns;
- durable submissions with idempotency and cancel;
- Sessions with non-destructive compaction and FTS;
- context blocks;
- workspace tools;
- agent tools, awaited or detached;
- `reportProgress` and milestones;
- actions with an idempotency ledger;
- context-overflow recovery.

The goal is to delete our harness, follow Think's names and idioms, and keep only what Think lacks:
- the zero-trust A2A edge;
- the A2A task lifecycle and push delivery;
- the transcript link (the Artifacts object);
- container workspaces;
- the repo and Claude Code capabilities.

Where we are ahead of Think, build on its primitives in a shape Think could absorb. Do not build a parallel system.

## Phases

| Phase | File | Repo | Needs | Status |
| --- | --- | --- | --- | --- |
| 0: spike | `THINK-PHASE-0-SPIKE.md` | starter (branch `claude-coder/0ca01723-882c-40ed-8c68-ad0fa498f863/130`) | — | done |
| 1: core | `THINK-PHASE-1-CORE.md` | core | G10 passing | done |
| 2: plugins | `THINK-PHASE-2-PLUGINS.md` | plugins | Phase 1 merged | in review (branch `feat/think`) |
| 3: starter | `THINK-PHASE-3-STARTER.md` | starter | Phase 2 branch, core's sub-agent summary fix | not started |
| 4: follow-ups | `THINK-PHASE-4-FOLLOW-UPS.md` | core, plugins | Phase 3 | not started |

When a phase finishes, update its Status cell in a dev-agents PR.

## Decisions

Binding. Do not reopen them. If a phase proves one wrong, stop and ask.

- **One breaking cut.** Core, then plugins, then starter. There are no dual paths and no opt-in flags, and superseded code is deleted.
- **No arbitrary limits.** The gatekeeper cancels any task that has not settled within 1 h.
  - `maxSteps = Infinity`.
  - `chatRecovery.maxRecoveryWork = Infinity`.
  - Every turn, wall-clock, deferral, chunk, round and subtask budget is deleted.
  - No new caps are added.
- **Concurrency follows Think.** Turns run first in, first out per caller Durable Object. A caller's later message waits for the running turn.
- **Delegation is awaited or detached, nothing in between.**
  - A sub-agent that may run longer than 15 minutes is **detached**: `runAgentTool({ detached: { onFinish } })`. The parent turn ends immediately. The A2A task stays `working` until a follow-up turn, submitted by `onFinish`, answers with the result.
  - Every other sub-agent is **awaited** (`runAgentTool`'s default mode), and must finish within the parent's 15-minute turn.
  - `submissionRecoveryStaleMs` stays at Think's default of 15 minutes. It is never raised.
- **No upstream issues are filed** against Think or agents.
- **No model fallback.** Each agent runs one model.
  - Transient failures are left to the AI SDK's retries and Think's chat recovery.
  - `withFallback`, the model pair, `fallbackChatModelId` and the fallback-steering error classification are deleted.
- **The transcript link stays.** The Artifacts object and its viewer are kept, fed from sub-agent milestones.
- **Fresh start at cutover.** Every agent Durable Object is wiped, history included, through new class names. Workspace DOs, which hold container checkouts, survive.
- **Recall is deleted**, with its Vectorize index. A core `search_history` tool over Think's `session.search()` replaces it. Think's compaction keeps the original rows, so full-text search still finds them.
- **Renames.**

  | Old | New |
  | --- | --- |
  | `DynamicAgent` + `RoundAgentBase` | `A2AAgent` |
  | `RecipeSubagentBase` + `RecipeSubagentHost` | `SubAgent` |
  | plugin `subtaskType` + `recipe` | `SubAgentSpec` |
  | `/agent` (model, fallback, session) | `/model` |
  | `/round` + `/host` | `/agent` (`A2AAgent` and core's tools) |
  | `/subagent` (recipe facets) | `/subagent` (`SubAgent`) |
  | `ReactiveAgent` | `Reactive` |
  | `CfCoderAgent` | `CfCoder` |
  | `ClaudeCoderAgent` | `ClaudeCoder` |

## Verified Think facts

Each of these was checked against the pinned Think and agents releases (Phase 1's install command): their docs, types and `dist/think.js`, or a spike gate where one is named. Re-check any that a bump touches.

- **A turn lives inside one invocation** (G5).
  - It is interrupted after roughly 3–15 minutes, and recovery then continues it.
  - The tool call or awaited child in flight at the interruption is lost. Its tool part is repaired to `output-error`.
  - A submission recovered more than 15 minutes after it started is sealed `error: "Submission was interrupted after messages were applied."` (`submissionRecoveryStaleMs`).
  - So a parent turn, awaited children included, has to finish within 15 minutes.
- **Submissions run inline in a Lifecycle queue job** (`queue/_cfRunSubmission`) on the alarm handler.
  - agents warns: *"Long dispatches starve every other job on this object."*
  - While a turn runs, other queued jobs on that object wait.
- **An awaited child does not survive its parent's restart** (G4).
  - The parent's tool part is repaired to an error. On GLM the continuation then says "interrupted, want me to try again?" and settles the task.
  - The child finishes orphaned.
  - After a parent restart, a silent child is sealed after `agentToolReattachNoProgressTimeoutMs` (120 s). Set it to `Infinity`.
- **Detached runs report back durably.**
  - `onFinish` is a method named on the parent. It is delivered at least once, serialized against the turn queue, and survives eviction and deploys.
  - `interrupted` with `childStillRunning: true` is soft: the hook fires again with the real result.
  - `cancelAgentTool(runId)` cancels a run.
  - `onProgress` fires for detached runs with no active turn. It is best-effort and not replayed after an eviction; persisted milestones are, through the child's `inspectAgentToolRun(runId).milestones`.
  - A detached dispatch can be rejected synchronously (`status: "error"`, for example over the concurrency cap). Then no `onFinish` is wired.
  - Think's built-in `notify: true` cannot carry our task id, so core wires `onFinish` itself.
  - Think's own `formatDetachedCompletion(run, result)` supplies the follow-up text: `Background task "<agentType>" (run <id>) finished:\n\n<summary>`.
- **No custom A2A channel.**
  - `ChannelDefinition.ingress` has no RPC transport.
  - Channel `instructions` are prepended to the system prompt, which breaks the prefix cache.
  - Submissions carry no channel.
- **Per-turn data rides on the message.** Put it in the submitted user message's `metadata.turnMetadata` and read it back as `this.activeTurnMetadata`. A submission's own `metadata` is visible only to `inspectSubmission` and `onSubmissionStatus`.
- **`onSubmissionStatus` is not a delivery channel.** It fires for pending, running, terminal and recovery transitions, often inside the turn slot, and errors there are only logged. Do the guarded write there, then deliver through a durable `this.queue(…, { id, retry })` outbox.
- **A raw DO RPC does not start Think's lifecycle.** `this.session` is undefined until something does. Think's own RPC entry points call the internal `__unsafe_ensureInitialized()` first; ours must too.
- **The synchronous `messages` getter is empty on a cold object.** Read a finished turn with the async `getMessages()`.
- **`getTools()` is synchronous.** `getActions()` may be async. Async tool shaping goes through `beforeTurn` (`tools`, `activeTools`).
- **Hook timing.**
  - `onStepEnd` is current, and `onStepFinish` is deprecated; core's `no-deprecated` lint rejects it.
  - `onStepEnd` fires *after* the step's tools finish.
  - Text meant to land before a tool runs is buffered from `onChunk` `text-delta` and flushed on the step's first `tool-call` chunk, which arrives as the tool starts.
- **`ask_user` works as a server tool with no `execute`.** The turn ends and the submission completes. The next submission is not blocked, and its transcript repair calls `repairInterruptedToolPart`, which turns the dangling call into text. That is Think's documented pattern. `needsApproval` does count as pending, so do not use it on this path.
- **A recovered turn is two or more assistant messages**: the persisted partial, then the continuation. `continueLastTurn` persists the continuation as a separate message, not an append. The reply is every assistant message after the task's user message.
- **A run's summary is its first assistant message with text.** `getAgentToolSummary` reads `_getAgentToolFinalText`, which stops at the first text-bearing message of the run. After a recovery that is the partial. Core's `SubAgent` has to override it to join every assistant message of the run; that fix, core's `fix/sub-agent-summary`, is a Phase 3 prerequisite.
- **Think persists a streaming partial lazily** (G9): 1 of 6 emitted chunks at a kill. A custom model that streams its output as text derives its resume point from the partial Think replays in the prompt, never from a side cursor. A model that streams only its final answer, and records its own progress synchronously (a persisted milestone), may resume from a cursor it stores after each record.
- **The stream-stall watchdog is off.** `chatStreamStallTimeoutMs` defaults to `0`, and core leaves it there, so a model or tool that is silent for a long time is not cut as stalled.
- **Built-in workspace tools are always on.**
  - Only `bash` can be switched off (`workspaceBash = false`).
  - `this.workspace` may be overridden with any `WorkspaceLike`: `readFile`, `readFileBytes`, `writeFile`, `readDir`, `rm`, `glob`, `mkdir`, `stat`, and optionally `writeFileBytes`.
  - Think's `grep` runs `glob("**/*")` and then one `readFile` per file. `find` runs an unbounded `glob` and trims to 200 afterwards.
  - `edit` is a `readFile` then a `writeFile`, two separate calls, so a lock inside a `WorkspaceLike` cannot span one edit. `write` calls `mkdir(parent, { recursive: true })` first.
  - `read` calls `stat`, then `readFileBytes` to sniff the media type unless `stat` names a specific one. A text file is then read with `readFile`; an image or a PDF is sent to the model as its bytes, and other binary files are reported, not read. Its `offset` is a 1-indexed line, and `limit` a count of lines.
  - The built-in tools are merged first, then `getTools()`, then actions: a later tool of the same name replaces an earlier one. So a plugin tool named `bash` or `grep` replaces Think's. Core reserves only its own names (`ask_user`, `search_history`, each sub-agent's).
- **The action ledger.** A keyed action's settled result is replayed for any later call with the same `action:<name>:<key>`, for 30 days (`actionLedgerRetention.settledMs`). So the key names what must happen once, and no more: a key without the task also swallows a legitimate repeat in a later task. A `pending` row left by a dead isolate is re-run after `actionLedgerPendingRetryLeaseMs` (5 minutes), and only for an explicit key. The default timeout is 30 s.
- **`cancelSubmission` misses a recovered continuation turn**, which runs under a new request id. On cancel, also call `abortAllRequests()` when the task is the one running. `onChatRecovery` returns `{ continue: false }` for a canceled task.
- **Think calls `streamText`.** Test models need `doStream`, and Workers AI cassettes become SSE.
- **Context overflow.**
  - Workers AI says `5021: … exceeded this model context window limit (N).`
  - Think's `defaultContextOverflowClassifier` already matches it (G7). No custom classifier is needed.
  - GLM-5.3's window is 1.31M tokens.
- **`think.js` imports eagerly**: just-bash (1.8 MB), `@ai-sdk/openai` + `@ai-sdk/anthropic` (1.1 MB), the MCP client, yaml, acorn and the chat SDK.
  - A one-agent Worker is 8.7 MB raw / 1.7 MB gzip, against 5.6 / 1.1 MB for today's whole three-agent Worker. Startup is 103 ms (G6).
  - `verify:isolation`'s `@cloudflare/shell` bans become unsatisfiable.
- **`this.tasks` is taken.** Every `Agent` has `this.tasks`, the agents SDK's Tasks capability.
- **`@a2a-js/sdk`'s `DefaultRequestHandler` pushes the accepted task itself**, fire-and-forget, reading it at send time. A fast Think turn makes it re-send the terminal snapshot. Core must give the handler a no-op push sender. This is latent in core today.
- **Core's gatekeeper allowlist is https-only** (`normalizeGatekeeperOrigins`), which is correct. A local http gatekeeper can never be trusted, so local end-to-end runs drive the agent below the edge.
- **`agents/ai-chat-agent` is an empty stub.** `AIChatAgent` lives in `@cloudflare/ai-chat`, and nothing here uses it.

## Spike results (Phase 0)

The spike puts the reactive agent on Think behind core's unchanged A2A edge. It
lives on branch `claude-coder/0ca01723-882c-40ed-8c68-ad0fa498f863/130` in the
**starter** repo, in `src/spike/`, `test/spike/`, `vitest.spike.config.ts` and
`wrangler.spike.jsonc`; `THINK-PHASE-0-SPIKE.md` says how to run it. The `spike/FINDINGS.md` that held
the G1–G9 notes did not survive the worktree it was written in — what those gates
established is the **Verified Think facts** above, and nothing else cites it.

| Gate | Result |
| --- | --- |
| G1: GLM-5.3 over `streamText` | Pass: plain replies, parallel tool calls in one step, `ask_user` with options. Caveat: once, GLM announced a step and ended the turn without calling the tool. Nothing catches that now that `final_reply` / `toolChoice: "required"` are gone. |
| G2: A2A lifecycle | Pass, 8/8 specs through core's harness: accept, a redelivered `messageId`, ask/answer, a foreign `requestId`, timeout, cancel mid-turn |
| G3: `kill -9` mid-tool | Pass: recovered within about 1 s, and exactly one terminal callback |
| G4: awaited child across a parent restart | Fail as designed; see the facts above |
| G5: turns over 15 minutes | Fail as designed; see the facts above |
| G6: size and startup | Go, with the ceilings re-baselined |
| G7: context overflow | Pass |
| G8: Think file tools over a container workspace | Pass, in Phase 2, on local workerd against the plugins' test workspace object: 1,200 source files and a `.git` of 3,000 loose objects. Think's `read`, `write`, `edit` and `delete` through `computerWorkspace` take 2–8 ms a call, and Think's `find` about 3 ms, so the `sb_*` file tools stay deleted and `/computer` leaves `find` and `list` to Think. `/computer`'s `grep` takes about 70 ms on the source, but about 2.8 s from a checkout's root with no `include`, because the store's grep cannot prune `.git`; Think's own `grep` takes about 1.1 s there |
| G9: resumable custom model (the Claude Code shape) | Pass, with the resume-from-transcript constraint |
| G10: detached delegation | Pass, on the local gates in `THINK-PHASE-0-SPIKE.md`: detached dispatch, the guarded work ledger holding the task `working` across turns, settlement deferred until every run has reported, cancel reaching the child, a scheduled wake, and milestone replay — all through core's real A2A edge. That a task may outlive fifteen minutes rests on G3, G4 and G5, not on a long deployed run: the deployed scenarios were waived |

## How the old pieces map onto Think

| Today | After |
| --- | --- |
| `DynamicAgent` + `RoundAgentBase` | `A2AAgent<Env> extends Think<Env>` (core `/agent`) |
| Workflows + `runHandleTask` | `acceptTask` → `runTurn({ mode: "submit", idempotencyKey: messageId })` |
| `final_reply`, round contract, `RoundPolicy` | Think's natural ending: a turn ends when the model stops calling tools. User-facing copy moves to `starter/src/copy.ts` |
| `delegate`, subtasks, decomposition, `[ref N]` | One `SubAgent` class per sub-agent, exposed through `subAgentTool`. `SubAgentSpec.detached` picks the mode |
| The Workflow waiting on subtasks across rounds | A task spans turns: it stays `working` while it has open work (detached runs, scheduled wakes) |
| `RecipeSubagentBase`/`Host`, chunks, fingerprint, `run_state` | `SubAgent<Env> extends Think<Env>` (core `/subagent`); Think's recovery does the resuming |
| `round_observations`, window elision | Think persists tool parts; compaction and `contextOverflow` handle size |
| `ask_user` + the Workflow's `waitForEvent` | `ask_user` with no `execute` → input-required → the answer is submitted as a user message → `repairInterruptedToolPart` |
| `check_back` + deferral budgets | `checkBackTool()`: `this.schedule()` a wake and end the turn. The wake submits a follow-up turn |
| `human_requests`, approval exchanges | The question lives on the task row. Approval-kind HITL is Phase 4 |
| drizzle `AgentDB`, migrations, `/db` | `A2ATasks`, held as `this.ledger`: `this.sql` with idempotent DDL, tables `da_a2a_tasks` and `da_a2a_work` |
| Weekly cleanup cron | A `getScheduledTasks()` handler |
| `buildAgentSession` | `configureContext()` (soul, memory, plugin blocks, caller) and `configureSession()` (`createCompactFunction`) |
| `CoreConfig`, `resolveConfig`, `platform.ts` | Deleted. Values are Think class fields and overrides set in starter; core ships no numbers |
| `withFallback`, `ModelPair`, `ModelRuntime`, inference classification | Deleted. `getModel()` returns one model from `workersAIModel()` (`/model`) |
| `boundToolCalls`, `MAX_TOOL_CALL_MS` | Deleted. A tool that can hang owns its timeout |
| Subagent notes → `transcribeNote` | Child `onChunk` → `reportProgress({ milestone: "note", data: { key } }, { persist: true })` → parent `onProgress` → `transcribeNote`. The persisted milestones are replayed when the run finishes, because `onProgress` is best-effort. Each persisted milestone keeps its own sequence, so notes are never merged by name. The transcript is one per task and dedupes on the key, so a note's key leads with its run: core's are `<run>:<tool call>`, and a Claude Code session's `<exec id>:claude:<n>` |
| recall (Vectorize) | `search_history` over `this.session.search()` |
| plugin `workspaceBacking`, `/workspace` | The agent's own `this.workspace`. The v3 contract has no workspace field: an agent that works in a container sets `workspace = computerWorkspace(…)` itself |
| core `/alarm`, `/job` | Moved into `plugins/computer/host` as internals |

## Reference material

- **Think:**
  - docs in `node_modules/@cloudflare/think/docs/`: `index`, `lifecycle-hooks`, `sub-agents`, `programmatic-submissions`, `tools`, `actions`, `workflows`, `client-tools`;
  - types in `dist/index-*.d.ts`;
  - implementation in `dist/think.js`.
  - Any checkout with Think installed has them, the spike branch included.
- **agents:** `node_modules/agents/docs/`: `agent-tools`, `durable-execution`, `sub-agents`, `sessions`, `context`, `tasks`.
- **The spike's reference implementation**, in `src/spike/` on starter's
  `claude-coder/0ca01723-882c-40ed-8c68-ad0fa498f863/130`:
  - `agent.ts`: Think parent, A2A mapping, `onChunk` flush, ask/answer, cancel, delivery outbox;
  - `tasks.ts`: guarded ledger;
  - `outcome.ts`;
  - `child.ts`: agent-tool child with milestones;
  - `fake-model.ts`: rule-based streaming `LanguageModelV3`, plus a resumable one;
  - `worker.ts`: hand-mounted tenant, debug routes.

## Working rules for every phase

The workspace `AGENTS.md` and each repo's `AGENTS.md` are authoritative; this list is the part a phase trips on.

- **Worktrees.** Work in `~/dev/dynamicagents/worktrees/think/{core,plugins,starter}`, one per repo, side by side:
  ```
  git -C <repo> worktree add ~/dev/dynamicagents/worktrees/think/<repo> -b <branch> origin/<main|next>
  ```
  Then `npm ci`. starter's and plugins' `npm run link:local` resolve their siblings by that layout.
- **No version bumps.** core and plugins keep their `version`. Unreleased upstream work is consumed downstream by git ref, plus the `allowScripts` entry the repo's AGENTS.md describes, or by `npm run link:local` for uncommitted work. After an upstream merge, `npm update <pkg>` re-resolves a `#main` ref.
- **PRs.** core and plugins PR into `main`; starter PRs into `next`. Never merge anything, and never open a release PR. Push, open the PR, and hand over.
- **Copilot reviews every PR once.** Answer it in one pass: fix what holds up, then reply to and resolve every thread. Never request a second review. The workspace AGENTS.md has the GraphQL commands.
- **Verify with `npm run check`**, and `npm test`, in every repo touched. Run `npm run types` first where wrangler moved, and commit the regenerated `worker-configuration.d.ts`.
- **Comments** follow the "Comments" section of AGENTS.md: a constraint, a measurement or a coupling; no history, versions, dates or counts.
