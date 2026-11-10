---
name: safe-migration
description: Plan, run and report on a multi-PR migration (data, schema, library, service, infrastructure, deploy tooling) that must be completely safe, meaning zero downtime, zero data loss, backwards compatible and cut into small uniform Low-risk steps. Everything about a migration lives in one folder, .safe-migrations/NAME/, always with the same files (README.md, plan.md, progress.md, safety.md, checks/). The bundled script says the one thing to do next and refuses anything out of order, unapproved, out of scope, above Low risk, or started while a health check fails. Use for /safe-migration, $safe-migration, or requests to plan a migration, make a migration safe, do the next migration step, report where a migration stands, or amend a migration plan. Never merges and never writes to a live system without a named human's approval; inspecting or editing this skill does not authorize running a migration step.
---

# Safe migration

Every migration follows one formula. Do not improvise on it: the same folder, the same files, the
same sections, the same step patterns, the same loop. What "safe" means and how a migration is cut
into steps: [references/safe-steps.md](references/safe-steps.md). The exact file format:
[references/format.md](references/format.md).

Requires Node 20+ and Git; `gh` is optional (`health --prs`). Locate
`scripts/safe-migration.mjs` relative to this file; `SM` below means `node` plus its absolute
path. Run it from inside the target repository. It has no dependencies. When the repository has
Prettier installed, the script formats the files it writes.

## The folder (always the same)

```text
.safe-migrations/
  README.md            generated list of every migration
  legacy.json          optional: older migrations not yet held to the full contract
  <name>/
    README.md          start here: goal, rules in one screen, generated status block
    plan.md            the safety contract and every step: work, proof, risk, pattern, way back, files
    progress.md        each step's status, gates, blockers, approvals, decisions, the live write log
    safety.md          the facts the plan depends on, invariants, failure modes, the way back
    checks/<check>.mjs one read-only script per health check (also .ts or .sh)
```

- **Everything a migration writes about itself goes in its folder**: instructions, findings,
  decisions, progress, logs, and every script that verifies progress or the state of the system.
  Never put a migration note, a status file or a verification script anywhere else (not a docs
  folder, not a tooling folder, not the PR description alone, not a scratch file).
- A migration is named by its folder name, lowercase and dashed (`orders-to-postgres`). Every
  command takes that name.
- `README.md`'s status block and `.safe-migrations/README.md` are generated. Never edit them by
  hand. On a merge conflict in a status block or in the "Now" table of progress.md, take either
  side and run `$SM render <name>`: it rewrites both from the step rows.

## The loop (always the same)

```bash
git fetch origin
$SM next <name>      # prints "Do now: <ACTION>", why, and the exact command to run
```

Do exactly what `next` says, then run `next` again. It always answers with one of:

