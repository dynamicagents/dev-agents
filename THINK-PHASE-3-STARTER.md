# Phase 3: starter on Think

Read `THINK-FINDINGS.md` first: decisions, verified Think facts, the old→new map, and the working rules. Then read `starter/AGENTS.md` and `starter/README.md`.

**Needs:** Phases 1 and 2 merged: core `main`, with the sub-agent summary fix, and plugins `main`.

**Produces:** one PR into starter `next` that moves every agent onto `A2AAgent` / `SubAgent`, removes the Workflows and wipes agent state at deploy.

## Setup

```
git -C ~/dev/dynamicagents/dev-agents/starter fetch origin
git -C ~/dev/dynamicagents/dev-agents/starter worktree add ~/dev/dynamicagents/worktrees/think/starter-cut -b feat/think origin/next
```

- **The worktree path.** `…/worktrees/think/starter` is taken. It holds the spike's local branch `spike/think` and its untracked tooling (see `THINK-FINDINGS.md`), so leave it alone. `starter-cut` is only a name: `npm run link:local` resolves its siblings as `../core` and `../plugins`, so whatever it is called it sits beside them.
- **Dependencies.**
  - `@dynamicagents/core` and `@dynamicagents/plugins` are already `#main`. `npm update @dynamicagents/core @dynamicagents/plugins` moves the lock onto them; `npm install` does not re-resolve a git ref.
  - The `github:dynamicagents/*` `allowScripts` entries already exist.
  - Add Think at the same pin as core: `npm install @cloudflare/think@0.19.0`.
  - Drop every direct dependency nothing imports after the port. Check `@cloudflare/shell`, `drizzle-orm` and `@platformatic/vfs` with a grep.
- **Local iteration:** `npm run link:local`, then `npm ci` again before committing.

## The agents

Each agent directory holds:
- `agent.ts`: the `A2AAgent` subclass;
- `children.ts`: its `SubAgent` classes;
- `plugins.ts`, `soul.ts`, `definition.ts`, `manifest.ts`.

`workflow.ts` and `subagent.ts` are deleted.

| Tenant | Class (was) | Children (mode) | Parent plugins | Child plugins |
| --- | --- | --- | --- | --- |
| `reactive` | `Reactive` (`ReactiveAgent`) | `ReactiveGeneral` (**awaited**) | `browser` | `browser` |
| `cf-coder` | `CfCoder` (`CfCoderAgent`) | `CfCoderCode` (**detached**) | `repo`, `hostScratch`, restricted `computer`, `browser` | `computer`, `browser` |
| `claude-coder` | `ClaudeCoder` (`ClaudeCoderAgent`) | `ClaudeCoderSession`, `ClaudeCoderReader` (both **detached**) | `repo` (with worktrees), `hostScratch`, restricted `computer`, `browser` | none |

- **Why these modes.** Detached is for a child that may run past 15 minutes: an implementation run with installs and tests, or a Claude Code session of up to 40 minutes. `ReactiveGeneral` does research, drafting and page reading, which finish in minutes.
- **If in doubt, detach.** The spike saw turns cut as early as about 5 minutes, and a deploy cuts them at any time. An awaited child caught by either comes back "interrupted".
- **A child's plugins are its own list.** A plugin offers the same tools to a parent and a child, so what a child must not have is left out of the child's `getPlugins()`.
  - `repo` stays off `CfCoderCode`: the parent owns the history. `repo_commit` and `repo_push` would otherwise sit behind prose alone. The child reads history with `git status`, `git diff` and `git log` through `bash`.
  - `hostScratch` stays off every child.
- **Every class that installs `computer` sets its workspace**, or its start fails with `PluginSetupError`:
  ```
  override workspace = computerWorkspace(config, () => this.pluginContext().runtime())
  ```
  A parent's `runtime()` is `undefined`, so it gets `config.workspaceName()`, the active repo. A child's carries the workspace name its `prepare` returned.

Every parent class:
- `getModel()`. `gatewayLogFields` returns `{ metadata, eventId }`, so spread it:
  ```
  workersAIModel(this.env, { modelId: <config>, sessionAffinity: this.name, ...gatewayLogFields({ agent: tenant, taskId: this.turnTaskId(), phase: "turn" }) })
  ```
- `configureContext()`: `[soul, memory, ...super.configureContext()]`.
  - The memory block is `{ label: "memory", description }`, with the description from starter and no `maxTokens`.
