"""Tests for scripts/validate_skills.py against the real repo and small broken fixtures."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("validate_skills", ROOT / "scripts/validate_skills.py")
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)


class RepoTests(unittest.TestCase):
    def test_this_repository_is_valid(self):
        names, errors = vs.validate(ROOT)
        self.assertEqual(errors, [])
        self.assertIn("pr-green", names)


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.write_skill("demo")
        (self.root / "README.md").write_text("| [demo](skills/demo/SKILL.md) | Demo |\n")
        self.write_marketplace([{"name": "demo", "description": "d", "source": "./", "skills": ["./skills/demo"]}])

    def tearDown(self):
        self.tmp.cleanup()

    def write_skill(self, name, front=None):
        skill = self.root / "skills" / name
        (skill / "agents").mkdir(parents=True, exist_ok=True)
        front = front if front is not None else f"name: {name}\ndescription: Does {name} things."
        (skill / "SKILL.md").write_text(f"---\n{front}\n---\n\n# {name}\n")
        (skill / "agents/openai.yaml").write_text(
            f'interface:\n  display_name: "{name}"\n  short_description: "x"\n  default_prompt: "Use ${name}."\n')
        return skill

    def write_marketplace(self, plugins):
        path = self.root / ".claude-plugin/marketplace.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"name": "m", "owner": {"name": "o"}, "plugins": plugins}))

    def errors(self):
        return "\n".join(vs.validate(self.root)[1])

    def test_valid_fixture_passes(self):
        self.assertEqual(self.errors(), "")

    def test_name_must_match_folder(self):
        self.write_skill("demo", "name: other\ndescription: x")
        self.assertIn("must match folder name", self.errors())

    def test_description_limits(self):
        self.write_skill("demo", "name: demo")
        self.assertIn("description is required", self.errors())
        self.write_skill("demo", "name: demo\ndescription: " + "x" * 1025)
        self.assertIn("limit is 1024", self.errors())

    def test_missing_frontmatter(self):
        (self.root / "skills/demo/SKILL.md").write_text("# no frontmatter\n")
        self.assertIn("frontmatter", self.errors())

    def test_unlisted_skill_is_reported_in_readme_and_marketplace(self):
        self.write_skill("extra")
        errors = self.errors()
        self.assertIn("README.md: skill 'extra' is not listed", errors)
        self.assertIn("skill 'extra' is not in any plugin", errors)

    def test_plugin_without_skill_list_publishes_whole_folder(self):
        self.write_marketplace([{"name": "demo", "description": "d", "source": "./"}])
        self.write_skill("extra")
        errors = self.errors()
        self.assertNotIn("not in any plugin", errors)
        self.assertIn("README.md: skill 'extra' is not listed", errors)

    def test_marketplace_path_must_exist(self):
        self.write_marketplace([{"name": "demo", "description": "d", "source": "./", "skills": ["./skills/demo", "./skills/gone"]}])
        self.assertIn("./skills/gone, which has no SKILL.md", self.errors())

    def test_broken_relative_link(self):
        (self.root / "skills/demo/SKILL.md").write_text(
            "---\nname: demo\ndescription: x\n---\nSee [ref](references/missing.md).\n```\n[ignored](nope.md)\n```\n")
        errors = self.errors()
        self.assertIn("broken link to references/missing.md", errors)
        self.assertNotIn("nope.md", errors)

    def test_openai_yaml_required(self):
        (self.root / "skills/demo/agents/openai.yaml").unlink()
        self.assertIn("missing agents/openai.yaml", self.errors())

    def test_script_with_shebang_must_be_executable(self):
        script = self.root / "skills/demo/scripts/run"
        script.parent.mkdir()
        script.write_text("#!/bin/sh\n")
        script.chmod(0o644)
        self.assertIn("not executable", self.errors())
        script.chmod(0o755)
        self.assertEqual(self.errors(), "")

    def test_python_cache_is_ignored(self):
        cache = self.root / "skills/demo/__pycache__"
        cache.mkdir()
        (cache / "x.pyc").write_bytes(b"#!not a script")
        self.assertEqual(self.errors(), "")


if __name__ == "__main__":
    unittest.main()
