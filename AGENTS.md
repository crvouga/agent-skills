# Working in this repository

This repository is the source of truth for the skills in `skills/`. Projects install
them from here through a Claude Code plugin, the `npx skills` CLI, or release
downloads (see [README.md](README.md)). Anything merged to `main` reaches those
installs, so keep `main` releasable.

## Layout

- `skills/<name>/SKILL.md`: the skill. Frontmatter `name` must equal the folder name
  (lowercase, digits, hyphens); `description` is required, at most 1024 characters,
  with no angle brackets.
- `skills/<name>/agents/openai.yaml`: Codex metadata. `default_prompt` must invoke
  `$<name>`.
- `skills/<name>/scripts/`, `references/`, `assets/`: optional. Scripts with a shebang
  must be executable. Link to files relative to the skill folder.
- `.claude-plugin/marketplace.json`: publishes everything under `skills/` as the
  `crvouga-skills` plugin. It has no skill list and no version on purpose: new skill
  folders are picked up automatically, and each commit is a new plugin version.
- `scripts/validate_skills.py`, `scripts/package_skills.py`: checks and release
  packaging, standard library only.
- `templates/`: files that other projects copy. They are not run here.

## Adding or changing a skill

1. Create or edit `skills/<name>/`. Skills that depend on each other refer to each
   other by sibling path (`../other-skill/SKILL.md`); every install route keeps the
   folders side by side.
2. Add or update the skill's row in the README table.
3. Run the checks below, then open a PR. Releases happen automatically after merge.

Renaming or deleting a skill breaks projects that installed it by name. Call that
out in the PR description.

## Checks

```sh
python3 scripts/validate_skills.py
python3 -m unittest discover -s tests -v
git diff --check origin/main
```

CI also validates the plugin manifest with `claude plugin validate . --strict` and
test-installs every skill through both routes. Tool versions used in CI are pinned in
`.github/workflows/ci.yml`; bump them deliberately.
