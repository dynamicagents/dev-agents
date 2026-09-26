# Phase 2: plugins on Think

Read `THINK-FINDINGS.md` first: decisions, verified Think facts, the old→new map, and the working rules. Then read `plugins/AGENTS.md` and `plugins/README.md`, and on core `main` the contract this phase ports to: `src/contract/plugin.ts`, `src/contract/subagent.ts`, `src/contract/assemble.ts` and `src/subagent/subagent.ts`.

**Needs:** Phase 1 merged into core `main`.

**Produces:** one PR into plugins `main` that ports every plugin to contract v3, and deletes what Think now does.

## Setup

```
git -C ~/dev/dynamicagents/dev-agents/plugins fetch origin
git -C ~/dev/dynamicagents/dev-agents/plugins worktree add ~/dev/dynamicagents/worktrees/think/plugins -b feat/think origin/main
cd ~/dev/dynamicagents/worktrees/think/plugins && npm ci
npm update @dynamicagents/core
npm install --save-dev @cloudflare/think@0.19.0
```

- **Core.** The devDependency is already `#main`, with its `allowScripts` entry. `npm update` moves it onto the Think core. `npm run link:local` iterates against the sibling core worktree.
- **Think.** Add it as a peer too, with the range core declares for it in its `peerDependencies`, ceiling included.
- **Dropped dependencies.**
  - `@cloudflare/shell`, peer and devDependency: only `/workspace` imports it.
  - The `workers-ai-provider` peer: only `/recall` imports it. Keep the devDependency, because core peers on it.
- Do not bump `version`. The core peer range stays as it is.

## What core gives a plugin

- **The root.**
  - `definePlugin({ name, tools?(ctx), actions?(ctx), context?, requires? })`, `restrictTools`, `PluginSetupError` and `withAbort`.
  - The contract types, `SubAgentSpec` among them.
- **`PluginContext`.**
  - `env`, `storage`, `agentName`, `callerKey()`.
  - `workspace()`: the agent's own `this.workspace`.
  - `runtime()`: in a sub-agent, what its spec's `prepare` returned; `undefined` in a parent. Read it inside `execute`, never while building tools. It belongs to the turn.
- **One tool set.** A plugin's tools are the same for a parent and a sub-agent. The old `mainAgentTools` / `toolFamilies` split is now starter installing a different plugin list on each class.
- **The start check.** At start, core builds every plugin's tools and actions once, and refuses a name offered twice: by two plugins, or by a plugin and core. A plugin refuses its own wiring faults there by throwing `PluginSetupError` from `tools(ctx)`.
- **`/subagent`.** `SubAgent`, `NOTE_MILESTONE` and `NoteData`. `SubAgent.note(key, text)` is protected, so a model that reports notes takes it as a callback.
- **`/testing`.**
  - `TEST_MODELS` is gone: use `mockModel` / `scriptedModel`.
  - `makeDoHelpers` keeps `freshStub`.
- **Gone.** `/alarm`, `/job` and `platform.ts` (`MAX_TOOL_CALL_MS`).

## Delete

- **`/workspace`:** the plugin, its export, specs, README and table row. Think's built-in workspace replaces it.
- **`/recall`:** the same, plus the Vectorize types. Core's `search_history` replaces it.
- **`test/helpers.ts`,** if no ported spec still uses it.
- **Every `*_FAMILY` constant,** and every `key`, `mainAgentTools`, `toolFamilies` and `capability`.

## Every plugin

- **`name`,** not `key`.
- **The capability text becomes one `context` block.**
  - Give it a get-only provider: `{ provider: { get: async () => TEXT } }`.
  - A block with no provider is wired as a writable SQLite block, which the model can overwrite with `set_context`.
- **Comments.** Reword every comment that talks about chunks, rounds, families, the main agent or subtasks, under the comment rules.

## The workspace

The v3 contract has no workspace field. Think's `read`, `write`, `edit` and `delete` run against whatever the agent's `this.workspace` is. `/computer`'s tools replace `bash`, `grep`, `find` and `list` by name (see the merge order in the facts).

So an agent that installs `computer` but keeps Think's own workspace would run `bash` in the container and `read`/`write` in the agent's SQLite, and nothing would say so. Two pieces close that:
- **`computerWorkspace(config, runtime?)`** is what such an agent sets:
  ```
  override workspace = computerWorkspace(config, () => this.pluginContext().runtime())
  ```
- **`computer(config).tools(ctx)`** throws `PluginSetupError` unless `ctx.workspace()` is one. The split then fails the start with a sentence saying what to set.

## `/computer`

