# Phase 3: starter on Think

Read `THINK-FINDINGS.md` first: decisions, verified Think facts, the old→new map, and the working rules. Then read `starter/AGENTS.md` and `starter/README.md`.

**Needs:** Phase 2's plugins branch `feat/think`, which may still be an open PR, and core `main` with the sub-agent summary fix (`SubAgent` joins every assistant message of a run into its result; see the facts).

**Produces:** one PR into starter `next` that moves every agent onto `A2AAgent` / `SubAgent`, removes the Workflows and wipes agent state at deploy.

## Setup

```
git -C ~/dev/dynamicagents/dev-agents/starter fetch origin
git -C ~/dev/dynamicagents/dev-agents/starter worktree add ~/dev/dynamicagents/worktrees/think/starter-cut -b feat/think origin/next
```

- **The worktree path.** The spike is a branch in the starter repo, not a worktree, so nothing holds `…/worktrees/think/starter`; `starter-cut` is only a name. `npm run link:local` resolves its siblings as `../core` and `../plugins`, so whatever it is called it sits beside them.
- **Dependencies.**
  - Point `@dynamicagents/core` at `#main`, and `@dynamicagents/plugins` at `#feat/think`, or at `#main` if the user has merged it; the PR says which.
  - The `github:dynamicagents/*` `allowScripts` entries already exist.
  - Add Think at the same pin as core: `npm install @cloudflare/think@0.19.0`.
- **Local iteration:** `npm run link:local`, then `npm ci` again before committing.

## The agents

Each agent directory holds:
- `agent.ts`: the `A2AAgent` subclass;
- `children.ts`: its `SubAgent` classes;
- `plugins.ts`, `soul.ts`, `definition.ts`, `manifest.ts`.

`workflow.ts` and `subagent.ts` are deleted.

| Tenant | Class (was) | Children (mode) | Plugins |
| --- | --- | --- | --- |
| `reactive` | `Reactive` (`ReactiveAgent`) | `ReactiveGeneral` (**awaited**) | `browser` |
| `cf-coder` | `CfCoder` (`CfCoderAgent`) | `CfCoderCode` (**detached**) | `repo`, `hostScratch`, restricted `computer`, `browser` |
| `claude-coder` | `ClaudeCoder` (`ClaudeCoderAgent`) | `ClaudeCoderSession`, `ClaudeCoderReader` (both **detached**) | `repo` (with worktrees), `hostScratch`, restricted `computer`, `browser` |

- **Why these modes.** Detached is for a child that may run past 15 minutes: an implementation run with installs and tests, or a Claude Code session of up to 40 minutes. `ReactiveGeneral` does research, drafting and page reading, which finish in minutes.
- **If in doubt, detach.** The spike saw turns cut as early as about 5 minutes, and a deploy cuts them at any time. An awaited child caught by either comes back "interrupted".
- **A child's plugins are its own list.** A plugin offers the same tools to a parent and a child, so what a child must not have — `repo`'s worktree switch, `hostScratch` — is left out of the child's `getPlugins()`.
- **Every class that installs `computer` sets its workspace**, or its start fails with `PluginSetupError`:
  ```
  override workspace = computerWorkspace(config, () => this.pluginContext().runtime())
  ```
  A parent's `runtime()` is `undefined`, so it gets `config.workspaceName()`, the active repo. A child's carries the workspace name its `prepare` returned.

Every agent class:
- `getModel()`:
  ```
  workersAIModel(this.env, { modelId: <config>, sessionAffinity: this.name, metadata: gatewayLogFields({ agent: tenant, taskId: this.activeTurnMetadata?.taskId }) })
  ```
- `configureContext()`: `[soul, memory, ...super.configureContext()]`. The memory block's description comes from starter.
- `copy` from `src/copy.ts`.
- `compactAfterTokens` / `keepRecentTokens` from `src/config.ts`.
- `getPlugins()` and `getSubAgents()`.

### Reactive

- `ReactiveGeneral extends SubAgent`, whose `spec` is:
  - `name` and `description` (from `general.ts`);
  - `inputSchema: z.object({ task })`;
  - `soul`: `GENERAL_SUBAGENT_SOUL`, moved from `general.ts`.
- `ReactiveGeneral` has plugins `[browser]` and Think's own workspace.
- `general.ts` stops being a plugin.

### CfCoder

- **Read-only parent.** It replaces `restrictMainAgentTools`:
  - `restrictTools(computer(config), { allow: ["grep", "find", "list"] })`;
  - `workspaceBash = false`;
  - `beforeTurn` returns `activeTools` without Think's own `write`, `edit` and `delete`.