- **No `maxOutputTokens` and no `reasoningEffort`.** Provider defaults apply.
- `copy` from `src/copy.ts`.
- `compactAfterTokens` / `keepRecentTokens` from `src/config.ts`.
- `getPlugins()` and `getSubAgents()`.
- `getScheduledTasks()`, where one is added, spreads `super.getScheduledTasks()`, or core's `a2aRetention` is lost.
- `callerKey()` is `this.name` and never throws. The `identityKeyOrTask` fallbacks go.

`ReactiveGeneral` and `CfCoderCode` build their `getModel()` the same way, with `phase: "subagent"`, `subAgent: <class name>`, and the task from `activeTurnMetadata.taskId`. The Claude Code children are the exception: their model is `claudeCodeModel` (below).

### Reactive

- `ReactiveGeneral extends SubAgent`, whose `spec` is:
  - `name` and `description` (from `general.ts`);
  - `inputSchema: z.object({ task })`;
  - `soul`: `GENERAL_SUBAGENT_SOUL`, moved from `general.ts`.
- `ReactiveGeneral` has plugins `[browser]` and Think's own workspace.
- `general.ts` stops being a plugin.

### CfCoder

- **Read-only parent.** It replaces `restrictMainAgentTools`:
  - `restrictTools(computer(config), { allow: ["grep"], context: [PARENT_WORKSPACE] })`. Think's own `find` and `list` stay, over the computer workspace.
  - `context` is required: omitted, `restrictTools` drops the plugin's text, and the parent is told nothing about its workspace. `PARENT_WORKSPACE` is today's `PARENT_SANDBOX_CAPABILITY` plus `DEPENDENCY_TREE_NOTE`, reworded to Think's names: `read`, `find`, `list` and `grep`, and no `bash`, `write`, `edit` or `delete`.
  - `workspaceBash = false`;
  - `beforeTurn` merges `super.beforeTurn(ctx)` and sets `activeTools` to `ctx.tools` without Think's own `write`, `edit` and `delete`.
- **`check_back: this.checkBackTool()`,** added in `getTools()` over `super.getTools()`.
- **`CfCoderCode`** (the `code` spec from `code.ts`, `detached: true`):
  - full `computer` tools, plus `browser`;
  - `spec.prepare` supplies the active-repo workspace name, as `resolveRuntime` does today;
  - `code.ts`'s `delegationGuidance` names `delegate` and `final_reply`, which are gone. It folds into the spec's `description`.
  - `CODE_SUBAGENT_SOUL`'s `sb_exec` becomes `bash`.
- **`onTaskCanceled`** → `discardWorkingTree`, as today.
- **The weekly `reclaimIdleWorkspaces` cron** moves from `this.schedule` in `onStart` to `getScheduledTasks()`: `"every week on sunday at 02:00 in UTC"`.

### ClaudeCoder

- **Children.** `ClaudeCoderSession` and `ClaudeCoderReader` bind the plugin's specs with starter's hooks: `static override spec = { ...CLAUDE_CODE_AGENT, prepare, settle }`, and the same for `CLAUDE_CODE_READER_AGENT`. They install no plugins.
  - Their `getModel()` returns:
    ```
    claudeCodeModel({ config, workspace, storage: this.ctx.storage, runId: this.name, kind, dir, note: (key, text) => this.note(key, text), brief, followUp, report })
    ```
    - `config` is `claudeCodeConfig(env)`.
    - `workspace` opens the workspace `runtime()` names: `() => openWorkspace(stub) as Promise<SessionWorkspace>`. The cast is the one plugins' README shows.
  - The old `executeChunk` preamble becomes `brief(task)`: the credential-lead check, the advisories and the submodule starts, returning `sessionBrief`'s text. It runs once per run, and a throw fails the run with its message.
  - The old `#finishWriting` splits in two:
    - `followUp` returns the uncommitted-work warning prompt when a session left files uncommitted.
    - `report` discards uncommitted work, counts commits, notes the rate-limit reading and builds the report.
  - `sessionBrief`, the warning prompts and commit counting move into `children.ts` or a sibling module. `subagent.ts` goes.
- **`claude-code.ts`** loses `ClaudeCodeRouting` and `noWorkspaceRouting`: the config fields they answered are gone from plugins.
  - It becomes `claudeCodeConfig(env)`: credentials, `CLAUDE_CODE_SESSION`, the `GH_TOKEN` placeholder and the author.
  - `CLAUDE_CODE_SESSION` `satisfies Omit<ClaudeCodeConfig, "credentials">`.
  - `workspace-do.ts`'s call sites follow.