| `next` says      | You do                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `FIX`            | The plan, progress, README or checks disagree. Fix what it lists, or amend. Nothing else.  |
| `RENDER`         | Run the command it prints.                                                                 |
| `FIX CHECKS`     | A health check fails: the system is not in the state the plan assumes. Find out why first. |
| `UNBLOCK <step>` | Resolve the recorded blocker, or open the amendment it asks for.                           |
| `RESUME <step>`  | Check the step's PR link (it may be another agent's), then continue [the step](#one-step). |
| `WAIT FOR PROD`  | Find the production run that proves the step, then run the command it prints.              |
| `ASK A HUMAN`    | Ask the one question it prints. Start only with the name of the human who said yes.        |
| `START <step>`   | Run the command it prints, then do [the step](#one-step).                                  |
| `RECORD GATE`    | Prove the gate's condition, then run the command it prints.                                |
| `NOTHING`        | Report that the migration is complete, or what it is waiting for.                          |

The other commands:

```bash
$SM list                                  # every migration, its verdict and its next step
$SM health [name] [--prs]                 # the full report; runs the active checks that need nothing
$SM check <name> [check...]               # run the health checks (a named one may need access)
$SM init <name> --title "..." --prefix XX # scaffold .safe-migrations/<name>/
$SM patterns                              # the guarantees and the step patterns
$SM validate <name> | --all               # everything agrees and meets the contract
$SM render [name]                         # rewrite the generated status blocks and the list
$SM brief <name> <step>                   # work, proof, risk, pattern, way back, files, branch
$SM start <name> [step] [--approved-by N] # refuses unless the step is next and every check passes
$SM update <name> <step> --status done --pr <url> --evidence "<links>"
$SM update <name> <step> --status blocked --blocker "<what unblocks it>"
$SM gate <name> <phase> --evidence "<links>"
$SM verify <name> <step>                  # only allowed files changed, and every active check passes
$SM pr-body <name> <step>                 # the "Migration step" section for the PR description
```

`verify` and `health` compare with the remote's default branch; pass `--base <ref>` or set
`SAFE_MIGRATION_BASE` when the trunk is another branch. Pick the job from the request: a question
about state is **Health**; a new migration or "make this safe" is **Plan**; "next", "continue" or a
step id is **the loop**; a step that cannot be done as written is **Amend**. With no argument, run
`$SM health` and offer `next`. Inspecting or editing this skill does not authorize running a
migration step.

## The contract (never broken, whoever asks)

Every migration keeps five guarantees at every step: **zero downtime**, **zero data loss**,
**backwards compatible**, **small uniform steps**, **low risk**
([definitions](references/safe-steps.md#the-safety-contract)). They hold because of these rules:

1. **Only what `next` says.** Never start a step the script refuses. Never do part of a later step,
   a "while I'm here" fix, a refactor, or extra tests outside the step's work. If the person asks
   for more, say it is outside the plan and offer an amendment.
2. **Only the allowed files.** `verify` must pass before every push. If the step truly needs another
   file, stop: record a blocker and propose an amendment. Never widen the scope inside a step's PR.
3. **plan.md does not change in a step PR.** Plan changes are amendment PRs, approved by a human.
4. **Only this step's row in progress.md** (plus "Now", "Blockers", new rows in the append-only logs,
   and the generated status the script rewrites).
5. **No step above Low.** A step that turns out riskier is split or given a safeguard by amendment
   until it is Low. Never go ahead on it. (A migration listed in `legacy.json` may carry a step
   rated above Low; it starts only with `--risk-approved-by` and a named human's approval in this
   session.)
6. **A named human approves every step marked Human, in this session:** every live write, switch
   flip, removal, prod-path change and decision. Ask the one question `next` prints, then pass
   `--approved-by` with their name; the script records it in the Approvals log. An earlier or
   general go-ahead does not count. Dropping any step also needs a named human
   (`--status dropped --approved-by`), because a dropped step is a safeguard removed from the plan;
   a closed step is never reopened or changed except by an amendment.
7. **Dry run before every live write, and log it.** The same command runs read-only first and says
   exactly what the write will do. Ask before each write, even in a step whose start was already
   approved. The write, its dry run and its approver go in the live write log, in a row that names
   the step; `validate` fails a row without them, and a live-write step cannot be done without its
   row.
8. **No step is done without its proof.** The proof is what plan.md names, linked in Evidence. A
   step whose scope says _Done needs prod_ stays `in-progress` until a production run proves it.
9. **No step starts or closes while a health check fails.** The script runs the active checks that
   need nothing before `start`, before `done`, before a gate and in `verify`, and refuses on a
   failure. It cannot run a check that needs access: a step that makes one active closes only when
   its evidence names that check and links its output. Never skip, weaken, delete or edit a check
   to get past it: a failing check means the system or the plan is wrong, and that is a blocker or
   an amendment.
10. **Every step has a way back, and you know it before you start.** `next` and `brief` print it.
    If it is no longer true, stop and amend.
11. The migration's own rules (its `safety.md`) and the repository's own instructions (its
    `AGENTS.md`, `CLAUDE.md` or contributing guide) apply on top. Where they are stricter, they
    win.

## One step

One run does **one step**, always in this order:

1. **Read:** the migration's README and safety.md, the parts of the design the step touches, and
   the brief `next` printed. State the step, its pattern, risk, way back and allowed files in one
   short message, then continue without waiting unless `next` said `ASK A HUMAN`.
2. **Branch** from the remote's default branch as `migration/<name>/<step-id-lowercase>` (the brief
   prints it). If this checkout is dirty or on another branch, do not switch it: make a separate
   worktree. Never stash, discard or commit someone else's changes.
3. **Start** with the command `next` printed. A refusal is final for this run: report it with the
   script's reason and stop. It refuses when the step's branch already exists on origin: another
   agent has it, so read its PR instead of starting a second copy.
4. **Do the work**, by kind:
   - **PR**: implement exactly the step's work inside the allowed files, test first where the
     repository asks for it, running the repository's own checks while iterating.
   - **Docs**: write the finding or decision into the allowed files of the migration's folder and
     the decision log.
   - **Action**: dry run first, show the human what it will do, get approval when marked Human, run
     it, and add the write-log row. The PR changes only the migration's folder.
   - **Wait**: confirm the condition happened (a release reached production, a soak ended quietly)
     and link the signals watched.
5. **Prove it** with the proof the step names, and run `$SM check <name>`. A check that needs access
   runs by name (`$SM check <name> <check>`) only after the human agrees; link its output as
   evidence. If you cannot prove it, the step is not done: `--status blocked --blocker "..."`.
6. **Record:** `$SM update <name> <step> --status done --evidence "<links>" --pr <url>` (after the
   PR exists, update and push again). Add the decision-log and evidence-log rows the step produced.
7. **Verify and open the PR:** `$SM verify <name> <step>` must print OK; treat its size warning as
   a reason to split by amendment unless the diff is generated or mechanical. Commit and open the
   PR the way the repository asks (its template, its ticket rules, its required checks), with
   `$SM pr-body <name> <step>` pasted into the description. Never merge.
8. **Report** in three lines: the step and its outcome, the PR link, and what `$SM next <name>` says
   now, including any approval it will need.

## Health

`$SM health <name>` (after `git fetch origin`; `--ref <ref>` reads that ref's record rather than
this checkout's, without running any check script). Relay the verdict, the position, what is next
and who must approve it, the way back right now, each health check's reading, and every finding.
`--prs` adds the open PRs.

Verdicts: `HEALTHY`; `ATTENTION` (a blocker, a stale step, a gate to record, contract gaps in a
migration listed in `legacy.json`); `UNSAFE` (the files disagree, the contract is broken, or a
health check fails: fix that before any step); `COMPLETE`. Never soften a verdict when relaying it.

## Plan

Turn a goal or a rough plan into `.safe-migrations/<name>/`. Follow
[Cutting a migration into safe steps](references/safe-steps.md#cutting-a-migration-into-safe-steps);
always in this order:

1. **Read first:** the code and docs of what is moving, its consumers, how it deploys and rolls
   back. Use a read-only search subagent for a wide inventory when one is available. Ask the human
   only what the repository cannot answer.
2. **Scaffold:** `$SM init <name> --title "<from> to <to>" --prefix <XX>`, on a branch from the
   remote's default branch. Never create the folder or its files by hand, and never add a file the
   scaffold does not have except a check script or `design.md`.
3. **Write safety.md** from what you read. Each fact is verified or assumed; each assumption becomes
   a phase 0 step and an open question.
4. **Write the steps** with the recipe for each change, one pattern per step, rated after its
   safeguards. Split anything above Low. If something cannot be made Low, stop and tell the human:
   the migration is not safe yet.
5. **Write the checks**: `checks/remaining` (how much of the old thing is left) first, then one per
   guarantee at stake, each a row in plan.md's Health checks with the step it is active `From`.
   [The check contract](references/format.md#checks).
6. **Fill in the rest:** each step's proof, way back and files; the phases and their gates; the prod
   path; the safety contract; the README goal and rules. Keep every section the scaffold has.
7. **Check:** `$SM validate <name>` says "meets the full safety contract" and `$SM next <name>`
   says `START`.
8. **Have it attacked** by a reviewer with no context (a fresh subagent or a second model, given
   only the folder): which step breaks a guarantee, which fact is unproven, which way back is not
   real, which check would not notice. Fold findings in, each as a decision-log row.
9. **Open a draft PR** for the plan and ask a human to approve it. No step starts before it merges.

## Amend

When a step cannot be done as written (wrong scope, a missing step, a fact that changed, a step
riskier than Low, a check that is wrong), the fix is a plan change, not a bigger step:

1. Record a blocker: `$SM update <name> <step> --status blocked --blocker "amendment needed: <why>"`.
2. On its own branch, change `plan.md` (and `progress.md` rows to match: new steps as `todo`, in the
   same order), add a decision-log row, and keep every step Low with its pattern, proof and way back.
3. `$SM validate <name>`, `$SM render` and `$SM verify <name> --amendment` must pass (the
   migration's folder and decision records only; never a step's status, evidence or a log row).
4. Open a draft PR for the amendment and ask a human to approve it. Never implement the amended
   work in the same PR.

## Wiring it into a repository

Do these once, when the first migration is planned; each is the repository owner's decision:

- **CI:** run `$SM validate --all` on every pull request. It needs only Node and the checkout, and
  fails a PR that breaks any migration's record: a guarantee with no mechanism, steps out of order,
  a step started before its predecessors or gate, a done step without evidence, an unrecorded
  approval, a live write with no dry run or approver, a check script with no row or an active row
  with no script, a stale generated status, or a contract gap.
- **Deploys:** when pushes to the trunk start deploys, ignore `.safe-migrations/**` there, so a
  record-only change deploys nothing.
- **Ownership:** make a human own `.safe-migrations/*/plan.md`, `.safe-migrations/*/checks/` and
  `.safe-migrations/legacy.json` (code owners or a branch rule), since those decide what is allowed
  and what "healthy" means.
- `verify` runs on the agent's machine, not in CI: CI proves the record is consistent, and the
  reviewer of a step PR checks that its diff matches the "Allowed files" the PR body lists.