1. **Absorb core's alarm and job code.**
   - Copy `src/alarm/` and `src/job/` from core at `ad5a189`, the last commit before the Think merge, into `src/computer/host/`. They are internals, with no new export.
   - Repoint `workspace.ts`, `install-job.ts`, `sync.ts` and `install.ts` at them. They import only `cloudflare:workers`, `agents/lifecycle` and `agents/schedules`.
   - Their specs come too. `alarm`'s spec needs core's `PlainScheduled` and `DelegatingScheduled` test objects (core@ad5a189 `test/worker.ts`) in `test/worker.ts`, with their bindings and a migration in `wrangler.jsonc`.
   - `npm run types`, and commit `worker-configuration.d.ts`.
2. **`READY_DEADLINE_MS`** becomes a constant of its own. It was `MAX_TOOL_CALL_MS` minus a minute.
3. **`computerWorkspace(config, runtime?): WorkspaceLike`.**
   - Each method resolves the workspace the way `computer()` does, `workspaceNameFromRuntime(runtime?.()) ?? config.workspaceName()`, and opens `openWorkspaceFs` for that call alone.
   - It is built on the native `fs` stub, not on `@cloudflare/computer`'s `useThink` adapter. The adapter's `glob` and `readDir` are unbounded. The stub already has `readdir` with `limit`/`offset`, `find` with `exclude`, `rm` and `mkdir`.
   - `readFile` returns the whole file and never truncates, because `edit` writes back what it read.
   - `glob` excludes `WALK_SKIPS`.
   - Leave `writeFileBytes` out. Think's media eviction and skill projection would otherwise write into the checkout.
   - Every path goes through `guardPath`, which refuses `.git` and `node_modules` for reads as well as writes.
   - `writeFile`, `mkdir` and `rm` also go through `writeGate`. It refuses only while writes would not persist (`storage-exhausted`), not during an install.
   - `writeFile` takes `file-lock`.
   - Brand the object, and export `isComputerWorkspace`.
4. **`computer(config).tools(ctx)`,** under Think's names, so they replace the built-ins:
   - `bash`: the old `sb_exec`, with its install gate, advisories, abort-aware kill and transcript rendering.
   - `grep`: `fs.grep`, the old `sb_grep`, with its limits. Think's own runs `glob("**/*")` and then one `readFile` per file, which over a container walks everything.
   - `find` and `list`: the old `sb_ls`, bounded and skip-aware.
   - `edit`: the old `sb_edit`. `file-lock` spans the read and the write, and the unique-match rule stays. Think's `edit` is two calls, and the AI SDK runs one step's tool calls concurrently, so two edits to one file would lose one.
   - The `PluginSetupError` from "The workspace" above.

   Delete `sb_read`, `sb_write`, `sb_ls`, `sb_grep`, `sb_exists` and `sb_edit`. Think's `read`, `write` and `delete` over the proxy cover the rest.
5. **Unchanged.** `computerExec(config)` stays, for `/repo` and `/scratch`. `WorkspaceObjectBase` does not change, and needs no `useThink`.
6. **G8** (not run in the spike).
   - In the workspace-object spec, time Think's `read`, `write` and `edit`, and our `grep` and `find`, over the proxy on a realistic tree.
   - Record the result in `THINK-FINDINGS.md`'s G8 row, in a dev-agents PR.
   - If the numbers are bad, keep the `sb_*` file tools and say so.

## `/repo`

- **`tools(ctx)` returns today's tools.**
  - `repo_worktree` and `repo_worktrees` are included only when `config.worktrees` is set. Starter passes that config only to the parent. That is what keeps the switch off sub-agents.
  - Every exec call gets `runtime: ctx.runtime()`, read per call.
- **`repo_pr_comment` and `repo_pr_thread_reply` move to `actions(ctx)`,** as Think `action()`s.
  - Both take `timeoutMs: 120_000`, because an action's default is 30 s.
  - The key is a function, `idempotencyKey: ({ input, ctx }) => …`. Its `ctx` is Think's `ActionContext`, not the `PluginContext` that `actions(ctx)` receives, and the task comes from it: `task = ctx.agent.activeTurnMetadata?.taskId`. When `task` is not a string, throw rather than key without it: every turn core runs carries one, so a missing task is a wiring fault.
  - Both tools take `dir`, not `repo`: the repository is derived from the checkout. The keys are:
    - `repo_pr_comment`: `task + ":" + dir + "#" + number + ":comment:" + sha256(body)`;
    - `repo_pr_thread_reply`: `task + ":" + dir + "#" + number + ":" + threadId + ":" + sha256(body ?? "") + ":" + (resolve ?? true)`.
  - The thread and the resolve flag are in the key, or the same reply to two threads collides. The task is in the key, because a settled key replays for 30 days: without it, the same comment in a later task would never post.
  - Update the "not idempotent, read back before retrying" text to match.
- **Plain tools.** `repo_commit`, `repo_push`, `repo_open_pr`, `repo_clone` and `repo_fetch` are already safe to repeat, so they stay tools.
- **`RepoGit` is unchanged.**

## `/scratch` and `/browser`

