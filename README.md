# agent-skills

Reusable agent skills. This repository is the source of truth: every install route
below reads from it, and CI checks each change before it reaches anyone.

| Skill | Purpose |
|---|---|
| [autopilot](skills/autopilot/SKILL.md) | Complete an unattended task through implementation and a green, merge-ready PR, with resumable checkpoints. |
| [bug-finder](skills/bug-finder/SKILL.md) | Run the app locally, hunt for bugs and security issues in a headless browser, and file GitHub issues with evidence and fix instructions. Finds only; never fixes. |
| [pr-green](skills/pr-green/SKILL.md) | Repair and verify a GitHub PR through merge readiness, stopping before merge. |

## Install

Pick the route that matches your agent. Each one installs whole skill folders, so
bundled scripts, references, and sibling skills come along.

**Claude Code (plugin).** Installs every skill as one plugin, so autopilot always
finds pr-green next to it:

```sh
claude plugin marketplace add crvouga/agent-skills
claude plugin install crvouga-skills@crvouga-skills
```

Or inside a session: `/plugin install crvouga-skills --marketplace crvouga/agent-skills`.
Skills are then named `/crvouga-skills:pr-green` and so on. To give a whole team the
plugin, commit this to the project's `.claude/settings.json`; each teammate then runs
the install command above once with `--scope project`:

```json
{
  "extraKnownMarketplaces": {
    "crvouga-skills": { "source": { "source": "github", "repo": "crvouga/agent-skills" } }
  },
  "enabledPlugins": { "crvouga-skills@crvouga-skills": true }
}
```

**Codex, Cursor, Claude Code, and other agents (copied into a project).** Uses the
open [`skills`](https://github.com/vercel-labs/skills) CLI (Node 22.20+). It copies the
skills into `.agents/skills/`, links them into `.claude/skills/`, and records the source
in `skills-lock.json`. Commit all three so everyone on the project gets the same skills.

```sh
npx skills add crvouga/agent-skills --skill '*' -a claude-code codex -y
npx skills add crvouga/agent-skills --skill pr-green --skill autopilot -a claude-code codex -y
```

Add `-g` to install for your user instead of the project. Install autopilot together
with pr-green; autopilot reads pr-green's workflow from the sibling folder.

**Download.** Each [release](https://github.com/crvouga/agent-skills/releases) has one
zip per skill (the format claude.ai accepts as an upload), `agent-skills.tar.gz` with
every skill, and `SHA256SUMS`. The newest is always at
`https://github.com/crvouga/agent-skills/releases/latest/download/<skill>.zip`.

## Update

- **Claude Code plugin:** `claude plugin marketplace update crvouga-skills`, then
  `claude plugin update crvouga-skills@crvouga-skills`. Or turn on auto-update under
  `/plugin` > Marketplaces > crvouga-skills. The plugin has no fixed version, so every
  merge to `main` is a new version.
- **`npx skills`:** `npx skills update -y`. To get updates as pull requests, copy
  [templates/update-agent-skills.yml](templates/update-agent-skills.yml) into the
  project's `.github/workflows/`. It runs weekly and opens a PR when a skill changed.
- **Downloads:** pick a newer release.

Editing a skill here does not change installed copies until they update.

## How the skills fit together

Each skill's `SKILL.md` defines its workflow and scope; `agents/openai.yaml` supplies
Codex discovery metadata. PR green includes a standard-library Python helper and an
[operations reference](skills/pr-green/references/operations.md) for setup and CLI use.

Bug finder is independent of the other two. It includes a
[GitHub Actions workflow template](skills/bug-finder/assets/github-workflow.yml) for
scheduled runs in an application repository.

Autopilot is a superset of pr-green: it loads and follows the full PR workflow for
repository changes, then adds unattended execution, recovery, and checkpointing.
Keep both skill folders installed as siblings, including pr-green's helper and
references. Repository tasks finish with verified PR readiness unless the user
explicitly requests a narrower deliverable. Non-repository tasks retain their own
acceptance criteria; neither skill merges PRs by default.

## Maintain

See [AGENTS.md](AGENTS.md) for the rules agents and people follow when changing this
repository. In short: add a skill as `skills/<name>/` with `SKILL.md` and
`agents/openai.yaml`, add its row to the table above, and open a PR.

Run the checks with Python 3.10+ and Git:

```sh
python3 scripts/validate_skills.py
python3 -m unittest discover -s tests -v
git diff --check origin/main
```

`validate_skills.py` checks each skill's frontmatter, metadata, links, and script
permissions, and that every skill is listed in this README and published by the
plugin manifest. Tests use mocked GitHub responses and temporary local
repositories/installations; they do not contact GitHub or change installed skills.
Also check realistic workflow decisions: authorization boundaries, interrupted runs,
concurrent changes, missing evidence, and the distinction between successful
commands and a completed task.

CI ([ci.yml](.github/workflows/ci.yml)) runs those checks on every PR, validates the
Claude Code plugin manifest, and installs the skills through both the plugin and
`npx skills` routes to confirm every skill arrives intact. When a merge to `main`
changes a skill, [release.yml](.github/workflows/release.yml) reruns CI and
publishes the next patch release. Run the Release workflow by hand to publish a
minor or major version instead.
