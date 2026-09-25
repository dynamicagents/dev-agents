# Phase 2: plugins on Think

Read `THINK-FINDINGS.md` first: decisions, verified Think facts, the old→new map, and the working rules. Then read `plugins/AGENTS.md` and `plugins/README.md`.

**Needs:** Phase 1's core branch `feat/think`. It may still be an open PR.

**Produces:** one PR into plugins `main` that ports every plugin to the v3 contract, and deletes what Think now does.

## Setup

```
git -C ~/dev/dynamicagents/dev-agents/plugins fetch origin
git -C ~/dev/dynamicagents/dev-agents/plugins worktree add ~/dev/dynamicagents/worktrees/think/plugins -b feat/think origin/main
cd ~/dev/dynamicagents/worktrees/think/plugins && npm ci
```

- **Core dependency.** Point the core devDependency at `git+https://github.com/dynamicagents/core.git#feat/think` while core's PR is open. The `github:dynamicagents/core` `allowScripts` entry is already there. Switch it to `#main` (then run `npm update @dynamicagents/core`) once the user has merged core, and say which one the PR uses.
- **Local iteration** against the sibling core worktree: `npm run link:local`.
- **Think.** Add `@cloudflare/think` as a peer (`">=0.19.0 <0.20.0"`) and as a devDependency. `/browser` imports `@cloudflare/think/tools/browser`.
- Do not bump `version`. The core peer range stays as it is, because core's version is unchanged.

## Delete

- **`/workspace`:** the plugin, its export, and its specs. Think's built-in workspace (`this.workspace` + `read`/`write`/`edit`/`list`/`find`/`grep`/`delete`) replaces `ws_read`/`ws_write`/`ws_list`.
- **`/recall`:** the plugin, its export, its specs, and the Vectorize types. Core's `search_history` replaces it.

## Port to contract v3

