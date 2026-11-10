# Progress

The live state of the migration. Every PR in it updates this file. Each step's work, proof and risk
are in [plan.md](./plan.md), in the order they run; rules in [safety.md](./safety.md).

## Now

| Field         | Value                          |
| ------------- | ------------------------------ |
| Current phase | 0: know the ground             |
| Next step     | {{PREFIX}}-0.1                 |
| Switches      | none flipped                   |
| Ticket        | not created yet                |
| Last updated  | {{DATE}}, migration scaffolded |

## How to update this file

- The script writes it: `start`, `update` and `gate` change this step's row, the three rows of "Now"
  it owns (Current phase, Next step, Last updated) and "Blockers". Never edit another step's row.
- A step is `done` only when its proof from plan.md is linked under Evidence. `blocked` needs an
  entry under Blockers saying what unblocks it. `dropped` needs a decision-log entry and a named
  human's approval.
- Every write to a live system and every switch flip gets a row in the live write log naming the
  step, with its dry run and the human who approved it, in the same PR that records the step.
- The three logs are append-only: add rows, never change or remove one.

## Blockers

None.

## Phase gates

A gate is met only when every step in the phase is `done` or `dropped` and its condition is linked.

| Phase | Gate                                                               | Met | Evidence |
| ----- | ------------------------------------------------------------------ | --- | -------- |
| 0     | TODO(what must be known and proven before anything is built)       | no  |          |
| 1     | TODO(what must hold before the first switch: parity, a quiet soak) | no  |          |
| 2     | TODO(what must hold before anything old is removed)                | no  |          |
| 3     | TODO(what "the migration is over" means)                           | no  |          |

## Steps

Every step is rated in plan.md; the Risk column must match it.

### Phase 0: know the ground

| Step           | Work             | Risk | Status | PR  | Ticket | Evidence | Updated |
| -------------- | ---------------- | ---- | ------ | --- | ------ | -------- | ------- |
| {{PREFIX}}-0.1 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-0.2 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-0.3 | TODO(short name) | Low  | todo   |     |        |          |         |

### Phase 1: build the new path

| Step           | Work             | Risk | Status | PR  | Ticket | Evidence | Updated |
| -------------- | ---------------- | ---- | ------ | --- | ------ | -------- | ------- |
| {{PREFIX}}-1.1 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-1.2 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-1.3 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-1.4 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-1.5 | TODO(short name) | Low  | todo   |     |        |          |         |

### Phase 2: switch, one target at a time

| Step           | Work             | Risk | Status | PR  | Ticket | Evidence | Updated |
| -------------- | ---------------- | ---- | ------ | --- | ------ | -------- | ------- |
| {{PREFIX}}-2.1 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-2.2 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-2.3 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-2.4 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-2.5 | TODO(short name) | Low  | todo   |     |        |          |         |

### Phase 3: contract and clean up

| Step           | Work             | Risk | Status | PR  | Ticket | Evidence | Updated |
| -------------- | ---------------- | ---- | ------ | --- | ------ | -------- | ------- |
| {{PREFIX}}-3.1 | TODO(short name) | Low  | todo   |     |        |          |         |
| {{PREFIX}}-3.2 | TODO(short name) | Low  | todo   |     |        |          |         |

## Approvals

Every start of a step that needs a human, and every dropped step, with the human who said yes. The
script writes the rows; append-only.

| Date (UTC) | Step | Action | Approved by |
| ---------- | ---- | ------ | ----------- |

## Decision log

| Id    | Date (UTC) | Decision                                   | Why                          |
| ----- | ---------- | ------------------------------------------ | ---------------------------- |
| D-001 | {{DATE}}   | TODO(the decision to migrate, and to what) | TODO(the evidence behind it) |

## Open questions

Each is closed by the named step and then moved into the decision log.

| Question                                         | Closed by      |
| ------------------------------------------------ | -------------- |
| TODO(a fact the plan assumes but has not proven) | {{PREFIX}}-0.1 |

## Live write log

Every write to a live system and every switch flip. A row without a dry run and a named approver
fails `validate`.

| Date (UTC) | Step | Target | Command, switch flip or run | Dry run | Approved by | Result |
| ---------- | ---- | ------ | --------------------------- | ------- | ----------- | ------ |

## Evidence log

Links to runs, queries and outputs that steps cite.

| Date (UTC) | Step | What | Link |
| ---------- | ---- | ---- | ---- |
