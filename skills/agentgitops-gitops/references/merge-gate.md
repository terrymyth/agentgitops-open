# Merge Gate

Use this reference when implementing or operating `agentgitops merge`.

## Merge Gate Inputs

Load:

- Task Contract
- Change Package
- Local Review records
- Policy violations and verification checks already embedded in the Change Package
- Open conflicts embedded in the Change Package

## Blocking Conditions

Block merge when any of these are true:

- forbidden files were touched
- policy violations with severity `error`
- failed verification checks
- open conflicts
- reviewer rejected the change
- reviewer requested changes or asked the agent to fix
- task/package is high or critical risk and no approve review exists

Warnings may be emitted for unverified items or warning-level policy violations, but warnings alone should not block unless project policy says otherwise.

## Conflict Detection

The lightweight detector should add open conflicts for:

- `same_file`: two active Change Packages touch the same file
- `same_risk_domain`: two active Change Packages share a risk domain
- `high_risk_concurrent`: two high/critical risk Change Packages are active together
- semantic path categories: migrations, CI config, schema/openapi, API routes/controllers, type/model definitions, auth/RBAC/policy code, and dependency lockfiles/manifests

Conflict detection runs during Change Package generation and stores results in `changePackage.conflicts`.

## Web Merge Queue And Conflict Center

The Web UI can operate on merge governance through the Server API:

- `POST /api/merge-queue/:taskId/evaluate`: dry-run Merge Gate evaluation only.
- `POST /api/merge-queue/:taskId/approve` with `localOnly: true`: record local approval/audit without provider calls.
- `POST /api/merge-queue/:taskId/approve`: run Merge Gate, require `prNumber`, resolve provider token at runtime, then call GitHub/GitLab merge.
- `POST /api/merge-queue/:taskId/block`: mark the task blocked and record an audit event.

Conflict Center actions:

- `resolve`: mark the conflict resolved.
- `false-positive`: mark resolved and set suggestion to `mark_false_positive`.
- `rebase`: execute `git fetch <remote> <baseBranch>` and `git rebase <remote>/<baseBranch>` in the task worktree. On success, mark the conflict resolved and move the task to `testing`. On failure, attempt `git rebase --abort`, keep the conflict open, return recovery hints, and block the task.
- `human-takeover`: keep open, set suggestion to `human_takeover`, and block the task.

All Web actions must write audit events and broadcast `data.changed` plus a fresh `dashboard.snapshot`. Do not call providers when the gate is blocked, when the action is dry-run/local-only, or when the provider is unsupported.

## Provider Merge

`agentgitops merge approve <task-id>` should:

1. Run Merge Gate first
2. Stop before provider calls if blocked
3. Support `--dry-run` to evaluate only
4. Support `--local-only` to record local approval only
5. Require `prNumber`/MR iid in the Change Package for provider merge
6. Use the same token resolution as `agentgitops pr`
7. Update task status to `merged` only after provider confirms merge
8. Record `merge.completed` audit event

The Web merge API follows the same order and token precedence. Provider failure should return recovery hints for token scope, branch protection, required checks, mergeability, or retry/idempotency rather than hiding the provider message.

GitHub:

```text
PUT /repos/{owner}/{repo}/pulls/{number}/merge
```

Supported strategy values:

- `merge`
- `squash`
- `rebase`

GitLab:

```text
PUT /api/v4/projects/{project}/merge_requests/{iid}/merge
```

Use `squash` when task merge config or CLI option requests it.
