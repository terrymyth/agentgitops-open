# PR Smoke Test Runbook

Use this runbook for real end-to-end AgentGitOps PR/MR validation.

## Preconditions

- The target repo is explicitly approved for testing.
- The target repo has a base branch. If it is empty, create and push an initial `main` commit first.
- The local AgentGitOps repo builds successfully.
- Git push credentials and provider API credentials are both available.

## Build Local CLI

From the AgentGitOps repo:

```bash
pnpm --filter @agentgitops/git build
pnpm --filter @agentgitops/local-hub build
pnpm --filter @agentgitops/cli build
```

Use the built CLI directly:

```bash
node /absolute/path/to/agentgitops/apps/cli/dist/index.js --help
```

## Initialize Test Repo

```bash
git clone https://github.com/<owner>/<repo>.git /private/tmp/agops-<repo>
cd /private/tmp/agops-<repo>
git config user.name "<name>"
git config user.email "<email>"
```

If empty:

```bash
printf '# <repo>\n\nAgentGitOps smoke test repository.\n' > README.md
git add README.md
git commit -m "chore: initialize test repository"
git branch -M main
git push origin main
```

## Create A Task And Change Package

```bash
AGOPS=/absolute/path/to/agentgitops/apps/cli/dist/index.js
node "$AGOPS" init --name <repo> --force
node "$AGOPS" agent register smoke-writer --command /bin/sh --arg -c "printf 'agentgitops pr smoke test\n' > smoke.txt"
node "$AGOPS" task create "Add smoke test file" --agent smoke-writer --objective "Create a smoke.txt file for real PR creation testing"
```

Capture the task id from output, then run:

```bash
node "$AGOPS" run --agent smoke-writer --task <task-id>
node "$AGOPS" package <task-id>
node "$AGOPS" pr <task-id> --dry-run
```

The Change Package must include `smoke.txt` and nonzero insertions. The dry-run PR/MR body should include both the Change Package and `Review Context Summary` sections. If it reports zero changes while files exist in the worktree, inspect diff handling for untracked files.

## Create Or Update The PR

Run preflight first:

```bash
node "$AGOPS" pr preflight <task-id> --real
```

```bash
node "$AGOPS" pr <task-id> --review-context-comment
```

If env tokens are missing but `gh` is logged in, AgentGitOps should fallback to `gh auth token` internally. If using an older CLI:

```bash
GITHUB_TOKEN="$(gh auth token)" node "$AGOPS" pr <task-id> --review-context-comment
```

## Idempotency Check

Run the same command twice:

```bash
node "$AGOPS" pr <task-id>
node "$AGOPS" pr <task-id>
```

Expected result:

- Same PR URL
- Same PR number
- PR body/title updated
- At most one Review Context comment, updated in place when `--review-context-comment` is used
- No duplicate PR

## Repeatable Smoke Script

From the AgentGitOps repo, the packaged script defaults to dry-run mode:

```bash
pnpm smoke:pr -- --repo https://github.com/<owner>/<repo>.git
```

Dry-run mode clones the target repo, configures repo-local Git author identity, initializes AgentGitOps, creates/runs a smoke task, generates a Change Package, runs `agentgitops pr preflight`, and prints the PR/MR body. It does not push or create a PR/MR.

Real provider writes require an explicit flag:

```bash
pnpm smoke:pr -- --repo https://github.com/<owner>/<repo>.git --real
```

`--real` pushes the branch, creates or updates the PR/MR, then runs the same command again to validate idempotency.

## Evidence To Report

Always report:

- Target repo URL
- Task id
- Branch name
- PR/MR URL and number
- Whether PR/MR is draft
- Whether idempotency passed
- Validation commands and results
- Any product defects discovered and fixes committed

## Latest Smoke Evidence

2026-07-05 against `example-org/testgit`:

- Task: `task-20260705-532`
- Branch: `agent/task-20260705-532/smoke-writer`
- Commit: `9218bbec6f6e0e1dd7a1f31f5b827751f054937c`
- PR: `https://github.com/example-org/testgit/pull/3`
- Result: `agentgitops pr task-20260705-532 --no-draft --review-context-comment` returned PR `#3` twice, confirming idempotent PR update.
- Review Context comment: first run created `https://github.com/example-org/testgit/pull/3#issuecomment-4885606764`; second run updated the same comment URL.
- Change Package: `pkg_task-20260705-532`, one changed file, low risk, PR URL/number written back.

2026-07-04 against `example-org/testgit`:

- Task: `task-20260704-205`
- Branch: `agent/task-20260704-205/smoke-writer`
- PR: `https://github.com/example-org/testgit/pull/2`
- Result: `agentgitops pr task-20260704-205 --no-draft` returned PR `#2` twice, confirming idempotent update.
- Change Package: `pkg_task-20260704-205`, one changed file, low risk, PR URL/number written back.
- Runtime note: a missing repo-local Git author identity blocked the first commit attempt. Configure `git config user.name` and `git config user.email` in disposable clones before PR smoke tests.
