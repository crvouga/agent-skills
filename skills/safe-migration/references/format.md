# Migration folder format

What `safe-migration` reads and writes. Every migration is one folder, `.safe-migrations/<name>/`,
with exactly these files. `safe-migration init <name> --title "..." --prefix XX` scaffolds it from
[templates/](./templates/); never create one by hand.

| File                 | Role                                                                             | Who changes it                                           |
| -------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `README.md`          | Start here: goal, rules in one screen, and the generated **Status** block        | Humans (prose); the script (the block, in every step PR) |
| `plan.md`            | The safety contract and every step: work, proof, risk, pattern, way back, files  | Amendment PRs only, approved by a human                  |
| `progress.md`        | Each step's status, gates, blockers, decisions, the live write log, evidence     | The script, in the PR that does the step                 |
| `safety.md`          | The facts the plan depends on, invariants, failure modes, the way back per point | Steps whose scope lists it                               |
| `checks/<check>.mjs` | One read-only script per health check (`.mjs`, `.ts` or `.sh`)                   | Steps whose scope lists it; otherwise an amendment       |
| `design.md`          | Optional: the target design                                                      | Steps whose scope lists it                               |

Nothing else belongs in the folder, and nothing about the migration belongs outside it.
`.safe-migrations/README.md` is the generated list of every migration; it changes only when one is
added, so step PRs in different migrations never conflict on it.

The name is the folder name: lowercase letters, digits and dashes. Step branches are
`migration/<name>/<step-id-lowercase>`.

## README.md

Sections, in this order: `## Status`, `## Goal`, `## Files`, `## The rules in one screen`,
`## How agents work on this`.

- A `# Title`; `list`, `health` and the index show it.
- The status block: the two lines `<!-- safe-migration:status:start -->` and
  `<!-- safe-migration:status:end -->` under `## Status`. The script writes everything between them
  from plan.md and progress.md (position, way back right now, phases, the guarantees) after every
  `start`, `update` and `gate`. `validate` fails when it is missing or out of date, so the README
  never lies about where the migration stands. A step PR may change README.md only inside this block.

## plan.md

Sections: `## Safety contract`, `## How risk is rated`, `## Phases at a glance`, one
`## Phase <n>: <name>` per phase, `## Prod path`, `## Health checks`, `## Step scopes`.

- **Safety contract:** a three-column table (`Guarantee`, `How this migration keeps it`,
  `Checked by`) with one row for each of `Zero downtime`, `Zero data loss`, `Backwards compatible`,
  `Small uniform steps`, `Low risk`. No cell may be empty. Links use `./plan.md#anchor`, never a
  bare `#anchor`, because the README shows the same rows. A guarantee the migration cannot touch
  starts its `Checked by` with `Not at stake:` and the reason.
- **Phases:** headings `## Phase <n>: <name>`, numbered 0, 1, 2 with none skipped, and under
  `## Phases at a glance` a table whose header starts `Phase` and has a `Way back` column, one row
  per phase.
- **Steps:** table rows whose first cell is a step id, `<PREFIX>-<phase>.<n>` (for example
  `DB-1.3`), one prefix per migration, numbered 1, 2, 3 within a phase. The row order across the
  file is the order the steps run in. Columns: `Work`, `Proof`, `Live write` (starts `Yes` when the
  step writes to a live system), `Risk`. The step's rating is the last bold `**Low**`, `**Medium**`
  or `**High**` in the row.
- **Parallel steps:** the text `parallel with <id>` in a row lets both run at once.
- **Prod path:** one bullet per backticked glob of files whose change runs in a prod deploy path
  (the first backticked text in the bullet is the glob), or a line starting `None`. A section with
  neither fails `validate`. Every step whose scope touches one must be `Human: yes` and
  `Done needs prod: yes`; `done` on such a step needs `--prod-evidence`.
- **Health checks:** one row per script in `checks/`:

  | Check     | Proves                            | Guarantee      | Needs     | From   |
  | --------- | --------------------------------- | -------------- | --------- | ------ |
  | remaining | How much of the old thing is left | Progress       | nothing   | start  |
  | parity    | Old and new hold the same data    | Zero data loss | prod read | XX-1.5 |
  - `Check`: the script's name without its extension, lowercase and dashed.
  - `Guarantee`: `Progress`, `Zero downtime`, `Zero data loss` or `Backwards compatible`.
  - `Needs`: `nothing` (the script runs it by itself; blank and `none` mean the same), or the access
    it needs, such as `stack` or `prod read` (it runs only by name, `check <name> <check>`, after a
    human agrees).
  - `From`: `start`, or the step that makes the check true. The check is active once that step is
    closed. That step cannot be marked done while the check fails; when the check needs access, the
    step's evidence must name the check and link its output instead.
  - Required: a `remaining` check (`Progress`, `nothing`, `start`), and at least one check for each
    of the three runtime guarantees that is at stake.

