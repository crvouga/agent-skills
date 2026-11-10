# Safe steps: the contract, the patterns, and how to cut a migration into them

A safe migration is a long list of boring steps. Each one is small, proven, and undone in minutes, so
agents can run the whole thing and a human only decides where the plan says a human decides. This file
is the definition. `safe-migration validate` enforces the parts a script can check; the rest is what
the plan's reviewers hold it to. Everything a migration writes, including the scripts that check it,
lives in `.safe-migrations/<name>/` ([format](./format.md)).

## The safety contract

Five guarantees. A migration states how it keeps each one in the `## Safety contract` table of its
plan.md, and every step keeps all five.

| Guarantee                | What it means                                                                                                                                                               | A step breaks it when                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero downtime**        | No step, and no undo of a step, makes the product unavailable or slower for anyone. A failure delays a deploy; it never reaches a user.                                     | It holds a lock that blocks reads or writes, restarts a service with no replacement serving, needs a maintenance window, or makes a deploy depend on a system that can be down.                   |
| **Zero data loss**       | No write is dropped, duplicated or corrupted, and nothing is deleted while anything can still read it. At every moment one place is the source of truth and it is complete. | It switches readers before the new place holds every row, backfills without a dual write (writes made during the copy are lost), deletes or rewrites in place, or cannot be re-run after a crash. |
| **Backwards compatible** | The previous release runs on the new state and the new release runs on the old state, at every step. A rollback or a half-finished deploy is always safe.                   | It renames or removes something the last release reads, makes a new field required before every writer sends it, or ships code and the state it needs in one step.                                |
| **Small uniform steps**  | Every step is one PR or one action of one known pattern, with one proof and one way back, inside a fixed list of files.                                                     | It bundles two patterns ("add the column and backfill it"), needs a second PR to be safe, has no named proof, or its way back is "fix forward".                                                   |
| **Low risk**             | Every step is rated Low after its safeguards. A step that is not is split, or given a safeguard, until it is.                                                               | Its worst plausible outcome is more than a red check, a delayed deploy or wasted work.                                                                                                            |

**Low does not mean zero.** It assumes the facts in safety.md are true, that no gate is skipped, and
it does not cover the product risk of the change being the wrong change. A plan says so in its own
words, and phase 0 exists to turn its assumptions into facts.

## What one safe step is

Every step has the same shape, which is what lets any agent pick up any step:

- **One change.** One PR a reviewer reads in one sitting (`verify` warns above 500 changed lines), or
  one action on one target, or one wait.
- **One pattern** from the table below. If a step needs two words to describe ("expand and switch"),
  it is two steps.
- **One proof**, named in the plan before the work starts: the test, run, query or output that shows
  the step did what it says. No proof, not done.
- **One way back**, named in the plan: `git revert`, switch back, re-run, or "nothing to undo". It is
  true for this step alone, not for the phase.
- **A fixed scope:** the files its PR may change. Needing another file is a plan amendment.
- **Rated Low**, with the reason next to the rating.

## Rating risk

Rate each step **after** its safeguards, by the worst outcome that is still plausible:

| Rating     | Meaning                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Low**    | Read-only, local or disposable, behind a switch that turns it off without a release, or undone by `git revert` with nothing left behind. Worst case: a red check or a delayed deploy. |
| **Medium** | Changes what runs against a live system, the deploy path or shared tooling, with no instant way back. Not a step: split it.                                                           |
| **High**   | Could affect users or their data if a safeguard fails. Never a step.                                                                                                                  |

### The levers that turn Medium into Low

| Lever                        | What it means                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Dark, then switch**        | New behaviour ships turned off. A switch (a flag, a variable) turns it on, and off again without a release.            |
| **One at a time**            | One target per switch, least important first: disposable copies, then staging, then prod, off-peak. Never two at once. |
| **Dry run first**            | Before any live write, the same command runs read-only on the same target and says exactly what the write will do.     |
| **Canary first**             | Each new kind of change runs first on something with no user data that nothing reads.                                  |
| **Shadow first**             | Each new check runs warn-only until it has been quiet, then becomes blocking in its own step.                          |
| **Dual write**               | New writes go to both places before any data is copied, so the copy can never miss a write.                            |
| **Ordered deploys**          | Code that needs new state ships only after the state exists everywhere; state is removed only after no code reads it.  |
| **Fail safe**                | An unknown value, target or state stops the run before any write. Nothing guesses.                                     |
| **Soak**                     | Wait a fixed time, or for a release to reach prod, watching named signals, before the next irreversible-looking step.  |
| **Past the rollback window** | Nothing old is removed while any image a rollback could land on still reads it.                                        |

## Step patterns

The `Pattern` column of `## Step scopes` names one of these. `safe-migration patterns` prints the same
list; `validate` enforces the rules in the last column.

