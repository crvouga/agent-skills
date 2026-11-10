# agent-config

Reusable agent skills maintained in this repository:

| Skill | Purpose |
|---|---|
| [autopilot](skills/autopilot/SKILL.md) | Complete an unattended task through implementation and a green, merge-ready PR, with resumable checkpoints. |
| [bug-finder](skills/bug-finder/SKILL.md) | Run the app locally, hunt for bugs and security issues in a headless browser, and file GitHub issues with evidence and fix instructions. Finds only; never fixes. |
| [pr-green](skills/pr-green/SKILL.md) | Repair and verify a GitHub PR through merge readiness, stopping before merge. |

Each skill's `SKILL.md` defines its workflow and scope; `agents/openai.yaml` supplies
discovery metadata. PR green includes a standard-library Python helper and an
[operations reference](skills/pr-green/references/operations.md) for setup and CLI use.
Editing a skill does not invoke its workflow or update installed copies.

Bug finder is independent of the other two. It includes a
[GitHub Actions workflow template](skills/bug-finder/assets/github-workflow.yml) for
scheduled runs in an application repository.

Autopilot is a superset of pr-green: it loads and follows the full PR workflow for
repository changes, then adds unattended execution, recovery, and checkpointing.
Keep both skill folders installed as siblings, including pr-green's helper and
references. Repository tasks finish with verified PR readiness unless the user
explicitly requests a narrower deliverable. Non-repository tasks retain their own
acceptance criteria; neither skill merges PRs by default.

Run the offline helper tests with Python 3.10+ and Git:

```sh
python3 -m unittest discover -s tests -v
python3 skills/pr-green/scripts/pr-green --help
git diff --check
```

Tests use mocked GitHub responses and temporary local repositories/installations.
They do not contact GitHub or change installed skills. Also validate each skill with
the skill-creator validator when available, and check realistic workflow decisions:
authorization boundaries, interrupted runs, concurrent changes, missing evidence,
and the distinction between successful commands and a completed task.
