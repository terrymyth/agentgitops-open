# agentgitops

> **Agent-native GitOps control plane for code agents.**
> Let multiple code agents write code in parallel — while every line merged into main stays explainable, verifiable, auditable, and reversible.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)
[![Status: v1 Release Candidate](https://img.shields.io/badge/Status-v1%20Release%20Candidate-orange.svg)](./docs/v1-release-standard.md)
[![Language: TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)](./docs/architecture.md)

---

## Open-source scope

This repository is the public, independently governed distribution of agentgitops. Every tracked source file in this repository is licensed under Apache-2.0 unless a file explicitly says otherwise. Private customer integrations, unreleased experiments, credentials, operational data, and internal planning are developed in a separate private repository and are never synchronized automatically.

The public and private repositories have independent Git histories. Public releases are curated and reviewed changes, not mirrors of private branches. Once code is published here under Apache-2.0, that grant is not revoked by later private development.

See [Governance](./GOVERNANCE.md), [Support](./SUPPORT.md), [Security](./SECURITY.md), and [Trademarks](./TRADEMARKS.md) for the project rules.

---

## Why

Code agents (Codex, Claude Code, OpenCode, Cursor, Cline, Devin, …) are evolving from "assisted editing" into "autonomous engineering". A single developer can now run many agents in parallel — fixing bugs, adding tests, upgrading dependencies, refactoring, explaining code, and patching PRs — all at once.

But today's code-hosting systems (GitHub / GitLab / Gitea / Gerrit) were designed for **human** collaboration:

```
human → branch → commit → PR/MR → review → merge
```

When many agents work concurrently, new governance problems appear:

| Problem | Symptom |
| --- | --- |
| Workspace chaos | Multiple agents edit the same project dir, files overwrite each other |
| Branch chaos | A flood of agent temp branches, temp commits, temp PRs |
| Context chaos | Each agent understands the repo, scope, and change state differently |
| Conflict chaos | Not just text conflicts — API, dependency, permission, logic conflicts |
| Review pressure | Agents produce PRs faster than humans can review |
| Merge risk | Agent code may pass local tests but break the global chain |
| Audit gap | Hard to trace which agent, for which task, after which checks, merged what |
| Skill boundary | Skills *guide* agents but cannot *enforce* guardrails |

**agentgitops** is the missing layer: an **Agentic GitOps Control Plane** between code agents and Git platforms — providing task governance, workspace governance, change governance, and merge governance.

---

## What It Is

> agentgitops is a GitOps management system for code agents. It brings every agent's tasks, workspaces, branches, changes, tests, reviews, merges, and audits into one visible, verifiable, governable engineering flow.

```
Let many code agents write code in parallel,
but make every line that reaches main
explainable · verifiable · auditable · reversible.
```

### Core judgment

- **Git is the source of truth** for code. agentgitops does **not** reinvent Git or replace GitHub/GitLab.
- **Skills are soft constraints** (they tell agents what to do). agentgitops provides **hard constraints** (it enforces what agents *can* do).
- **One task → one workspace → one evidence package.** No agent edits the project root directly.
- **Humans use a visual console; agents use automation APIs.** The UI is for transparent governance, not for agents to "click".

---

## Core Concepts

| Concept | Description |
| --- | --- |
| **Task Contract** | A signed agreement for every agent task: objective, scope, allowed/forbidden paths, required checks, risk level, approval rules. |
| **Agent Workspace** | An isolated `git worktree` per task — agents never share a working directory. |
| **Change Package** | A standardized evidence bundle per task: diff, test results, risk, unverified items, merge recommendation. |
| **Review Board** | Not a plain PR diff page — an *agent change evidence center* for humans. |
| **Merge Gate** | Risk-based merge policy: low-risk can auto-merge, high-risk requires human approval. |
| **Policy Engine** | Hard guardrails: protected branches, forbidden paths, required checks, approval rules. |
| **Conflict Engine** | Detects file-level and (later) semantic conflicts across concurrent agent tasks. |
| **Audit & Replay** | Full traceability from task input to code merge. |
| **AgentOps** | Long-term operational metrics: success rate, merge rate, conflict rate, takeover rate. |

### Product main line

```
Task Contract
  → Workspace Isolation
  → Agent Execution
  → Change Package
  → Review Board
  → Merge Gate
  → Audit Replay
  → AgentOps
```

---

## Architecture

```
┌──────────────────────────────────────────────┐
│            Web UI / Review Console            │
│  human monitoring, review, conflict, merge    │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│       agentgitops Control Plane / Server      │
│  tasks, policy, review, conflict, merge, audit│
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│          agentgitops Local Hub / CLI          │
│  worktree, agent adapter, file capture, test  │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│       Codex / Claude Code / OpenCode / etc.   │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│       GitHub / GitLab / Gitea / Gerrit        │
└──────────────────────────────────────────────┘
```

Three deployment shapes:

- **Local-first** (single machine): CLI + Local Hub + SQLite + local Web UI. For individuals & OSS maintainers.
- **Team Hybrid** (3–30 devs): Local Hub + Team Control Plane + Postgres + Web Review Board + Webhooks + Merge Gate.
- **Enterprise** (private): Multi-project/multi-team, SSO/RBAC, audit retention, Policy Engine, HA, GHE/GitLab self-managed/Gitea.

See [`docs/architecture.md`](./docs/architecture.md) for the full technical architecture.

---

## Quick Start

> CE is a v1 release candidate. The commands below describe the implemented developer experience; production release requires every gate in the [v1 release standard](./docs/v1-release-standard.md) to pass.
> Phase 8 Release Closure is now active; follow the
> [Phase 8 plan](./docs/phase8-release-closure.md) and
> [release process](./docs/release-process.md) for current delivery status.

### Install from npm

```bash
# Install
npm install -g agentgitops

# Initialize a project
agentgitops init
agentgitops doctor

# Register a code agent
agentgitops agent register claude-code --command claude

# Create a task with a contract
agentgitops task create "Fix expired token returning 500"

# Run the agent in an isolated workspace
agentgitops run --agent claude-code --task task-xxx

# Inspect & package the change
agentgitops status
agentgitops diff task-xxx
agentgitops package task-xxx

# Push as a PR with the Change Package embedded
agentgitops pr task-xxx

# Open the local governance console
agentgitops web
```

### Run from source

Use this path when contributing to the project or trying the latest public `main` branch.

```bash
git clone https://github.com/terrymyth/agentgitops-open.git
cd agentgitops-open
pnpm install
pnpm build

# Run the CLI from the workspace
pnpm --filter agentgitops exec agentgitops --help
```

Recommended local verification before opening a PR:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

### Cross-Machine Dogfood Flow

Use this flow when a developer works from two locations, or when different code agents continue the same repository from different machines.

```bash
# Start a location/session by pulling code and reconciling local runtime state
git pull --ff-only
agentgitops task reconcile
agentgitops sync pull

# Resume from the latest committed handoff/closeout evidence
agentgitops task resume <task-id> --json
agentgitops context feed --task <task-id>

# Before leaving the current location
agentgitops package <task-id> --from-git-diff
agentgitops handoff generate <task-id>
agentgitops task closeout <task-id> --mode checkpoint --record
agentgitops sync push --auto-commit --cleanup
git push
```

Dogfood status as of July 14, 2026:

- Git task snapshots are the cross-machine source of truth; local SQLite is reconciled from committed task YAML.
- `task resume` detects `merged-direct` when task branch changes are already reachable from `main`.
- `task closeout` accepts committed Markdown handoff files and packaged verification checks as portable evidence.
- Git-native Team Sync uses per-hub outbox directories to reduce merge conflicts between machines.
- Web Task Board surfaces snapshot drift before the local runtime cache is reconciled.

See [`docs/cli-reference.md`](./docs/cli-reference.md) for the full command reference.

---

## Configuration

agentgitops is configured via `.agentgitops.yml` in the project root:

```yaml
version: 1

project:
  name: demo-web
  default_branch: main
  worktree_root: ../.agentgitops-worktrees

git:
  provider: github
  remote: origin

agents:
  claude-code:
    type: generic-cli
    command: claude
    args: ["{{task_prompt_file}}"]

policies:
  branch:
    protected: [main, "release/*"]
  paths:
    high_risk: [src/auth/**, db/migrations/**, infra/**]
    forbidden: [secrets/**, "*.pem", "*.key"]
  checks:
    required:
      - { name: lint, command: npm run lint }
      - { name: test, command: npm test }
  approval:
    high_risk_requires_approval: true

ui:
  port: 4789
```

See [`docs/configuration.md`](./docs/configuration.md) for all options.

---

## Documentation

| Document | Description |
| --- | --- |
| [`docs/product-design.md`](./docs/product-design.md) | Product architecture, goals, non-goals, user journeys |
| [`docs/architecture.md`](./docs/architecture.md) | Technical architecture, modules, deployment |
| [`docs/data-model.md`](./docs/data-model.md) | Core data models & schemas |
| [`docs/task-lifecycle.md`](./docs/task-lifecycle.md) | Task state machine & lifecycle |
| [`docs/api-reference.md`](./docs/api-reference.md) | REST API reference |
| [`docs/cli-reference.md`](./docs/cli-reference.md) | CLI command reference |
| [`docs/configuration.md`](./docs/configuration.md) | Configuration reference |
| [`docs/adapters.md`](./docs/adapters.md) | Agent adapter design |
| [`docs/policy.md`](./docs/policy.md) | Policy engine design |
| [`docs/change-package.md`](./docs/change-package.md) | Change Package specification |
| [`docs/git-provider-integration.md`](./docs/git-provider-integration.md) | GitHub/GitLab/Gitea integration |
| [`docs/security.md`](./docs/security.md) | Security design |
| [`docs/naming-conventions.md`](./docs/naming-conventions.md) | Naming conventions & project boundaries |
| [`docs/ai-coding-event-summary-spec.md`](./docs/ai-coding-event-summary-spec.md) | AI Coding event summary spec |
| [`docs/relay-deployment.md`](./docs/relay-deployment.md) | Relay deployment guide |
| [`docs/phase8-release-closure.md`](./docs/phase8-release-closure.md) | Phase 8 release closure tasks and gates |
| [`docs/release-process.md`](./docs/release-process.md) | Public npm, GHCR, Helm, SBOM and attestation process |
| [`docs/release-checklist.md`](./docs/release-checklist.md) | Release checklist for maintainers |

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24+ |
| Language | TypeScript (monorepo) |
| Package manager | pnpm |
| Monorepo | Turborepo / pnpm workspace |
| CLI | commander |
| Server | Node.js native HTTP + SSE |
| Web | Vite + React, Tailwind CSS |
| DB | SQLite (local, `node:sqlite`) + PostgreSQL (enterprise) |
| Git | system `git` via a `GitService` wrapper |
| Queue | WorkflowJobRunner (durable, SQLite-backed) |
| Realtime | SSE (Server-Sent Events) |
| Tests | Vitest |
| Build | tsup |

> Git operations prefer the **system `git`** binary (most reliable for worktree/merge/rebase/diff) wrapped in a `GitService`. A Go-based local daemon is a future evolution, not an MVP requirement.

---

## Project Structure

```
agentgitops/
├─ apps/
│  ├─ cli/          # agentgitops CLI
│  ├─ server/       # Control Plane server (Node.js HTTP + SSE)
│  └─ web/          # Review Console web UI (Vite + React)
├─ packages/
│  ├─ core/         # models, schemas, events, constants, extension ports
│  ├─ git/          # GitService, worktree, diff, GitHub/GitLab providers
│  └─ local-hub/    # workspace, agent adapters, change package, policy, merge gate, team sync, enterprise providers
├─ docs/
├─ scripts/
└─ .github/
```

---

## Status

**v1 Release Candidate / Phase 8 active.** The planned Phase 0-7 product capabilities are
implemented; release hardening and external publication are tracked in the
[Phase 8 plan](./docs/phase8-release-closure.md) and
[v1 release standard](./docs/v1-release-standard.md). Implemented capabilities include:

- Local-first CLI MVP with full task/workspace/agent/change-package lifecycle
- Web governance console (Dashboard, TaskBoard, MergeQueue, ConflictCenter, AuditEvents, AgentOps, TeamBoard, TeamSyncSettings, ContextFeedPreview, ConflictGraph, SharedMergeQueue)
- GitHub/GitLab PR integration with Change Package injection
- Policy Engine, Verification Gate, Merge Gate, Conflict Engine
- AgentOps Dashboard with trend metrics
- **Team Sync**: multi-Hub collaboration via Relay, Context Feed, Handoff Package, Adopt/Continue, Conflict Graph, PR Comment Sync, Branch Ownership
- **Enterprise Runtime**: extension ports, OIDC JWT signature verification, request-level RBAC, immutable audit, compliance providers, and PostgreSQL with strict startup behavior

See [`docs/v1-release-standard.md`](./docs/v1-release-standard.md) for the release acceptance target and [`docs/release-checklist.md`](./docs/release-checklist.md) for the public release checklist.
### Edition Strategy

| Edition | License | Key Capabilities |
| --- | --- | --- |
| **CE** (Community Edition) | Apache-2.0 | Full local governance + Team Sync P0/P1 + enterprise extension ports (CE defaults) |
| **Team / Enterprise** | Apache-2.0 for code present here; separate terms may apply to future private modules | Organization-scale extension ports and the enterprise-oriented runtime capabilities currently published in this repository |

CE is not a crippled demo. The open-source branch must remain useful for local-first and small-team agent governance without requiring a hosted service.

---

## Repository and release model

The public release line is this repository's protected `main` branch.

- Public contributions target `main` through a pull request.
- Runtime dogfood data is intentionally ignored: `.agentgitops/closeouts/`, `.agentgitops/handoffs/`, `.agentgitops/packages/`, `.agentgitops/tasks/`, `.agentgitops/sync/outbox/`, `.agentgitops/verifications/`.
- Internal handoff notes, private project prompts, customer data, local paths, credentials, and commercial planning documents are not part of this repository.
- Maintainers may develop privately, but public-safe changes enter this repository only through a clean snapshot or reviewed cherry-pick and must pass public history and release-hygiene checks.
- No workflow uses `git push --mirror`, `git push --all`, or a shared remote for both repositories.

---

## Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and adhere to the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

[Apache-2.0](./LICENSE). See [NOTICE](./NOTICE) and [TRADEMARKS.md](./TRADEMARKS.md) for attribution and naming guidance.
