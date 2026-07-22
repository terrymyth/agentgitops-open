# Maintenance

Update this skill whenever AgentGitOps changes behavior in these areas:

- Token resolution or provider auth
- `agentgitops pr` options and idempotency behavior
- Change Package diff semantics
- GitHub/GitLab/Gitea Provider APIs
- Webhook event handling or signature validation
- SSE events and dashboard snapshots
- Review/Policy/Verification gates
- Merge Gate, conflict detection, provider merge behavior
- Agent handoff note expectations, CLI options, or Web note behavior
- Review Context API/CLI/Web behavior used by Review Agents
- Multi-project management (project add/list/switch)
- Team Sync (team init/join, sync push/pull/watch, context feed, handoff)
- Enterprise Edition injection (createEnterpriseExtensions, ExtensionRegistry)
- L3 advanced capabilities (AI Review, semantic conflict, predictive AgentOps, immutable audit, security scan, smart merge, cross-task evidence)
- Agent Adapter plugin registry (register/unregister/create)
- Deployment (Docker Compose, Helm/K8s, Relay mode)
- OpenAPI specification (docs/openapi.json)
- npm publishing (scripts/publish-npm.js)

## Update Checklist

1. Re-run a real smoke test against a disposable repo when PR/MR behavior changes.
2. Record new commands or changed outputs in `pr-smoke-test.md`.
3. Keep auth instructions in `auth-and-identities.md` token-safe and per-user.
4. Add troubleshooting entries for every real failure discovered.
5. Update `multi-project-and-team-sync.md` when multi-project or Team Sync behavior changes.
6. Update `enterprise-edition.md` when EE modules or injection factory changes.
7. Update `l3-advanced-capabilities.md` when L3 capabilities are added or modified.
8. Validate the skill after edits:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/agentgitops-gitops
```

If the environment is missing the Python `yaml` dependency, run the stdlib fallback:

```bash
python3 skills/agentgitops-gitops/scripts/validate_skill.py skills/agentgitops-gitops
```

9. Commit the skill updates with the related product change when possible.

## Skill Version History

| Date | Version | Changes |
| --- | --- | --- |
| 2026-07-05 | 1.0 | Initial skill: PR smoke test, auth, webhook/SSE, merge gate, handoff, troubleshooting |
| 2026-07-12 | 2.0 | Major update: multi-project, Team Sync, EE injection, L3 capabilities, adapter registry, deployment, OpenAPI, npm publishing |
