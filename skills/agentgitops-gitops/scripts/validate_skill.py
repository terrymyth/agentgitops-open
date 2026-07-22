#!/usr/bin/env python3
"""Minimal stdlib validator for the agentgitops-gitops skill."""

from pathlib import Path
import sys
import re


REQUIRED_FILES = [
    "SKILL.md",
    "VERSION",
    "agents/openai.yaml",
    "references/auth-and-identities.md",
    "references/pr-smoke-test.md",
    "references/webhook-and-sse.md",
    "references/merge-gate.md",
    "references/troubleshooting.md",
    "references/maintenance.md",
    "references/agent-handoff.md",
    "references/multi-project-and-team-sync.md",
    "references/enterprise-edition.md",
    "references/l3-advanced-capabilities.md",
]


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
    missing = [name for name in REQUIRED_FILES if not (root / name).is_file()]
    if missing:
        print("missing files:")
        for name in missing:
            print(f"- {name}")
        return 1

    skill = (root / "SKILL.md").read_text(encoding="utf-8")
    if not skill.startswith("---\n") or "name: agentgitops-gitops" not in skill:
        print("invalid SKILL.md frontmatter")
        return 1

    # Check version in frontmatter
    version_match = re.search(r"^version:\s*(.+)$", skill, re.MULTILINE)
    if not version_match:
        print("missing version in SKILL.md frontmatter")
        return 1

    # Check VERSION file matches
    version_file = (root / "VERSION").read_text(encoding="utf-8").strip()
    version_frontmatter = version_match.group(1).strip()
    if version_file != version_frontmatter:
        print(f"version mismatch: VERSION file={version_file}, SKILL.md frontmatter={version_frontmatter}")
        return 1

    # Check all references are mentioned in SKILL.md
    # agents/openai.yaml is a config file, not a reference to be mentioned in SKILL.md
    for reference in REQUIRED_FILES[2:]:
        if reference.startswith("agents/"):
            continue  # agent config files only need to exist
        if reference not in skill and Path(reference).name not in skill:
            print(f"SKILL.md does not mention {reference}")
            return 1

    print(f"agentgitops-gitops skill structure ok (version {version_file})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