- **`prepare`** wraps the worktree pool's `resolve` (`src/workspace/subtask-workspace.ts`).
  - It returns `{ workspaceName, dir }`, with `dir` the checkout. The child reads both from `runtime()`.
  - `dir` comes from the workspace object's `checkoutDir()`, read on the parent, where the child used to read it. So the "no checkout yet, clone or open a scratchpad first" refusal, with its advisories, is thrown from `prepare`. The parent's model gets it as the tool's error, and nothing is dispatched.
  - The reader's `prepare` returns the parent's own workspace and checkout.
  - **A failed `prepare` releases its own claim.** `prepare` runs before core records the run, so a throw never reaches `settle`. The pool claims a worktree before it clones, fetches and places the branch, and any of those can throw. So the writer's `prepare` releases the claim before rethrowing, or the slot stays live and blocks a later `continue` of its branch.
  - **A turn cut between the claim and the dispatch** leaves a claim nobody settles either. `onTaskSettled` releases every claim the task still holds.
  - **A new branch is named from the run id, made git-safe.** Core's run id is `detached:<tool call id>`, and git refuses `:` in a branch name. The branch is `claude-coder/<task>/<tool call id>`. An id holding anything git refuses has it replaced, plus a hash of the whole run id, so two runs never share a branch.
- **`settle`** maps the run's `result.status` onto the pool's seams:
  - `completed` → `release`;
  - `aborted` → `abort` (stop the session, reset to the start), then `release`;
  - `error`, or `interrupted` without `childStillRunning` → `fail` (stop, commit what was left, keep it), then `release`.

  `fail` answers a note saying where the work was kept, and `settle` returns nothing. `onAgentToolFinish`, where `settle` runs, fires before the run's `onFinish` (`agents`' `_deliverDetachedTerminal`). So `settle` stores the note under the run id, and `ClaudeCoder` overrides `formatDetachedCompletion` to append it to the follow-up.
- **The pool is keyed by `runId`**, a string, which is the child's `this.name`. It used to be the numeric `subtaskId`. The fresh start wipes the table, so no migration is needed.
- **Same as CfCoder:** the read-only parent (its `workspace` and `context` block included), `check_back`, `onTaskCanceled` → `discardWorkingTree`, and the cron moved to `getScheduledTasks()` at `"every week on sunday at 03:00 in UTC"`.
- **The cancel-ordering comment on `onTaskCanceled` goes.** Think's child `cancelAgentToolRun` aborts and returns without waiting for the drain, so the ordering it protected cannot be kept.
  - It cannot be kept from `settle` either. `cancelAgentTool` delivers the aborted terminal, `settle` included, straight after the child's abort returns, in the same window as `onTaskCanceled`.
  - It is no longer needed for ClaudeCoder's parent checkout: a writer works in a worktree, and a reader in a throwaway copy. And `abort` already tolerates a reset that is not ordered against the session.
  - For CfCoder, whose `code` run shares the parent's checkout, this is today's ordering. The run's `bash` is killed on the abort, and the reset follows.
- **`onTaskSettled`** → `releaseContainer`, as today.
- **No `maxConcurrentAgentTools`.** It counts per caller, while the container binding's `max_instances` is the real, global bound.

## Other files

- **`src/round-policy.ts` → `src/copy.ts`:** `failed`, `emptyReply`, `questionExpired`. Everything about rounds, `final_reply`, budgets and deferrals goes.
- **Souls.** Ask and wait guidance moves into them. The coder souls also say:
  - a background sub-agent's result arrives in a later turn, so acknowledge the start and don't claim it is done;
  - act, don't announce. G1 saw GLM announce a step and stop.