- **Both:** contract port only.
- **`/scratch`** stays off sub-agents because starter installs it on parents only.
- **`/browser`** keeps its `agents/browser/ai` import. Think's `tools/browser` only re-exports it. `requires: { bindings: ["BROWSER"] }` stays.

## `/claude-code`

The session becomes the child's **model**, so Think's recovery drives it.

- **Specs.** Export `CLAUDE_CODE_AGENT` (`name: "claude_code"`) and `CLAUDE_CODE_READER_AGENT` (`"claude_code_read"`).
  - Both are `detached: true`, because a session runs up to 40 minutes.
  - `inputSchema`: `{ task, continue? }` for the writer, `{ task }` for the reader.
  - `formatInput` returns `task`.
  - `description` is the old capability text.
  - `soul` is one line, because this model reads no prompt blocks.
  - Starter adds `prepare` and `settle` when it binds them. The worktree pool lives there.
- **Delete:**
  - `CLAUDE_CODE_RECIPE`, `CLAUDE_CODE_READ_RECIPE` and the old `SubtaskTypeSpec`s;
  - the `claudeCode()` and `claudeCodeRead()` plugin factories;
  - `ClaudeCodeConfig`'s routing fields: `workspaceName` and the `*SubtaskWorkspace` hooks;
  - `windowMs`, `DEFAULT_WINDOW_MS`, and yielding a window.
- **`claudeCodeModel(options): LanguageModelV3`**, with these options:
  - `config`: a `ClaudeCodeConfig`;
  - `runtime`: `() => Promise<SessionRuntime>`, the run's container, opened per call;
  - `storage`: the child's `DurableObjectStorage`;
  - `runId`: the child's name, from which the exec ids derive;
  - `kind`: `"write"` or `"read"`;
  - `dir`: the checkout;
  - `note(key, text)`: `SubAgent.note`;
  - `followUp?(outcome)`: returns one more prompt, or `undefined`;
  - `report(outcome)`: returns the text the parent receives.

  Its `doStream`:
  1. If a report is already stored for this run, emits it and finishes. That is what makes `report` run once.
  2. Takes the prompt from the last user message. Starts the session under `execIdFor(runId)`, or attaches from the stored cursor (seq 0 if there is none).
  3. Drains to exit, with no windows. For each rendered note, awaits `note("claude:" + n, text)`, then stores the cursor. The milestone is persisted before `note` resolves, so the cursor never runs ahead of what the parent can replay. A note resent after an interruption carries the same positional key, and Artifacts dedupes on it.
  4. If `followUp(outcome)` returns a prompt, runs it under `followUpExecIdFor(runId)` the same way. The stored cursor names its exec.
  5. Stores `report(outcome)`, emits it as the stream's only text, then `finish`.
  - **`abortSignal`** stops the session: it kills both execs and deletes a read copy.
  - **Stream nothing else.** A run's summary is its first assistant message with text, so narration streamed as text would become the result. The stall watchdog is off, so a silent stream is not cut. Both facts are in `THINK-FINDINGS.md`.
- **Kept:** `claudeCodeSession` (starter's `settle` stops a session through it, with `subtaskId` renamed to `runId`), the credential pool, egress and the copy overlays.
- **Fix** `events.ts`'s comment that says re-attach uses `resume: "tail"`. It passes the seq.

## Docs

- **Root README.**
  - "The one file you edit" becomes a v3 example: `getPlugins()` on an `A2AAgent` subclass, and `workspace = computerWorkspace(…)`.
  - The plugins table loses `/workspace` and `/recall`.
  - "Writing one" describes v3.
  - The License line says Apache-2.0, as `LICENSE` and `package.json` do.
- **Per-plugin READMEs:** the same.

## Verify

- `npm run types`, then `npm run check && npm test`, with every surviving plugin's specs ported.
- `verify:exports` passes without `./workspace` and `./recall`.
- **The proxy.** It:
  - refuses `.git` and `node_modules`;
  - honours `writeGate`;
  - never truncates a read;
  - skips `WALK_SKIPS` in `glob`.
- **The tools.**
  - `grep` never walks `**/*`.
  - Two concurrent `edit`s to one file both land.
  - An agent whose workspace is not a computer workspace fails the start with `PluginSetupError`.
- **The action keys.** The same comment in another task posts. A retry within the task replays.
- **`claudeCodeModel`,** against a fake `SessionRuntime`:
  - notes arrive in order, with positional keys;
  - a restart mid-drain resumes from the cursor and loses no note;
  - the follow-up runs;
  - `report` runs once, and a re-entry emits the stored report;
  - abort kills the session;
  - the report is the only text part.

## Hand-over

1. Push `feat/think`.
2. Open a PR into plugins `main`. Say it is breaking (contract v3, and `/workspace` and `/recall` removed), and name the core commit it builds against.
3. Answer Copilot's one review in one pass.
4. Do not merge. Tell the user that Phase 3 can start.
