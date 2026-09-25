# Phase 4: follow-ups

Read `THINK-FINDINGS.md` first. These items were deliberately left out of the cut. Each is its own small PR, and none is needed for the migration to work.

**Needs:** Phase 3 merged into starter `next` and deployed, so that each item can be judged against real traffic.

## 1. Approval-kind human-in-the-loop (core)

g2a-protocol supports an `approval` question (`HITL_REQUEST_KINDS`). The old round loop's approval exchanges were deleted in Phase 1, and no plugin needs approvals today. When one does:
- The plugin declares the gated tool as a Think `action({ kind: "durable-pause", approval: true, … })`.
- Core maps `pendingApprovals()` to an input-required task with `requestKind: "approval"` (see `HITL_APPROVE_OPTION_ID` / `HITL_REJECT_OPTION_ID`).
- The answer calls `approveExecution(executionId)` or `rejectExecution(executionId)`. Think then runs or refuses the action, and auto-continues the turn.

Read `node_modules/@cloudflare/think/docs/actions.md` first. Don't build it until a plugin asks for it.

## 2. `JobLifecycle` → `agents/tasks` (plugins `/computer`)

Phase 2 moved core's `/job` and `/alarm` into `plugins/src/computer/host/` unchanged. agents 0.24 ships `agents/tasks`:
- durable, replayable steps;
- retries;
- sleeps;
- installed on every `Agent` as `this.tasks`.

It could replace the install job's hand-written arm/claim/watch choreography. It is marked experimental, and it cannot run on routed sub-agents; the workspace object is top-level, so that does not apply. Read `node_modules/agents/docs/tasks.md`, then decide whether the port removes more code than it adds.

## 3. Housekeeping

- After Phases 1–3 merge:
  - run `npm run sync` in dev-agents, and advance the submodule pins in a dev-agents PR;
  - mark the phases done in `THINK-FINDINGS.md`.
- Ask the user whether to remove the spike:
  - the worktree `~/dev/dynamicagents/worktrees/think/starter`;
  - the branch `spike/think`;
  - the deployed Worker `da-think-spike`.

  Never delete any of them without asking.
- The eventual release needs a **minor** bump in core and plugins: the contract moves to v3, and there are new peers. That release is the user's to cut. Do not open release PRs.