- **Manifests.** The cards still describe a round loop and subtasks. Rewrite that copy.
- **`src/config.ts`** keeps only:
  - one model id per agent (claude-coder's inverted pair becomes its primary alone);
  - compaction values (`compactTailTokens` becomes `keepRecentTokens`);
  - `CLAUDE_CODE_SESSION`.

  It drops every limit, window, `maxSubtasks`, `RECALL`, `fallbackChatModelId`, `maxOutputTokens`, `reasoningEffort` and `memoryMaxTokens`.
- **`src/workspace/`** is adapted to `prepare`/`settle`.
  - The container command timeout in `container.ts` becomes a constant of its own. It no longer derives from core's `MAX_TOOL_CALL_MS`. Keep the value it resolves to today, justified against Think's 15-minute turn.
  - `activeRepo`, `sweepIdleWorkspaces`, `sqlPoolStore` and `worktreeSwitch` take the agent's `storage` and `callerKey` in place of a `PluginHost`.
  - `hostScratch` moves to the v3 `definePlugin`.
  - Its imports move: `WorkspaceObjectBase`, `workspaceName`, `openWorkspace`, the install plan and `workspaceExec` (was `computerExec`) come from `@dynamicagents/plugins/workspace`. `computer` and `computerWorkspace` stay on `/computer`, and the ClaudeCoder workspace object extends `/workspace`'s `WorkspaceObjectBase`.
- **`src/index.ts`:**
  - exports `Reactive`, `ReactiveGeneral`, `CfCoder`, `CfCoderCode`, `ClaudeCoder`, `ClaudeCoderSession`, `ClaudeCoderReader`, both workspace DOs, `WorkspaceProxy` and `Artifacts`;
  - mounts each agent with `defineAgent({ tenant, manifest, agent })`.
- **`wrangler.jsonc`:**
  - Durable Object bindings become `Reactive`, `CfCoder`, `ClaudeCoder`.
  - Remove the `workflows` block and the `vectorize` binding.
  - Keep the containers, the workspace DOs, `ARTIFACTS`, `BROWSER` and `AI`.
  - Append:
    ```
    { "tag": "v10", "deleted_classes": ["ReactiveAgent", "CfCoderAgent", "ClaudeCoderAgent"], "new_sqlite_classes": ["Reactive", "CfCoder", "ClaudeCoder"] }
    ```
    That is the fresh start: agent state is wiped, and workspace checkouts survive.
  - `npm run types`, then commit `worker-configuration.d.ts`.
- **Tests need a model seam.** The pool has no local `AI`, so a real `getModel()` cannot finish a turn. As core does in its `test/worker.ts`:
  - a `test/worker.ts` re-exports `src/index` and adds `Test*` subclasses whose `getModel()` returns `scriptedModel` or `mockModel`;
  - the test parents' `getSubAgents()` return the test children;
  - each test parent is mounted with `defineAgent` under its real tenant;
  - vitest's `main` points at it.
- **`vitest.config.ts`:** a test-only facet binding for every child class, the test ones included, replaces the `*_SUBAGENT` ones.
- **`scripts/verify-isolation.mjs`:**
  - The entries become each agent's `agent.ts`, `children.ts` and `workspace-do.ts`.
  - Drop the `core("round")` and `@cloudflare/shell` bans, because Think bundles shell.
  - Keep the plugin-leak bans.
  - Re-baseline the byte ceilings from the new builds, with a comment giving the reason: Think's eager imports, measured at about 1.7 MB gzip for one agent.
- **`scripts/cf.mjs`:** drop the `wf` subcommand.
- **Tests:**
  - rewrite `claude-coder`, `cf-coder-surface`, `gateway-attribution`, `artifacts`, `tenants` and `plugins`;
  - keep the worktree, subtask-workspace, scratch, `cf-coder-git` and `recorded` specs, adapted;
  - delete `round-policy.spec.ts`.
- **Docs** (`README.md`, `AGENTS.md`):
  - the "where a thing goes" table (`copy.ts`; the "how a round ends" row goes);
  - invariant #1, restated for the ledger's guarded write;
  - the Workflows sections removed.

## Known limitation

`activeRepo` holds one repository per caller. A detached run makes the gap between a task's dispatch and its follow-up turn long, and a second task from the same caller can move the selection in that gap. The follow-up then reviews and pushes in the other task's workspace. Phase 3 does not fix this; the PR says so. Keying the selection by task is now possible, because every turn carries its task (`turnTaskId()`).

## Verify

- `npm run types`, `npm run check`, `npm test`, `npm run verify:isolation`, `npx wrangler deploy --dry-run --outdir dist`. Deploy nothing.
- Through core's `createAgentHarness` with scripted models, for each tenant:
  - a plain turn → one `completed`;
  - cancel;
  - `ask_user`;
  - for the coders, a detached child → the task stays `working` → one `completed` after `onFinish`.
- For ClaudeCoder, against a fake `SessionRuntime`:
  - `settle` calls `abort` for an aborted run and `fail` for a failed one;
  - the kept-work note reaches the follow-up;
  - `prepare` refuses a workspace with no checkout before anything is dispatched.

## Hand-over

1. Push `feat/think`.
2. Open a PR into starter **`next`**.
3. Answer Copilot's one review in one pass.
4. Do not merge. Merging to `next` deploys.

The PR description carries **the cutover steps for the user, after that deploy**. Do not run them yourself: they delete cloud resources.
1. In-flight tasks die at deploy; the gatekeeper cancels them within 1 h.
2. Delete the old Workflows `handle-task`, `cf-coder` and `claude-coder`.
3. Delete the Vectorize index `da-starter-recall`.
4. Smoke-test each tenant on the real model:
   - a reactive question;
   - a cf-coder change, which runs detached;
   - a claude-coder session.

It also says what the fresh start drops beyond history: the reclaim sweep's list of workspaces and the worktree pool. Workspaces from before the cutover are then reclaimed only by their own idle alarms.