- **`check_back: this.checkBackTool()`.**
- **`CfCoderCode`** (the `code` spec from `code.ts`, `detached: true`):
  - full `computer` tools, plus `repo` (without `worktrees`) and `browser`;
  - `spec.prepare` supplies the active-repo workspace name, as `resolveRuntime` does today.
- **`onTaskCanceled`** → `discardWorkingTree`, as today.
- **The weekly `reclaimIdleWorkspaces` cron** moves from `this.schedule` in `onStart` to `getScheduledTasks()`: `"every week on sunday at 02:00 in UTC"`.

### ClaudeCoder

- **Children.** `ClaudeCoderSession` and `ClaudeCoderReader` bind the plugin's specs with starter's hooks: `static override spec = { ...CLAUDE_CODE_AGENT, prepare, settle }`, and the same for `CLAUDE_CODE_READER_AGENT`. They install no plugins.
  - Their `getModel()` returns `claudeCodeModel({ config, runtime, storage: this.ctx.storage, runId: this.name, kind, dir, note: (key, text) => this.note(key, text), followUp, report })`, where `config` is `CLAUDE_CODE_SESSION` plus the credentials, and `runtime` opens the workspace `runtime()` names.
  - The old `#finishWriting` splits in two:
    - `followUp` returns the uncommitted-work warning prompt when a session left files uncommitted.
    - `report` discards uncommitted work, counts commits and builds the report.
  - `sessionBrief`, the warning prompts and commit counting move into `children.ts` or a sibling module. `subagent.ts` goes.
- **`prepare`/`settle`** wrap the worktree pool's claim and release (`src/workspace/subtask-workspace.ts`).
  - `prepare` returns `{ workspaceName, dir }`, with `dir` the checkout. The child reads both from `runtime()`.
  - The reader's `prepare` returns the parent's own workspace.
- **Same as CfCoder:** the read-only parent, its `workspace` included, `check_back`, `onTaskCanceled` → `discardWorkingTree`, and the cron moved to `getScheduledTasks()` at `"every week on sunday at 03:00 in UTC"`.
- **`onTaskSettled`** → `releaseContainer`, as today.
- **No `maxConcurrentAgentTools`.** It counts per caller, while the container binding's `max_instances` is the real, global bound.

## Other files

- **`src/round-policy.ts` → `src/copy.ts`:** `failed`, `emptyReply`, `questionExpired`. Everything about rounds, `final_reply`, budgets and deferrals goes.
- **Souls.** Ask and wait guidance moves into them. The coder souls also say:
  - a background sub-agent's result arrives in a later turn, so acknowledge the start and don't claim it is done;
  - act, don't announce. G1 saw GLM announce a step and stop.
- **`src/config.ts`** keeps:
  - one model id per agent (claude-coder's inverted pair becomes its primary alone);
  - compaction values;
  - `CLAUDE_CODE_SESSION`.

  It drops every limit, window, `maxSubtasks`, `RECALL` and `fallbackChatModelId`.
- **`src/workspace/`** is adapted to `prepare`/`settle`. The container command timeout in `container.ts` becomes a constant of its own; it no longer derives from core's `MAX_TOOL_CALL_MS`.
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
- **`vitest.config.ts`:** test-only facet bindings for the four children replace the `*_SUBAGENT` ones.
- **`scripts/verify-isolation.mjs`:**
  - The entries become each agent's `agent.ts`, `children.ts` and `workspace-do.ts`.
  - Drop the `core("round")` and `@cloudflare/shell` bans, because Think bundles shell.
  - Keep the plugin-leak bans.
  - Re-baseline the byte ceilings from the new builds, with a comment giving the reason: Think's eager imports, measured at about 1.7 MB gzip for one agent.
- **`scripts/cf.mjs`:** drop the `wf` subcommand.
- **Tests:**
  - rewrite `claude-coder`, `cf-coder-surface`, `gateway-attribution`, `artifacts`, `tenants` and `plugins`;
  - keep the worktree, subtask-workspace and scratch specs, adapted;
  - delete `round-policy.spec.ts`.
- **Docs** (`README.md`, `AGENTS.md`):
  - the "where a thing goes" table (`copy.ts`; the "how a round ends" row goes);
  - invariant #1, restated for the ledger's guarded write;
  - the Workflows sections removed.

## Verify

- `npm run types`, `npm run check`, `npm test`, `npm run verify:isolation`, `npx wrangler deploy --dry-run --outdir dist`. Deploy nothing.
- Through core's `createAgentHarness` with mock models, for each tenant:
  - a plain turn → one `completed`;
  - cancel;
  - `ask_user`;
  - for the coders, a detached child → the task stays `working` → one `completed` after `onFinish`.

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
