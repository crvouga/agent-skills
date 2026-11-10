# Safety: how this migration keeps its guarantees

Every rule here applies to every PR in this migration. If a rule cannot be met, the PR stops and the
reason goes under **Blockers** in [progress.md](./progress.md). The five guarantees and what each
means are in [the safety contract]({{SAFE_STEPS}}#the-safety-contract); this file says how they hold
here.

## The ground we are protecting

Facts the rules depend on, with the date each was verified. Re-verify a fact before relying on it,
and fix it here if it changed.

- TODO(every consumer of the old thing: services, jobs, scripts, other teams, third parties)
- TODO(every environment and every place the data lives)
- TODO(how a release reaches prod and how a rollback happens, and how old an image a rollback can land on)

## Invariants

### S1: TODO(name the invariant)

TODO(the rule, the reason, and the check that enforces it)

## Compatibility

Which versions must work together at each point, so that a rollback and a half-finished deploy are
both safe.

| While                    | Old code on new state | New code on old state |
| ------------------------ | --------------------- | --------------------- |
| TODO(phase or step span) | TODO(why it works)    | TODO(why it works)    |

## Failure modes

What can go wrong at each kind of step, how it is noticed and what happens next. A failure that
would reach a user is a reason to split the step, not a row here.

| Failure           | Noticed by            | What happens            | Way back       |
| ----------------- | --------------------- | ----------------------- | -------------- |
| TODO(the failure) | TODO(check or signal) | TODO(the worst outcome) | TODO(the undo) |

## The way back at every point

| Point in the plan        | Way back                                  | Until              |
| ------------------------ | ----------------------------------------- | ------------------ |
| TODO(phase or step span) | TODO(revert, switch back or roll forward) | TODO(when it ends) |
