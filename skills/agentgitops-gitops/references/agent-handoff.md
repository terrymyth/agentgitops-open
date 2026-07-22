# Agent Handoff Notes

Use Agent Handoff Notes whenever a Code Agent changes code, updates docs, runs real provider operations, or discovers a risk that another agent/reviewer should understand later.

## Why

Audit events say that something happened. Agent notes explain what changed, why it changed, how it was verified, and what reviewers should inspect. They make future Code Agent and Review Agent work safer.

## When To Record

Record a note after:

- implementing a feature or bug fix
- changing provider, auth, merge, webhook, SSE, policy, or conflict behavior
- running a real PR/MR smoke test
- updating docs or skills that future agents rely on
- discovering a residual risk, compatibility issue, or manual verification gap

## Required Fields

Every note should include:

- `summary`: concise explanation of what changed and why
- `files`: important files changed or worth reviewing
- `verification`: commands run and meaningful results
- `reviewFocus`: specific code paths or behaviors reviewers should inspect
- `risks`: residual risks or follow-ups, or `none`
- `commitSha` and `prUrl` when available

Do not include secrets, tokens, private keys, or raw credentials.

## CLI

```bash
agentgitops note add <task-id> \
  --agent codex \
  --summary "Implemented Web Merge Queue provider merge with gate recovery hints" \
  --file apps/server/src/index.ts apps/web/src/pages/MergeQueue.tsx \
  --verify "pnpm exec turbo run typecheck lint test build --force" \
  --review-focus "provider merge failure recovery" "token handling has no persistence" \
  --risk "provider merge still depends on branch protection and token permissions" \
  --commit <sha> \
  --pr <url>
```

List notes:

```bash
agentgitops note list <task-id>
```

## Web

Open Change Package detail and use **Agent 变更记录 / Agent Change Notes**. Web notes are stored in local AgentGitOps state and also write an `agent.note.added` audit event.

## Review Agent Usage

Before reviewing a PR/MR:

1. Generate review context:

```bash
agentgitops review context <task-id> --json --record
```

2. Read the Change Package, Agent Notes, local Review records, Audit events, and generated checklist from that context.
3. Compare notes against the actual diff and verification evidence.
4. Treat missing or vague notes as a review risk for non-trivial changes.

The Web Change Package detail page also exposes **Review Agent Context** and records `review.context.generated` when generated from the UI. For deeper review, open the dedicated `/review/<task-id>` page from the Task Board or Change Package detail page; it aggregates Task, Change Package, Agent Notes, Reviews, Audit, checklist, and copyable JSON for Review Agents.

When creating PRs/MRs, AgentGitOps now injects the Review Context summary into the PR/MR description. Use `agentgitops pr <task-id> --review-context-comment` or the Web PR action with Review Context comment enabled when the reviewer needs a provider-native comment that can be updated idempotently.
