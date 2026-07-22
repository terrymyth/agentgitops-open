# Troubleshooting

## Git Push Works But PR Fails

Cause: Git credentials and provider API token are separate.

Actions:

```bash
gh auth status
tok="$(gh auth token 2>/dev/null || true)"
if [ -n "$tok" ]; then echo "gh-token-present"; else echo "gh-token-missing"; fi
```

If `agentgitops pr` says token missing, confirm the CLI supports fallback to `gh auth token`, or run:

```bash
GITHUB_TOKEN="$(gh auth token)" agentgitops pr <task-id>
```

Run preflight for structured diagnostics:

```bash
agentgitops pr preflight <task-id> --real
```

## SSH Permission Denied

Symptoms:

```text
Permission denied (publickey)
```

Actions:

```bash
ssh-keygen -lf ~/.ssh/id_ed25519.pub
ssh -T git@github.com
git ls-remote git@github.com:<owner>/<repo>.git
```

The public key must be registered on the GitHub account with repo access. SSH helps Git clone/push only; PR creation still needs API auth.

## Empty Repo Fails Worktree Flow

Worktree-based task execution needs a base commit and branch. Create initial `main` before running AgentGitOps.

## Git Commit Fails With Author Identity Unknown

Symptoms:

```text
Author identity unknown
fatal: unable to auto-detect email address
```

Actions:

```bash
git config user.name "AgentGitOps Smoke"
git config user.email "agentgitops-smoke@example.com"
```

Set this in the disposable test clone before running `agentgitops pr`. Prefer repo-local config; avoid mutating global Git identity unless the user asks.

## Change Package Reports Zero Files

Check the task worktree:

```bash
git status --short
git diff --name-only <base-branch>
git ls-files --others --exclude-standard
```

New untracked files must be included in diff stats. If not, fix `DiffService` or stage/commit files before package generation.

## Duplicate PR Risk

Provider implementation must search existing open PRs by:

- head owner and branch
- base branch
- open state

Then patch title/body instead of creating a new PR.

## Web Merge Returns Recovery Hints

If Web Merge Queue returns `merged: false`, inspect `message` and `recovery`:

- Missing PR/MR number: run `agentgitops pr <task-id>` first.
- Missing token: set `GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN`, or login with `gh auth login`.
- Gate blocked: resolve Conflict Center items, failed checks, policy errors, or missing approvals.
- Provider refused merge: check branch protection, required checks/pipelines, mergeability, and token permissions.

These responses must not include token values.

## Web Server Fails To Start

Symptoms:

```text
EADDRINUSE
EACCES
EPERM
WEB_ASSETS_NOT_FOUND
```

Actions:

```bash
agentgitops web --host 127.0.0.1 --port 4318
pnpm build
```

The CLI prints startup diagnostics before binding the server: web assets, port validity, and config presence. Missing config is a warning because Web can initialize the project.

## Sandbox Differences

Sandboxed commands may not see macOS keychain, ssh-agent, or local server ports the same way escalated commands do. If a command is essential and fails with permission/network errors, rerun with the required approval path and clearly report the distinction.
