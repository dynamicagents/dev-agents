# Task workflows, part 3: long work leaves the turn

This part follows the task-workflows series:
- [`TASK-WORKFLOWS-0-SPIKE.md`](TASK-WORKFLOWS-0-SPIKE.md): the design and its spike.
- [`TASK-WORKFLOWS-1-CORE.md`](TASK-WORKFLOWS-1-CORE.md): the core change.
- [`TASK-WORKFLOWS-2-STARTER.md`](TASK-WORKFLOWS-2-STARTER.md): starter on it.
- **Part 3, this file:** what happens to work that outlasts a turn, and the spike that tested it.

## Why

A Think turn runs inside a Durable Object alarm invocation, and the platform stops one after fifteen minutes of wall-clock time. In G11, the review turn was cut at 11 m 50 s of its own time: the alarm had spent the rest on work that ran before the turn in the same invocation.

**A deadline short of the ceiling cannot be right.** A step includes its tool calls, and one command — a test suite, a build, an install — can take the whole invocation, so no margin is safe. Core sets none.

The design instead:
- **A turn holds only bounded work.** A command that can run long runs where no alarm bounds it — in a detached sub-agent or a container session — and its result arrives in a later turn. The spike found starter already built this way.
- **A cut turn is continued, not failed.** Think's chat recovery already continues a cut turn; its bound is "no progress for five minutes", reset on progress, not a prediction.
- **The job ledger decides whether a cut turn continues,** not the age of its fiber.

## The facts behind it

Checked against the Think and agents releases core installs. Re-check any that a bump touches.

- **Think errors a running submission whose chat fiber is older than `submissionRecoveryStaleMs`** (900 s, a protected static meant for overriding) when the object starts, and then continues the turn without it. A turn the runtime cuts at the ceiling is always past it. That is G11's path: the job fails, the step's retry runs, and the old turn runs on beside it until `onChatRecovery` declines it.
- **A cut tool call reads as an error.** Think repairs it to `output-error`, "The tool call was interrupted before a result was recorded.", and the model decides whether to call it again. The command it ran may still be running in the container.
- **A detached run's `onFinish` is delivered after the turn that dispatched it ends, never during it.** A call that waits for a detached run has to ask the child (`inspectAgentToolRun`).
- **A sub-agent's turn is not a submission, and the ceiling does not bound it** (B-G2b). Think runs it inside `keepAliveWhile`, started by `startAgentToolRun`, not in an alarm invocation. A facet has no alarm slot of its own — its heartbeat is its root parent's — and aborting the parent cut the child too (B-G5), so an eviction or a deploy still can.
- **No step agent in starter runs a process.** reactive has the browser and Think's default workspace Bash — `just-bash`, a virtual shell over the object's own files that starts no process. claude-coder and cf-coder turn that off (`workspaceBash = false`), restrict the computer plugin to `grep`, and delegate:
  - claude-coder runs every command inside a Claude Code session, which is detached, re-attached from a stored cursor after a cut, and bounded by the container's `timeoutMs` (`plugins/src/claude-code/run.ts`);
  - cf-coder runs builds and tests in its detached `code` sub-agent, whose `bash` awaits each command inside the sub-agent's own turn.

## The spike

### Where it is

