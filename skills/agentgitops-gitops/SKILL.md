---
name: agentgitops-gitops
version: 2.0.0
description: AgentGitOps automation workflows for creating task workspaces, generating Change Packages, pushing branches, creating or updating GitHub/GitLab/Gitea PR/MR records, validating idempotency, configuring per-user GitHub auth, webhook secrets, SSE status, Team Sync, multi-project management, enterprise edition injection (SSO/RBAC/SIEM/compliance), L3 advanced capabilities (AI Review, semantic conflict, predictive AgentOps, immutable audit, security scan, smart merge), and safely recovering from token, remote permission, diff, or provider failures. Use when Codex/Claude Code is asked to operate or maintain agentgitops GitOps automation, run real PR/MR smoke tests, configure GitHub auth for different developers, manage multiple projects, use Team Sync for cross-machine collaboration, or troubleshoot agentgitops pr/webhook/SSE/enterprise behavior.
---

# AgentGitOps GitOps

Use this skill when working on AgentGitOps repository automation and governance flows. Treat live GitHub/GitLab/Gitea operations as external writes: verify the target repo, branch, and auth before pushing or creating PRs.

## Current Capability Matrix

AgentGitOps has evolved through 4 priority levels. This skill covers all of them:

| Capability Area | CLI Commands | Status |
| --- | --- | --- |
| Project Management | `project add/list/switch/remove` | ✅ Multi-project |
| Agent Management | `agent register/list/remove` | ✅ 4 built-in + plugin registry |
| Task Lifecycle | `task create/list/status/start/cancel/adopt/continue/resume/closeout/reconcile` | ✅ Full lifecycle + cross-machine closeout |
| Agent Execution | `run --agent --task` | ✅ Isolated worktree |
| Change Package | `diff/test/package/pr/pr preflight` | ✅ Evidence-driven |
| Review | `review approve/reject/request-changes/ask-fix/context` | ✅ + AI Review summary |
| Merge Gate | `merge queue/approve/block` | ✅ + smart scheduling |
| Audit | `audit list/replay` | ✅ + immutable hash chain |
| Workspace | `workspace list/open/clean/remove/sweep` | ✅ Lifecycle management |
| Agent Notes | `note add/list` | ✅ Handoff notes |
| Team Sync | `team init/join/status/sync-config/conflicts` | ✅ Cross-machine |
| Sync | `sync status/push/pull/watch`, git-native outbox | ✅ Relay + no-relay cross-machine |
| Context Feed | `context feed` | ✅ Agent context |
| Handoff | `handoff preview/generate/doc` | ✅ + handoff documents |
| Board | `board/status` | ✅ Terminal + Web |
| WebUI | `web/server start` | ✅ 13+ pages |
| Enterprise | `createEnterpriseExtensions` | ✅ EE injection factory |

## Core Workflow

### Standard Task Flow (CE)

1. Inspect repo state: `git status --short`, current branch, remotes, and recent commits.
2. Build or use the local `agentgitops` CLI from the current repo.
3. Initialize project: `agentgitops init` (or `project add <path>` for multi-project).
4. Register agent: `agentgitops agent register claude-code --command claude`.
5. Create task: `agentgitops task create "Task title" --agent claude-code`.
6. Run agent: `agentgitops run --agent claude-code --task <task-id>`.
7. Generate Change Package: `agentgitops package <task-id>`.
8. Create PR: `agentgitops pr <task-id>` (use `--dry-run` first, `--review-context-comment` for review context).
9. Review: `agentgitops review approve <task-id>` or Web Review Board.
10. Merge: `agentgitops merge approve <task-id>` (runs Merge Gate first).
11. Audit: `agentgitops audit replay <task-id>`.

### Multi-Project Flow

```bash
# Register multiple projects
agentgitops project add /path/to/project-a
agentgitops project add /path/to/project-b

# List projects
agentgitops project list

# Switch active project
agentgitops project switch <project-id>

# Start WebUI for specific project
agentgitops web --project <project-id>
```

Each project runs on its own port (4789, 4790, 4791...). Use ProjectSelector page to navigate.

### Team Sync Flow (Cross-Machine Collaboration)

```bash
# Machine A: Initialize Team Sync
agentgitops team init --team-id <team-id> --relay-url <relay-url>

# Machine B: Join Team Sync
agentgitops team join --team-id <team-id> --relay-url <relay-url>

# Push local events to Relay
agentgitops sync push

# Pull events from Relay
agentgitops sync pull

# Watch sync state
agentgitops sync watch

# Generate context feed for next agent
agentgitops context feed --task <task-id>

# Generate handoff package
agentgitops handoff generate <task-id>
```

### Multi-Location Dogfood Flow (No Relay)

Use this flow when the user switches between office/home machines, or when another code agent continues work after a Git pull.