- **Step scopes:** one row per step:

  | Step   | Kind | Pattern | Human | Done needs prod | Way back     | Files                       |
  | ------ | ---- | ------- | ----- | --------------- | ------------ | --------------------------- |
  | XX-1.1 | PR   | expand  | no    | no              | `git revert` | `packages/thing/src/new/**` |
  - `Kind`: `PR` (code or config), `Docs` (files inside this folder only, all starting `./`),
    `Action` or `Wait` (progress.md only, so `Files` is `none`).
  - `Pattern`: one of the [step patterns](./safe-steps.md#step-patterns).
  - `Human`: `yes` makes `start` refuse without `--approved-by`.
  - `Done needs prod`: `yes` means the step is marked done only after a prod run proves it.
  - `Way back`: how this step alone is undone.
  - `Files`: backticked globs (`*` within a folder, `**` across folders). `./` means the migration's
    folder (`./checks/**`, `./safety.md`). `progress.md` and the generated status are always allowed
    and `plan.md` never is. `PR` and `Docs` steps need at least one.

## Checks

A check is how the migration proves, without a human looking, how far it is and that a guarantee
still holds. Every check script follows the same contract:

- **Read-only.** It never writes to any system, live or local, and it is safe to run at any time and
  any number of times.
- **Exit code is the verdict:** 0 when healthy, anything else when not.
- **The last line of stdout is the reading**, one line a human can act on (`42 file(s) still use the
old client`, `0 rows differ`). `health` shows it.
- **Self-contained and fast:** run from the repo root as `node checks/<check>.mjs`,
  `node --import tsx checks/<check>.ts` or `bash checks/<check>.sh`, under two minutes, with
  `SAFE_MIGRATION` (the name) and `SAFE_MIGRATION_DIR` (the folder) in its environment.
- **Honest about access:** a check that reaches a stack, a database or a hosted service says so in
  `Needs`, reads live data only through the host repository's approved read-only access, and never
  prints a secret or user data.
- **No stubs:** a `TODO(...)` left in a check fails `validate`.

The script runs every active check that needs nothing before a step starts, before it is marked
done (including the checks that step activates), before a gate is recorded, in `verify`, in `next`
and in `health`. A failure refuses the action and makes the verdict `UNSAFE`.

## progress.md

Sections: `## Now`, `## How to update this file`, `## Blockers`, `## Phase gates`, `## Steps`,
`## Approvals`, `## Decision log`, `## Open questions`, `## Live write log`, `## Evidence log`.

- `## Now`: a two-column table with at least `Current phase`, `Next step` and `Last updated` rows.
  The script rewrites those three; other rows (switches, tickets) are the migration's own.
- `## Blockers`: `None.` or one bullet per blocked step, `- **<id>**: <what unblocks it>`.
- `## Phase gates`: a table `Phase | Gate | Met | Evidence`, one row per phase; `Met` is `yes` or
  `no`.
- `## Steps`: tables with header starting `Step` and columns `Status`, `PR`, `Ticket`, `Evidence`,
  `Updated`; other columns (such as `Work`, `Risk`) are allowed. A `Risk` column must match plan.md.
  Every plan step appears once, in plan order.
- Statuses: `todo`, `in-progress`, `blocked`, `done`, `dropped`. `done` needs Evidence; `dropped`
  needs Evidence naming the decision-log entry.
- `## Approvals`: a table `Date (UTC) | Step | Action | Approved by`. The script adds a `start` row
  when a step that needs a human starts and a `drop` row when any step is dropped. A started step
  that needs a human, or a dropped step, with no row fails `validate`.
- `## Approvals`, `## Decision log`, `## Live write log`, `## Evidence log`: append-only tables. A
  step PR may add rows, never change or remove them. The write log has a `Step`, a `Dry run` and an
  `Approved by` column; a row that leaves the last two empty fails `validate`, and so does a
  live-write step marked done with no row naming it.
- `## Open questions`: a table of facts the plan assumes; `health` counts its rows.

## safety.md

Sections: `## The ground we are protecting`, `## Invariants`, `## Compatibility`,
`## Failure modes`, `## The way back at every point`.

## What `validate` enforces

For every migration: the four files exist; the five-row safety contract; one step prefix; plan and
progress steps match in order; every step has a rating, a scope row, a valid kind, files (PR and
Docs) and a way back (its own or its phase's); live-write steps are Human; prod-path steps are Human
and Done needs prod; no step is started before its predecessors or its gate; done and dropped steps
have evidence; met gates have evidence; every live write log row has a dry run and an approver;
every started step that needs a human and every dropped step has its approver on record; a done
live-write step has its write-log row; the prod path is declared; every check row names a known
guarantee and step; every script in `checks/` has a row and every active row has a script; the
README status block and the index are current; no `TODO(...)` placeholder remains.

For every migration not listed in `.safe-migrations/legacy.json` (and for those too under
`--strict`), also the full contract: no file in the folder beyond the fixed set; every section above
is present; phases and steps are numbered in order; every step is rated Low, names a proof, names
its own way back and has a pattern; a Docs step lists only files in the folder and an Action or Wait
step lists none; the [pattern rules](./safe-steps.md#step-patterns) hold, counting only steps that
were not dropped; there is a `remaining` check and a check for every runtime guarantee at stake.

`.safe-migrations/legacy.json` is optional: a JSON array of the names of migrations that predate
this format and are held only to the first list. It exists so an old plan can be adopted without
rewriting it first, and it only shrinks: `validate --all` fails when a listed migration already
meets the full contract or no longer exists. Never add a new migration to it; protect the file with
code owners or a CI rule in the host repository.

## Starting a new migration

`safe-migration init`, then follow
[Cutting a migration into safe steps](./safe-steps.md#cutting-a-migration-into-safe-steps). Every
`TODO(...)` the scaffold leaves is a decision; `validate` fails until none is left.