The contract, from Phase 1:
- `definePlugin({ name, tools(ctx), actions?(ctx), context?, workspace?(ctx), requires? })`;
- `ctx` is `PluginContext`: `env`, `storage`, `agentName`, `callerKey()`, `workspace()`, and `runtime()` (a SubAgent's `prepare` output);
- `capability` text becomes a `context` block;
- `toolFamilies`, `mainAgentTools` and `subtaskType`/`recipe` are gone. A plugin's tools are the same for a parent and a child. A plugin that describes a sub-agent exports a `SubAgentSpec` as data, and starter binds it to a class.

Grep for `@dynamicagents/core/` imports and port each one.
- `/agent`, `/round`, `/subtasks`, `/subagent`, `/alarm` and `/job` no longer exist.
- Nor does `platform.ts`: a tool that can hang owns its own timeout. For example, `/computer`'s `READY_DEADLINE_MS` was derived from `MAX_TOOL_CALL_MS`, and now becomes its own constant.

### `/browser`

A thin plugin:
- `tools` is `createQuickActionTools({ browser, maxChars, actions, options })` from `@cloudflare/think/tools/browser`, which is the same `agents/browser` tools as today;
- its capability text becomes a `context` block;
- `requires: { bindings: ["BROWSER"] }` stays.

### `/computer`

1. **Absorb core's alarm and job code.** Copy `src/alarm/` and `src/job/` from core `main` into `src/computer/host/`, as internals with no new export. Point `install-job.ts`, `sync.ts` and `workspace.ts` at them.
2. **`computerWorkspace(config): WorkspaceLike`:** a proxy over `openWorkspaceFs(...)`'s Think-compatible methods (`useThink`). Open one per call.
   - `guardPath`, the `.git` write refusal, `writeGate` (installing, or dependencies not ready) and `file-lock` all move in here. The guard follows the filesystem, not a tool.
   - `glob` skips `WALK_SKIPS`.
   - Leave `writeFileBytes` out: Think's media eviction and skill projection would otherwise write into the repo checkout.
3. **`computerTools(config)`**, under Think's tool names so they replace the built-ins:
   - `bash`: container exec, the old `sb_exec`, with its install gate, advisories, abort-aware kill and transcript rendering;
   - `grep`: `fs.grep`, the old `sb_grep`, with its limits;
   - `find` and `list`: bounded and skip-aware.

   Think's own `grep` runs `glob("**/*")` then one `readFile` per file, which over a container walks `.git` and `node_modules`.
4. **Delete** `sb_read`, `sb_write`, `sb_edit`, `sb_ls`, `sb_grep` and `sb_exists`. Think's `read`/`write`/`edit` over the proxy, plus the overrides above, cover them.
5. **`WorkspaceObjectBase`** builds its workspace with `useThink: true`.
6. **`computerExec(config)`** stays for `/repo` and `/scratch`.
7. **G8** (not run in the spike): with the test workspace object, time Think's `read` and `edit` over the proxy and the `grep` override on a realistic tree. Record the result in `THINK-FINDINGS.md`'s G8 row, through the dev-agents PR that follows this phase. If the numbers are bad, keep the `sb_*` file tools and say so.

### `/repo`

- `tools(ctx)`; the workspace comes from `ctx.runtime()` in a child and from config in a parent.
- `repo_pr_comment` and `repo_pr_thread_reply` become Think `action()`s with:
  - `idempotencyKey: ({ input }) => repo + "#" + pr + ":" + sha256(body)`;
  - `timeoutMs: 120_000`, because an action's default is 30 s.

  A recovery retry then never double-posts.
- `commit`, `push` and `open_pr` are already idempotent, so they stay plain tools.
- `RepoGit` (credentialed clone/fetch/push on the host) is unchanged.

### `/scratch`

Port it to `tools(ctx)`; nothing else changes.

### `/claude-code`

- **Specs.** Export `CLAUDE_CODE_AGENT` and `CLAUDE_CODE_READER_AGENT` as `SubAgentSpec`s, **both `detached: true`** (a session runs up to 40 minutes), with:
  - `description`, `soul`, and `inputSchema` (the old params, `continue` included);
  - `prepare`/`settle` hooks that starter supplies (the worktree pool lives there).
- **Delete** `CLAUDE_CODE_RECIPE`, the capability-on-type plumbing, and the `executeChunk`/`yieldRun` coupling.
- **`claudeCodeModel(opts): LanguageModelV3`.** The session is the child's model, so Think's recovery drives it. Its `doStream`:
  1. starts the session (`startRun`), or attaches to a running one, from the exec id stored in the child's `sql`;
  2. drains events in windows (`drainRun`), rendering each deterministically to text or reasoning deltas;
  3. sends notes through the child's `reportProgress({ milestone: "note", … }, { persist: true })`;
  4. runs `opts.onFinish` (starter's post-session step, the old `#finishWriting`);
  5. emits the report as text, then `finish`.
  - `abortSignal` → `killRun`.
  - **Resuming (spike G9):** Think re-enters `doStream` after an interruption and replays the persisted partial in the prompt. Re-render from the start of the session's event log and skip the prefix that the replayed partial already holds. Never resume from a side cursor: Think persists partials lazily, and one would silently drop text.
  - Emit deltas steadily, so a recovery never sees the turn as stalled.
- The credential pool, egress and copy overlays are unchanged.

## Verify

- `npm run check && npm test`, with every surviving plugin's specs ported.
- Proxy guard specs: `.git` write refused, `writeGate` honoured, `node_modules` skipped.
- A spec asserting that the `grep` override never walks `**/*`.
- `claudeCodeModel` against a fake runtime:
  - the parts come out in order;
  - a restart mid-stream resumes with no duplicated or missing text;
  - abort → `killRun`;
  - `onFinish` runs once.
- `npm run verify:exports`, with the deleted exports gone.

## Hand-over

1. Push `feat/think`.
2. Open a PR into plugins `main`. Say it is breaking (contract v3, `/workspace` and `/recall` removed), and name the core ref it builds against.
3. Answer Copilot's one review in one pass.
4. Do not merge. Tell the user that Phase 3 can start.
