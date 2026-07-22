# Changelog

All notable changes to the agentgitops-gitops skill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-12

### Added

- **SKILL.md**: Complete rewrite with capability matrix table (18 capability areas, 60+ CLI commands)
- **SKILL.md**: Standard task flow (CE complete 11-step workflow)
- **SKILL.md**: Multi-project flow (project add/list/switch, web --project)
- **SKILL.md**: Team Sync flow (team init/join, sync push/pull/watch, context feed, handoff)
- **SKILL.md**: Enterprise Edition flow (createEnterpriseExtensions injection factory)
- **SKILL.md**: L3 advanced capabilities section (7 capabilities)
- **SKILL.md**: EE degradation behavior safety rules
- **references/multi-project-and-team-sync.md**: Multi-project management + Team Sync complete workflow
- **references/enterprise-edition.md**: EE injection factory + 23 EE modules + degradation table + Extension Registry + Agent Adapter plugin registry + deployment
- **references/l3-advanced-capabilities.md**: 7 L3 capabilities detailed description + scoring impact
- **VERSION**: Version file for skill version tracking
- **validate_skill.py**: Version consistency check (VERSION file vs SKILL.md frontmatter)
- **validate_skill.py**: New required files check (multi-project-and-team-sync.md, enterprise-edition.md, l3-advanced-capabilities.md, VERSION)

### Changed

- **SKILL.md frontmatter**: Added `version: 2.0.0` field
- **SKILL.md description**: Expanded to cover Team Sync, multi-project, EE injection, L3 capabilities
- **agents/openai.yaml**: Updated display name, short description, and default prompt to reflect full capability
- **agents/openai.yaml**: Added `version: "2.0.0"` field
- **references/maintenance.md**: Added 9 new maintenance trigger conditions
- **references/maintenance.md**: Added skill version history table
- **validate_skill.py**: Added VERSION file and agents/openai.yaml to required files
- **validate_skill.py**: Added version consistency validation

### Deprecated

- Nothing deprecated in this release.

### Removed

- Nothing removed in this release.

### Fixed

- Nothing fixed in this release.

---

## [1.0.0] - 2026-07-05

### Added

- Initial skill release
- **SKILL.md**: Core workflow, safety rules, reference links
- **references/auth-and-identities.md**: GitHub/GitLab auth, token precedence, scopes
- **references/pr-smoke-test.md**: PR/MR smoke test runbook
- **references/webhook-and-sse.md**: Webhook secret, signature validation, SSE behavior
- **references/merge-gate.md**: Merge Gate inputs, blocking conditions, conflict detection, provider merge
- **references/agent-handoff.md**: Agent handoff notes, required fields, CLI, review agent usage
- **references/troubleshooting.md**: Common failure modes and recovery
- **references/maintenance.md**: Update triggers and checklist
- **agents/openai.yaml**: OpenAI agent interface configuration
- **scripts/validate_skill.py**: Skill structure validator