| Pattern      | The step                                                                                           | Its proof                                           | Its way back                               | Enforced                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `decide`     | Record a decision, a spike result or a finding. Nothing that runs changes.                         | The decision-log entry                              | Nothing to undo                            | Kind Docs or Action                                                                |
| `observe`    | Read-only look at the real system: audit, measurement, dry run, parity check, rehearsal on a copy. | The output, linked                                  | Nothing to undo                            |                                                                                    |
| `guard`      | Add a check, test, alert or health check, warn-only.                                               | A run of the check                                  | `git revert`                               |                                                                                    |
| `enforce`    | Make a guard blocking.                                                                             | The quiet soak, then a red run on a planted failure | `git revert` (back to warn-only)           | Only after a `guard` and then a `soak`                                             |
| `expand`     | Add the new thing beside the old one, unused or switched off. Nothing existing changes.            | A test that the old path still works                | `git revert`; nothing reads the new thing  |                                                                                    |
| `dual-write` | Write every new change to both places. The old place stays the source of truth.                    | A test of both writes, and of a failed new write    | `git revert`; old is still complete        | Kind PR                                                                            |
| `backfill`   | Copy existing data to the new place: idempotent, resumable, throttled, old data untouched.         | The run's counts, then a parity `observe`           | Re-run, or empty the new place; old intact | Human; only after an `observe` (the dry run) in the same phase                     |
| `switch`     | Turn the new path on for exactly one target.                                                       | The named signal after the flip                     | Switch back                                | Human; only after an `observe` (dry run or readiness check) in the same phase      |
| `move`       | Move one batch of callers or readers to the new path. The old path keeps working.                  | The callers' tests                                  | `git revert`                               | Kind PR                                                                            |
| `soak`       | Wait a fixed time, or for a release to reach prod, watching named signals.                         | The signal links and the end date                   | The previous step's way back               | Kind Wait (and every Wait is a `soak`)                                             |
| `contract`   | Remove the old thing, once nothing reads it and no rollback can land on it.                        | The query showing no use, then the release          | Named exactly: roll forward, or restore    | Human; only after a `soak`, with no step that goes live between it and the removal |
| `cleanup`    | Remove migration scaffolding (switches, dual writes, warn-only checks) and finish the docs.        | Green checks                                        | `git revert`                               |                                                                                    |

Also enforced for every plan: a step with `Live write: Yes` is Human; a step whose files touch the
plan's Prod path is Human and Done needs prod; every step resolves a way back; every live write log
row names its dry run and the human who approved it; a live-write step is done only with its
write-log row; dropping a step needs a named human, and a dropped step no longer counts as the
`observe`, `guard` or `soak` a later step waits for; and no step starts, closes or passes `verify`
while an active health check fails.

## Recipes

The order below is the point. Skipping a row is how each guarantee gets broken.

**Move data to a new place** (column, table, store, provider):
`decide` → `observe` (inventory readers and writers) → `expand` (new place, empty) → `dual-write` →
`observe` (backfill dry run) → `backfill` → `observe` (parity) → `guard` (parity check, warn-only) →
`observe` (readiness) → `switch` reads, one target at a time → `soak` → `move` remaining readers →
`soak` past the rollback window → `contract` (stop the old write, then in a later step remove the old
place) → `cleanup`.

**Replace a library, component or API across many callers:**
`decide` → `observe` (count the callers; that count is the health check) → `expand` (the new one beside
the old, plus an adapter if shapes differ) → `guard` (lint or test that stops new uses of the old one,
warn-only) → `move` one batch per step → `soak` → `enforce` the guard → `soak` → `contract` (delete the
old one) → `cleanup`.

**Replace a tool on the deploy path** (migrator, build, CI gate):
`decide` → `observe` (what every environment holds today) → `guard` (ordered deploys: a failure delays
a release and never serves new code on old state) → `expand` (new tool dark, the system's own state
picks the engine) → `observe` (dry run per target) → `switch` one target at a time, prod last → `soak`
a release → `contract` (old tool) → `cleanup`.

**Move a service or its infrastructure:**
`decide` → `expand` (new home, no traffic) → `observe` (rehearsal on a copy) → `dual-write` or
replicate → `observe` (parity) → `switch` a small share of traffic → `soak` → `switch` the rest →
`soak` past the rollback window → `contract` (old home) → `cleanup`.

**Rename something** is never one step: `expand` the new name, `dual-write`, `backfill`, `move` the
readers, `soak`, `contract` the old name.

## Cutting a migration into safe steps

Given a goal or an existing plan of any shape:

1. **Name the end state and what never changes.** One sentence each. Everything not in the first is out
   of scope.
2. **Write the ground truth** (safety.md): every consumer, every environment, every place the data
   lives, how a release and a rollback reach prod, and the rollback window. Mark each fact verified or
   assumed. Every assumed fact becomes a phase 0 `decide` or `observe` step and an open question.
3. **List the changes**, then pick the recipe for each. Write out every row of the recipe as its own
   step. Do not merge rows to make the plan shorter: a long plan of Low steps is the goal.
4. **Rate each step after its safeguards.** For anything above Low, apply a lever and split again.
   Repeat until every step is Low. If a step cannot be made Low, stop and say so to the human: that
   migration is not safe yet, and the plan must not pretend otherwise.
5. **Give every step its proof, its own way back and its files.** A step whose way back differs from
   its neighbours is where a phase ends.
6. **Group steps into phases by way back**, and write each phase's gate: the condition, checkable by
   someone who was not there, that must hold before the next phase starts.
7. **Mark the human points:** every live write, switch, removal, prod-path change and decision. Those
   are the only places a human is asked; everything else an agent runs alone.
8. **Write the health checks** as scripts in the migration's `checks/` folder
   ([the check contract](./format.md#checks)): `remaining`, which measures how much of the old thing
   is left (the migration is over at zero), and one per guarantee at stake that would show it broken.
   Give each the step it is true `From`. The script then runs them before every step starts and
   closes, so no agent has to remember to look.
9. **Fill the safety contract** with how each guarantee is kept and what checks it.
10. **Run `validate`, then have the plan attacked:** give the folder to a fresh reviewer (a subagent
    with no context, or a second model) and ask for the step that breaks a guarantee. Fold each
    finding in as a decision-log entry. A human approves the plan PR before step one starts.
