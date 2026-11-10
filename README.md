# agent-config

Reusable agent skills maintained in this repository:

| Skill | Purpose |
|---|---|
| [autopilot](skills/autopilot/SKILL.md) | Complete an unattended task through implementation and a green, merge-ready PR, with resumable checkpoints. |
| [pr-green](skills/pr-green/SKILL.md) | Repair and verify a GitHub PR through merge readiness, stopping before merge. |
| [safe-migration](skills/safe-migration/SKILL.md) | Plan a multi-PR migration as small Low-risk steps, run exactly the next one, and report its health. |

Each skill's `SKILL.md` defines its workflow and scope; `agents/openai.yaml` supplies
discovery metadata. PR green includes a standard-library Python helper and an
[operations reference](skills/pr-green/references/operations.md) for setup and CLI use.
Editing a skill does not invoke its workflow or update installed copies.

Autopilot is a superset of pr-green: it loads and follows the full PR workflow for
repository changes, then adds unattended execution, recovery, and checkpointing.
Keep both skill folders installed as siblings, including pr-green's helper and
references. Repository tasks finish with verified PR readiness unless the user
explicitly requests a narrower deliverable. Non-repository tasks retain their own
acceptance criteria; neither skill merges PRs by default.

Safe migration keeps everything about a migration in the target repository, under
`.safe-migrations/<name>/`: the plan, the progress record, and the read-only scripts
that check the system. Its dependency-free Node helper
(`skills/safe-migration/scripts/safe-migration.mjs`) does the bookkeeping and refuses
steps that are out of order, unapproved, out of scope, or started while a health check
fails. [safe-steps.md](skills/safe-migration/references/safe-steps.md) defines the safety
contract and step patterns; [format.md](skills/safe-migration/references/format.md)
defines the folder. It is independent of the other two skills.

Run the offline helper tests with Python 3.10+, Node 20+ and Git:

```sh
python3 -m unittest discover -s tests -v
python3 skills/pr-green/scripts/pr-green --help
node --test tests/safe-migration.test.mjs
node skills/safe-migration/scripts/safe-migration.mjs --help
git diff --check
```

Tests use mocked GitHub responses and temporary local repositories/installations.
They do not contact GitHub or change installed skills. Also validate each skill with
the skill-creator validator when available, and check realistic workflow decisions:
authorization boundaries, interrupted runs, concurrent changes, missing evidence,
and the distinction between successful commands and a completed task.
