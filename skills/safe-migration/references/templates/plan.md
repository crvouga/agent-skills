# Plan: every step, in order, with its risk

This is the complete sequence. Steps run in the order listed: a step starts only when the step above
it is done, and a phase starts only when the previous phase's gate is met and recorded in
[progress.md](./progress.md). A step marked _(parallel with {{PREFIX}}-x.y)_ may run alongside that
step instead.

Each step is one PR or one recorded action of one [pattern]({{SAFE_STEPS}}#step-patterns), with one
proof and one way back. Status lives in progress.md, not here. This file changes only through an
amendment PR a human approves.

## Safety contract

What this migration promises at every step, how it keeps each promise, and what would show a promise
broken. Definitions: [the safety contract]({{SAFE_STEPS}}#the-safety-contract).

| Guarantee            | How this migration keeps it                                                         | Checked by                                                  |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Zero downtime        | TODO(why no step, and no undo, makes anything unavailable or slower)                | The `availability` check; TODO(what else)                   |
| Zero data loss       | TODO(why no write is dropped, duplicated or corrupted, and nothing read is deleted) | The `parity` check; TODO(what else)                         |
| Backwards compatible | TODO(why the previous release runs on the new state, and the new one on the old)    | The `rollback` check; TODO(what else)                       |
| Small uniform steps  | One PR or one action per step, one pattern, one proof, one way back                 | `validate` (every step has a pattern, proof and way back)   |
| Low risk             | Every step is rated Low after its safeguards; anything riskier is split             | `validate` (no step above Low), a named human on live steps |

## How risk is rated

Each step is rated **after** its safeguards, by the worst outcome that is still plausible:

| Rating     | Meaning                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Low**    | Read-only, local or disposable, behind a switch that turns it off without a release, or undone by `git revert` with nothing left behind. Worst case: a red check or a delayed deploy. |
| **Medium** | Changes what runs against a live system, the deploy path or shared tooling, with no instant way back. Not allowed as a step: split it or add a safeguard until each piece is Low.     |
| **High**   | Could affect users or their data if a safeguard fails. Never a step.                                                                                                                  |

## Phases at a glance

| Phase | Name                  | Live writes                    | Way back                                  |
| ----- | --------------------- | ------------------------------ | ----------------------------------------- |
| 0     | Know the ground       | None                           | Nothing to undo                           |
| 1     | Build the new path    | TODO(what the backfill writes) | `git revert`; the new path is unused      |
| 2     | Switch, one at a time | TODO(what each switch changes) | Switch back; the old path is intact       |
| 3     | Contract and clean up | TODO(what is removed)          | TODO(roll forward, or restore from where) |

## Phase 0: know the ground

| Step           | Work                                                                                           | Proof                       | Live write | Risk                                |
| -------------- | ---------------------------------------------------------------------------------------------- | --------------------------- | ---------- | ----------------------------------- |
| {{PREFIX}}-0.1 | TODO(inventory every consumer of the old thing, every environment, every place its data lives) | TODO(the inventory, linked) | No         | **Low**. Docs only                  |
| {{PREFIX}}-0.2 | TODO(measure today's baseline for the signals the soaks will watch: errors, latency, counts)   | TODO(the query links)       | No         | **Low**. Read-only                  |
| {{PREFIX}}-0.3 | TODO(write the check scripts listed under "Health checks" below)                               | TODO(a run of each check)   | No         | **Low**. Warn-only, reverted freely |

## Phase 1: build the new path

| Step           | Work                                                                                 | Proof                             | Live write                 | Risk                                            |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------------- | -------------------------- | ----------------------------------------------- |
| {{PREFIX}}-1.1 | TODO(add the new thing beside the old one, unused or switched off)                   | TODO(a test that old still works) | No                         | **Low**. Nothing reads it                       |
| {{PREFIX}}-1.2 | TODO(write every new change to both places; the old place stays the source of truth) | TODO(a test of both writes)       | No                         | **Low**. A failed new write never fails the old |
| {{PREFIX}}-1.3 | TODO(dry-run the backfill read-only: it prints exactly what it would write)          | TODO(the dry run output)          | No (read-only)             | **Low**. Read-only                              |
| {{PREFIX}}-1.4 | TODO(run the backfill: idempotent, resumable, throttled, old data untouched)         | TODO(the run and its counts)      | Yes: TODO(target and rows) | **Low**. Re-runnable; old stays source of truth |
| {{PREFIX}}-1.5 | TODO(prove old and new hold the same data)                                           | TODO(the parity output)           | No (read-only)             | **Low**. Read-only                              |

## Phase 2: switch, one target at a time

| Step           | Work                                                                             | Proof                           | Live write            | Risk                                           |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------- | --------------------- | ---------------------------------------------- |
| {{PREFIX}}-2.1 | TODO(readiness check for the first target, the least important one)              | TODO(the check output)          | No (read-only)        | **Low**. Read-only                             |
| {{PREFIX}}-2.2 | TODO(switch the first target to the new path)                                    | TODO(the signal after the flip) | Yes: TODO(the switch) | **Low**. One target; switched back in a minute |
| {{PREFIX}}-2.3 | TODO(soak: how long, which signals, what stops it)                               | TODO(the signal links)          | No                    | **Low**. Waiting                               |
| {{PREFIX}}-2.4 | TODO(move the remaining callers to the new path; the old path keeps working)     | TODO(the tests)                 | No                    | **Low**. `git revert`                          |
| {{PREFIX}}-2.5 | TODO(soak past the rollback window: nothing has read the old thing for how long) | TODO(the query showing no use)  | No                    | **Low**. Waiting                               |

## Phase 3: contract and clean up

| Step           | Work                                                                                 | Proof                         | Live write                 | Risk                                     |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------- | -------------------------- | ---------------------------------------- |
| {{PREFIX}}-3.1 | TODO(remove the old thing, now that nothing reads it and no rollback can land on it) | TODO(the release that ran it) | Yes: TODO(what is removed) | **Low**. Unused past the rollback window |
| {{PREFIX}}-3.2 | TODO(remove the switch, the dual write and the warn-only checks; finish the docs)    | TODO(the green checks)        | No                         | **Low**. Dead code and docs              |

## Prod path

Files whose change runs in a prod deploy path. `validate` requires every step whose scope touches one
to be marked Human and Done needs prod. One bullet per backticked glob.

None. TODO(if any file this migration changes runs in a prod deploy path, replace this line with one bullet per glob; otherwise keep "None." and say why)

## Health checks

One read-only script per row, in [checks/](./checks/): `checks/<check>.mjs` (or `.ts`, `.sh`). It
exits 0 when the system is healthy, and its last output line is the reading. A check is active from
the start, or once its `From` step is closed. Active checks that need nothing run by themselves
before every step starts, before it closes and before a gate is recorded; one that fails stops the
migration. A check that needs access runs by name, after a human agrees.

| Check        | Proves                                                           | Guarantee            | Needs                                 | From           |
| ------------ | ---------------------------------------------------------------- | -------------------- | ------------------------------------- | -------------- |
| remaining    | How much of the old thing is left; the migration is over at zero | Progress             | nothing                               | start          |
| availability | TODO(the signal showing nothing is unavailable or slower)        | Zero downtime        | TODO(the access it needs, or nothing) | {{PREFIX}}-0.3 |
| parity       | Old and new hold the same data                                   | Zero data loss       | TODO(the access it needs, or nothing) | {{PREFIX}}-1.5 |
| rollback     | The previous release still works on today's state                | Backwards compatible | TODO(the access it needs, or nothing) | {{PREFIX}}-0.3 |

## Step scopes

The machine-readable contract: each step's kind (`PR` changes code or config, `Docs` changes this
folder only, `Action` and `Wait` change only progress.md), its pattern, whether a named human must
approve it before it starts, whether it is done only once a prod run proves it, its own way back, and
the files its PR may change. Paths starting `./` are inside this folder. `progress.md` is always
allowed; `plan.md` never is. A step that needs a file not listed here stops and asks for an amendment.

| Step           | Kind   | Pattern    | Human | Done needs prod | Way back                                   | Files                           |
| -------------- | ------ | ---------- | ----- | --------------- | ------------------------------------------ | ------------------------------- |
| {{PREFIX}}-0.1 | Docs   | decide     | no    | no              | Nothing to undo                            | `./safety.md`                   |
| {{PREFIX}}-0.2 | Action | observe    | no    | no              | Nothing to undo                            | none                            |
| {{PREFIX}}-0.3 | PR     | guard      | no    | no              | `git revert`                               | `./checks/**`                   |
| {{PREFIX}}-1.1 | PR     | expand     | no    | no              | `git revert`; nothing reads the new path   | `TODO(the new path's files)`    |
| {{PREFIX}}-1.2 | PR     | dual-write | no    | no              | `git revert`; old stays source of truth    | `TODO(the writer's files)`      |
| {{PREFIX}}-1.3 | Action | observe    | no    | no              | Nothing to undo                            | none                            |
| {{PREFIX}}-1.4 | Action | backfill   | yes   | no              | Re-run, or empty the new place; old intact | none                            |
| {{PREFIX}}-1.5 | Action | observe    | no    | no              | Nothing to undo                            | none                            |
| {{PREFIX}}-2.1 | Action | observe    | no    | no              | Nothing to undo                            | none                            |
| {{PREFIX}}-2.2 | Action | switch     | yes   | no              | Switch back                                | none                            |
| {{PREFIX}}-2.3 | Wait   | soak       | no    | no              | Switch back                                | none                            |
| {{PREFIX}}-2.4 | PR     | move       | no    | no              | `git revert`; the old path still works     | `TODO(the callers' files)`      |
| {{PREFIX}}-2.5 | Wait   | soak       | no    | no              | `git revert` of the move                   | none                            |
| {{PREFIX}}-3.1 | PR     | contract   | yes   | no              | TODO(roll forward, or restore from where)  | `TODO(the old thing's files)`   |
| {{PREFIX}}-3.2 | PR     | cleanup    | no    | no              | `git revert`                               | `TODO(the scaffolding's files)` |
