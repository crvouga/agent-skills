#!/usr/bin/env python3
"""Check that every skill in skills/ is well formed and listed everywhere it is published.

Standard library only, so it runs the same locally and in CI:

    python3 scripts/validate_skills.py
"""
import argparse
import json
from pathlib import Path
import re
import sys

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_NAME = 64
MAX_DESCRIPTION = 1024
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
SKIP_LINK = ("http://", "https://", "mailto:", "#")


def frontmatter(text):
    """Return the top-level `key: value` pairs of a SKILL.md frontmatter block, or None."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    fields = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return fields
        match = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line)
        if match:
            fields[match.group(1)] = match.group(2).strip().strip("\"'")
    return None


def skill_dirs(root):
    base = root / "skills"
    return sorted(p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")) if base.is_dir() else []


def check_links(path, root, errors):
    in_code = False
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.lstrip().startswith("```"):
            in_code = not in_code
        if in_code:
            continue
        for target in LINK_RE.findall(line):
            if target.startswith(SKIP_LINK):
                continue
            resolved = (path.parent / target.split("#", 1)[0]).resolve()
            if not resolved.exists():
                errors.append(f"{path.relative_to(root)}:{number}: broken link to {target}")


def check_skill(skill, root, errors):
    rel = skill.relative_to(root)
    doc = skill / "SKILL.md"
    if not doc.is_file():
        errors.append(f"{rel}: missing SKILL.md")
        return
    meta = frontmatter(doc.read_text(encoding="utf-8"))
    if meta is None:
        errors.append(f"{rel}/SKILL.md: missing or unterminated --- frontmatter")
        return
    name, description = meta.get("name", ""), meta.get("description", "")
    if name != skill.name:
        errors.append(f"{rel}/SKILL.md: name {name!r} must match folder name {skill.name!r}")
    if not NAME_RE.match(skill.name) or len(skill.name) > MAX_NAME:
        errors.append(f"{rel}: folder name must be lowercase letters, digits, and single hyphens, at most {MAX_NAME} characters")
    if not description:
        errors.append(f"{rel}/SKILL.md: description is required")
    elif len(description) > MAX_DESCRIPTION:
        errors.append(f"{rel}/SKILL.md: description is {len(description)} characters; the limit is {MAX_DESCRIPTION}")
    elif "<" in description or ">" in description:
        errors.append(f"{rel}/SKILL.md: description must not contain angle brackets")

    agent = skill / "agents/openai.yaml"
    if not agent.is_file():
        errors.append(f"{rel}: missing agents/openai.yaml (Codex discovery metadata)")
    else:
        text = agent.read_text(encoding="utf-8")
        for key in ("interface:", "display_name:", "short_description:", "default_prompt:"):
            if key not in text:
                errors.append(f"{rel}/agents/openai.yaml: missing {key[:-1]}")
        if f"${skill.name}" not in text:
            errors.append(f"{rel}/agents/openai.yaml: default_prompt should invoke ${skill.name}")

    for path in sorted(skill.rglob("*")):
        if "__pycache__" in path.parts or path.suffix == ".pyc":
            continue  # local Python cache, ignored by .gitignore and by packaging
        if path.is_file() and path.suffix == ".md":
            check_links(path, root, errors)
        elif path.is_file() and path.read_bytes()[:2] == b"#!" and not path.stat().st_mode & 0o111:
            errors.append(f"{path.relative_to(root)}: has a shebang but is not executable")


def check_readme(root, names, errors):
    readme = root / "README.md"
    if not readme.is_file():
        errors.append("README.md: missing")
        return
    listed = set(re.findall(r"\]\(skills/([^/)]+)/SKILL\.md\)", readme.read_text(encoding="utf-8")))
    for name in sorted(set(names) - listed):
        errors.append(f"README.md: skill {name!r} is not listed")
    for name in sorted(listed - set(names)):
        errors.append(f"README.md: lists {name!r}, which has no folder in skills/")
    check_links(readme, root, errors)
    agents = root / "AGENTS.md"
    if agents.is_file():
        check_links(agents, root, errors)


def check_marketplace(root, names, errors):
    path = root / ".claude-plugin/marketplace.json"
    if not path.is_file():
        errors.append(".claude-plugin/marketplace.json: missing")
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f".claude-plugin/marketplace.json: invalid JSON: {exc}")
        return
    for key in ("name", "owner", "plugins"):
        if key not in data:
            errors.append(f".claude-plugin/marketplace.json: missing {key}")
    published = []
    seen = set()
    for plugin in data.get("plugins", []):
        pname = plugin.get("name", "")
        if pname in seen:
            errors.append(f".claude-plugin/marketplace.json: duplicate plugin {pname!r}")
        seen.add(pname)
        if not NAME_RE.match(pname):
            errors.append(f".claude-plugin/marketplace.json: plugin name {pname!r} must be kebab-case")
        if not plugin.get("description"):
            errors.append(f".claude-plugin/marketplace.json: plugin {pname!r} needs a description")
        if not isinstance(plugin.get("source", "./"), str):
            continue  # an external source (e.g. another GitHub repo) does not publish skills from here
        source = root / plugin.get("source", "./")
        if "skills" not in plugin:
            # No explicit list: Claude Code loads every folder under <source>/skills.
            published += [d.name for d in skill_dirs(source.resolve())]
        for skill_path in plugin.get("skills", []):
            target = (source / skill_path).resolve()
            if not (target / "SKILL.md").is_file():
                errors.append(f".claude-plugin/marketplace.json: plugin {pname!r} points at {skill_path}, which has no SKILL.md")
            published.append(target.name)
    for name in sorted(set(names) - set(published)):
        errors.append(f".claude-plugin/marketplace.json: skill {name!r} is not in any plugin")


def validate(root):
    root = Path(root).resolve()
    errors = []
    skills = skill_dirs(root)
    if not skills:
        errors.append("skills/: no skills found")
    for skill in skills:
        check_skill(skill, root, errors)
    names = [s.name for s in skills]
    check_readme(root, names, errors)
    check_marketplace(root, names, errors)
    return names, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="repository root")
    args = parser.parse_args()
    names, errors = validate(args.root)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if errors:
        print(f"{len(errors)} problem(s) found", file=sys.stderr)
        return 1
    print(f"OK: {len(names)} skills valid ({', '.join(names)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
