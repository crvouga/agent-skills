# {{TITLE}}

Start here. This folder is the single record of this migration: what is moving, the guarantees it
keeps, every step in order, and where it stands today. Every PR that is part of it links here.

## Status

<!-- safe-migration:status:start -->
<!-- safe-migration:status:end -->

## Goal

TODO(what moves from what to what, and why, in three sentences; then what stays exactly as it is)

## Files

| File                         | What it holds                                                                  | Read it when                        |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- |
| [progress.md](./progress.md) | Every step's status, the gates, blockers, decisions, the live write log        | Always, first                       |
| [plan.md](./plan.md)         | The safety contract, every step in order with its proof, risk and way back     | Before picking up or closing a step |
| [safety.md](./safety.md)     | The facts the plan depends on, the invariants, the failure modes, the way back | Before any change in this migration |
| [checks/](./checks/)         | One read-only script per health check; they run before every step              | When a check fails                  |

## The rules in one screen

Full text and reasons: [safety.md](./safety.md). A PR that breaks one of these does not merge.

- **S1** TODO(the first invariant, one line)

## How agents work on this

Use the [safe-migration skill]({{SKILL}}). Its script, `scripts/safe-migration.mjs` in the skill's
folder, says what to do now; do exactly that, then run it again:

```bash
SM="node <path to the skill>/scripts/safe-migration.mjs"
$SM next {{NAME}}              # the one thing to do now, with the exact command
$SM health {{NAME}}            # everything about where the migration stands
$SM verify {{NAME}} <step>     # before every push
```

- Steps run in the listed order, one PR (or one recorded action) each, inside the files the step's
  row in [plan.md's Step scopes](./plan.md#step-scopes) allows. Never combine steps.
- Never write to a live system or flip a switch without asking the human first, after a dry run, and
  log it in [progress.md](./progress.md#live-write-log).
- If a step cannot be done as written, or a fact here turns out wrong, stop: block the step and open
  a plan amendment PR. Never widen a step.
