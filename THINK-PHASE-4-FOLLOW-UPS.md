# Phase 4: follow-ups

Read `THINK-FINDINGS.md` first. These items were deliberately left out of the cut. Each is its own small PR, and none is needed for the migration to work.

**Needs:** Phase 3 merged into starter `next` and deployed, so that each item can be judged against real traffic.

## 1. Approval-kind human-in-the-loop (core)

g2a-protocol supports an `approval` question (`HITL_REQUEST_KINDS`). The old round loop's approval exchanges were deleted in Phase 1, and no plugin needs approvals today. When one does:
- The plugin declares the gated tool as a Think `action({ kind: "durable-pause", approval: true, … })`.
- Core maps `pendingApprovals()` to an input-required task with `requestKind: "approval"` (see `HITL_APPROVE_OPTION_ID` / `HITL_REJECT_OPTION_ID`).
- The answer calls `approveExecution(executionId)` or `rejectExecution(executionId)`. Think then runs or refuses the action, and auto-continues the turn.

Read `node_modules/@cloudflare/think/docs/actions.md` first. Don't build it until a plugin asks for it.

## 2. `JobLifecycle` → `agents/tasks` (core `/job`)

Core's `/job` drives plugins `/workspace`'s dependency install. agents ships `agents/tasks`:
- durable, replayable steps;
- retries;
- sleeps;
- installed on every `Agent` as `this.tasks`.

It could replace the install job's hand-written arm/reserve/watch choreography. It is marked experimental, and it cannot run on routed sub-agents; the workspace object is top-level, so that does not apply. Read `node_modules/agents/docs/tasks.md`, then decide whether the port removes more code than it adds.

## 3. The alarm's install re-attaches to the last one (plugins `/workspace`)

When the armed reinstall runs, `InstallJob.#beginInstall` calls `state()` before it reserves. The record is then the alarm's own placeholder: `running`, with nothing spawned. `state()` treats any fresh `running` record that nobody is draining as one to re-attach to, so it calls `getExec` on the install's exec id and drains what it finds: the previous install, long finished.

The install still runs correctly. The reservation takes the placeholder either way, and the stale drain writes under the placeholder's generation, which the reservation moves. What it costs:
- A wasted `getExec`, and a replayed verdict that can land on the placeholder before the reservation does.
- A possible second drain. `#draining` is one flag, so the stale drain's `finally` can clear it while the real install is still draining, and a later `state()` then re-attaches a second drain to the live install. Both hold the same generation, so the first verdict settles the run and the second is refused.

The fix:
- Skip the re-attach when the record is the placeholder `#beginInstall` was told to take over (`takeOverArmedAt`). `onRun` clears the armed stamp before it starts, so the stamp has to come from there, not from `armedAt()`.
- Track drains by generation, not with a boolean.

Pin it with a spec in which the alarm's install never calls `getExec`.

## 4. Housekeeping

- After Phases 1–3 merge:
  - run `npm run sync` in dev-agents, and advance the submodule pins in a dev-agents PR;
  - mark the phases done in `THINK-FINDINGS.md`.
- The spike's worktree and the deployed Worker `da-think-spike` are already gone. What
  is left is starter's branch `claude-coder/0ca01723-882c-40ed-8c68-ad0fa498f863/130`,
  pushed on purpose so the spike cannot be lost a second time. Never delete it without
  asking.
- The eventual release needs a **minor** bump in core and plugins: the contract moves to v3, and there are new peers. That release is the user's to cut. Do not open release PRs.