Start a new location/session:

```bash
git pull --ff-only
agentgitops task reconcile
agentgitops sync pull
agentgitops task list
agentgitops task resume <task-id> --json
```

If `task resume` reports `mergedDirect: true`, the task branch content is already reachable from the base branch. Continue from the base branch and use the latest CloseoutRecord, Change Package, and handoff package as evidence; do not blindly revive the old task branch.

Before leaving a location:

```bash
agentgitops package <task-id> --from-git-diff
agentgitops handoff generate <task-id>
agentgitops task closeout <task-id> --mode checkpoint --record
agentgitops sync push --auto-commit --cleanup
git status --short
git push
```

If the task state shown by Web/CLI looks stale after a pull, run:

```bash
agentgitops task reconcile --dry-run
agentgitops task reconcile
```

Cross-machine source-of-truth rule: committed Git artifacts win over local SQLite runtime state. Treat `.agentgitops/tasks/*.yml`, `.agentgitops/packages/*.json`, `.agentgitops/closeouts/**`, `.agentgitops/handoffs/**`, and `.agentgitops/sync/outbox/**` as the portable facts that other code agents can consume.

### Enterprise Edition Flow (EE)

EE modules are injected via `createEnterpriseExtensions` factory:

```typescript
import { createEnterpriseExtensions } from "@agentgitops/local-hub";

const extensions = await createEnterpriseExtensions({
  license: "enterprise",
  storage: { type: "postgresql", url: "postgresql://..." },
  oidc: { issuer: "https://login.microsoftonline.com/...", clientId: "..." },
  rbac: { projectAssignments: { "project-a": { alice: ["reviewer"] } } },
  siem: { siemWebhookUrl: "https://...", siemType: "splunk" },
});
```

EE modules include: PostgreSQL, SSO/OIDC/SAML, RBAC, SIEM (Splunk/Datadog/Elastic), Compliance Reports (SOC2/ISO27001/GDPR), Policy Templates, Token Analysis, Agent Vendor Comparison, Gitea, CODEOWNERS, Jira/Linear, IM Notifications (Feishu/WeCom/DingTalk/Slack), SCIM, Multi-tenant, Approval Workflow, Schema Conflict, Call Chain Conflict, Skill Pack, Plugin Registry.

## L3 Advanced Capabilities

AgentGitOps includes 7 L3 advanced capabilities:

| Capability | Description |
| --- | --- |
| AI Review Summary | Auto-generate review summary after agent execution |
| Semantic Conflict Detection | API contract, type definition, dependency, call chain, permission, business logic conflicts |
| Predictive AgentOps | Failure prediction, quality trends, agent recommendation |
| Immutable Audit (Hash Chain) | SHA-256 hash chain for tamper-evident audit |
| Security Scan Suite | SAST, Secret Scan, Dependency Scan, coverage comparison |
| Smart Merge Scheduling | Dependency-aware ordering, auto-rollback trigger |
| Cross-Task Evidence Aggregation | Cross-task diff comparison, trend analysis |

## Safety Rules

- Never print, commit, or write tokens to config files.
- Prefer `GITHUB_TOKEN`/`GH_TOKEN` from the environment; fallback to `gh auth token` only for the current process.
- Keep per-user auth outside the repo: each developer owns their GitHub/GitLab identity and credential store.
- Ask before external writes when the action pushes branches, creates PRs/MRs, or mutates webhooks.
- Do not claim real PR/MR creation unless a provider returned a URL/number.
- If Git push works but provider API fails, distinguish Git credentials from API token availability.
- EE modules degrade gracefully: if PostgreSQL/OIDC/RBAC unavailable, fall back to CE defaults.

## References

- For per-user GitHub/GitLab auth, token precedence, scopes, and safe diagnostics, read [auth-and-identities.md](references/auth-and-identities.md).
- For the real PR/MR smoke-test runbook, read [pr-smoke-test.md](references/pr-smoke-test.md).
- For webhook secret and SSE behavior, read [webhook-and-sse.md](references/webhook-and-sse.md).
- For Merge Gate, conflict detection, and provider merge behavior, read [merge-gate.md](references/merge-gate.md).
- For recording agent handoff notes that explain code changes and review focus, read [agent-handoff.md](references/agent-handoff.md).
- For common failure modes and recovery, read [troubleshooting.md](references/troubleshooting.md).
- For multi-project management and Team Sync, read [multi-project-and-team-sync.md](references/multi-project-and-team-sync.md).
- For enterprise edition injection and EE modules, read [enterprise-edition.md](references/enterprise-edition.md).
- For L3 advanced capabilities, read [l3-advanced-capabilities.md](references/l3-advanced-capabilities.md).
- For maintaining this skill as AgentGitOps evolves, read [maintenance.md](references/maintenance.md).