Local branches, committed and never pushed, in side-by-side worktrees under `~/dev/dynamicagents/worktrees/long-work/`:
- `core` on `spike/long-work`, off `feat/task-workflows` (core#66):
  - `StepAgent` sets `submissionRecoveryStaleMs = Infinity`;
  - `SubAgentSpec.inlineWaitMs`, and the wait in `subAgentTool`;
  - the spike specs, `src/agent/*.spike.spec.ts`, which report by failing because the pool prints nothing a passing spec logs;
  - test-only additions in `test/worker.ts`: `StaleAgent` (`submissionRecoveryStaleMs = 1`), `TestInline`, `test_tick` and a `loop:<n>:<s>` rule.
- `plugins` on `spike/long-work`, off `main`, unchanged.
- `starter` on `spike/long-work`, off `spike/task-workflows`, unchanged.

### Gates

| Gate | Passes when |
| --- | --- |
| B-G1: recovery | A turn cut mid-step (`ctx.abort()`) is continued under its submission and the job reports once. With the old staleness forced, G11's path reappears. A cut turn whose job was canceled is declined, and the agent runs its next job. |
| B-G2: the real ceiling | A turn of steps past fifteen minutes is cut by the runtime, continued, and completes its job once. |
| B-G2b: a child past the ceiling | Added by the spike: what happens to a detached sub-agent whose turn runs past fifteen minutes. |
| B-G3: wait, then detach | A quick run answers the call inline with no follow-up turn; a slow one returns `{ started }` and produces one follow-up; a cancel during the wait stops the run and keeps its work. |
| B-G4: a long command | Planned as claude-coder binding a command runner, live. Not run: see the results. |
| B-G5: cut during the wait | Record what happens when the parent is cut while it waits inline. |

### Results

Every gate that ran passed, all under the vitest pool, which enforces the alarm's wall-clock limit (B-G2) as `wrangler dev` did in G11.

- **B-G1: pass.**
  - Ledger-decided: the cut turn was continued under its own submission, which ended `completed`, within about half a second. One job, one report, no retry.
  - Think's default staleness (forced to `1` ms): the submission ended `error`, "Submission was interrupted after messages were applied.", the job `failed`, and `main:retry` completed the task. A whole attempt wasted.
  - Canceled while cut: the submission ended `aborted`, "the task has ended", and a new task on the same agent completed. Nothing wedged.
- **B-G2: pass.** Twenty one-minute steps in one turn. The step that began at 841 s never ended: the runtime cut the invocation at 900 s. The next step began at 900 s, the turn continued under its one submission, and the job reported `completed` once, after 1261 s. The cost of the cut was the step in flight.
- **B-G2b: a sub-agent's turn is not bounded by the ceiling.** A detached child whose one tool call slept 1080 s completed at 1081 s, uncut. A cut at 900 s would have ended the call there: Think repairs a cut call as an error, and the scripted child answers at once. plugins records the same in production: a twenty-one-minute Claude Code session, lost to a deploy rather than to a ceiling.
- **B-G3: pass, on the second design.**
  - First design: an in-memory waiter answered by `onSubAgentFinish`. The quick run finished at once, yet the call waited out the whole wait and the result arrived as a follow-up: the finish is not delivered while the waiting turn runs.
  - Second design: the call asks the child, `inspectAgentToolRun`, with backoff, and whichever of the call or the later finish closes the run's work row answers it. Quick: answered inline, one turn. Slow: `{ started }` after the wait, then one follow-up. Canceled while waiting: the job `canceled`, the run `aborted`, no report.
- **B-G4: not run.** Its premise — that a step agent runs long commands itself — does not hold (see the facts above). The command that can outlast a turn is in cf-coder's `code` sub-agent. A runner bound to claude-coder would give a shell to an agent designed without one.
- **B-G5: observed.** The parent was cut 1.2 s into a 2 s inline wait. The original run's result arrived as one follow-up, with one run and one completion. The abort cut the child too, which Think's recovery continued.

**Measured**, locally with scripted models, each over three runs, from accept to terminal callback:
- a task with no tool: about 300 ms;
- one awaited tool: about 300 ms;
- one awaited sub-agent: about 330 ms;
- one detached sub-agent answered inline: about 430 ms, the extra being the first poll's gap.

## What the spike changes

**Only a step agent's own turn meets the ceiling,** and one line answers it: `StepAgent.submissionRecoveryStaleMs = Infinity`, in core#66. A cut turn is then continued under its submission, its job stays open, and it reports once, at the cost of the step in flight. Whether a turn is continued is `onChatRecovery`'s, which declines a job that has ended. This is G11's second half, with no number.

**Nothing else is needed for the ceiling:**
- starter's step agents start no process — reactive's workspace Bash is a virtual shell over its own files — so no test suite or build runs in their turns. What they do await, a clone, a page load or a virtual shell command, ends on its own, and a cut one costs one step;
- a sub-agent's turn is not bounded by it (B-G2b), so cf-coder's `code` sub-agent can await a long `bash` and claude-coder's sessions can run past it.

**The inline wait is dropped.** It works (B-G3), but no step agent has a command to wait on, and a feature with no consumer is not shipped. Its design is recorded above for the day a step agent does.

## After review

- **Core, in core#66:**
  - `submissionRecoveryStaleMs = Infinity` on `StepAgent`;
  - B-G1's three cases as specs, each turn aged past the ceiling before it is cut, since Think reads a turn's age from its chat fiber, its task run and its stream. Without the override, the first fails as G11 did. `StaleAgent` keeps Think's own cutoff, and pins the path the override replaces;
  - B-G2 is recorded as a measurement, not a spec: it takes twenty-one minutes;
  - core's README states the rule: a turn holds only steps that finish within the ceiling, and a cut turn is continued.
- **plugins, optional:** a `bash` that re-attaches after an eviction or a deploy, as Claude Code sessions do. A cut `bash` leaves its command running and the model sees an interrupted call, so it may run it again. Not about the ceiling, and lower priority.
- **starter:** part 2 as written, without `formatContinuation`.

**Not in this part:** step agents are named by the caller's key (`#resolve` in `core/src/workflow/workflow.ts`, from core#66), so all of a caller's jobs on one agent share one queue, which runs one job at a time. That is the next scale question.
